import { randomUUID } from "node:crypto";

type AdminGraphQL = (
  query: string,
  options?: { variables?: Record<string, unknown> }
) => Promise<Response>;

export type InventoryResetConditions = {
  vendor?: string;
  tags?: string;
  titleContains?: string;
};

type ProductNode = {
  vendor?: string | null;
  tags?: string[] | null;
  title?: string | null;
};

function productMatchesConditions(
  p: ProductNode,
  conditions: InventoryResetConditions
): boolean {
  if (conditions.vendor?.trim()) {
    const want = conditions.vendor.trim().toLowerCase();
    const have = (p.vendor ?? "").toLowerCase();
    if (!have.includes(want)) return false;
  }

  if (conditions.tags?.trim()) {
    const wantTags = conditions.tags
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    const haveTags = (p.tags ?? []).map((t) => t.toLowerCase());
    const hasAny = wantTags.some((w) =>
      haveTags.some((h) => h === w || h.includes(w) || w.includes(h))
    );
    if (!hasAny) return false;
  }

  if (conditions.titleContains?.trim()) {
    const want = conditions.titleContains.trim().toLowerCase();
    const have = (p.title ?? "").toLowerCase();
    if (!have.includes(want)) return false;
  }

  return true;
}

export type InventoryResetResult = {
  ok: boolean;
  locations: number;
  variantsScanned: number;
  inventoryAdjustCalls: number;
  inventoryAdjustUserErrors: number;
  inventoryAdjustIgnoredNotStockedErrors: number;
  policyUpdateCalls: number;
  policyUpdatedVariants: number;
  policyUpdateUserErrors: number;
  sampleErrors: Array<{ scope: string; message: string; code?: string }>;
};

export type InventoryResetProgressUpdate = {
  currentTitle: string;
  variantsScanned: number;
  policyUpdatedVariants: number;
  done: boolean;
  result?: InventoryResetResult;
};

export async function getAllLocationIds(
  admin: { graphql: AdminGraphQL },
  includeLegacy: boolean
): Promise<string[]> {
  const locationIds: string[] = [];
  let after: string | null = null;

  while (true) {
    const data = await graphqlJson<{
      locations: {
        nodes: Array<{ id: string; name: string }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      };
    }>(
      admin,
      `#graphql
        query InventoryResetLocations($after: String, $includeLegacy: Boolean!) {
          locations(first: 250, after: $after, includeLegacy: $includeLegacy) {
            nodes { id name }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after, includeLegacy }
    );

    for (const loc of data.locations.nodes) locationIds.push(loc.id);
    if (!data.locations.pageInfo.hasNextPage) break;
    after = data.locations.pageInfo.endCursor || null;
  }

  return locationIds;
}

export async function* runInventoryResetStreaming({
  admin,
  locationIds,
  conditions,
}: {
  admin: { graphql: AdminGraphQL };
  locationIds: string[];
  conditions?: InventoryResetConditions | null;
}): AsyncGenerator<InventoryResetProgressUpdate> {
  const result: InventoryResetResult = {
    ok: true,
    locations: locationIds.length,
    variantsScanned: 0,
    inventoryAdjustCalls: 0,
    inventoryAdjustUserErrors: 0,
    inventoryAdjustIgnoredNotStockedErrors: 0,
    policyUpdateCalls: 0,
    policyUpdatedVariants: 0,
    policyUpdateUserErrors: 0,
    sampleErrors: [],
  };

  let after: string | null = null;
  const hasConditions = Boolean(
    conditions &&
      (conditions.vendor?.trim() ||
        conditions.tags?.trim() ||
        conditions.titleContains?.trim())
  );

  while (true) {
    const data = await graphqlJson<{
      productVariants: {
        nodes: Array<{
          id: string;
          inventoryPolicy: "CONTINUE" | "DENY";
          product: {
            id: string;
            title: string;
            vendor?: string | null;
            tags?: string[] | null;
          };
          inventoryItem?: { id: string; tracked: boolean } | null;
        }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      };
    }>(
      admin,
      `#graphql
        query InventoryResetVariants($after: String) {
          productVariants(first: 250, after: $after) {
            nodes {
              id
              inventoryPolicy
              product { id title vendor tags }
              inventoryItem { id tracked }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after }
    );

    const allVariants = data.productVariants.nodes;
    const variants = hasConditions
      ? allVariants.filter((v) =>
          productMatchesConditions(v.product, conditions!)
        )
      : allVariants;

    result.variantsScanned += allVariants.length;

    const firstProductTitle = variants[0]?.product?.title ?? allVariants[0]?.product?.title ?? "variants";
    yield {
      currentTitle: `Scanning: ${firstProductTitle}`,
      variantsScanned: result.variantsScanned,
      policyUpdatedVariants: result.policyUpdatedVariants,
      done: false,
    };

    const inventoryItemIds: string[] = [];
    const policyByProduct = new Map<
      string,
      { title: string; variants: Array<{ id: string }> }
    >();

    for (const v of variants) {
      if (v.inventoryPolicy !== "DENY") {
        const existing = policyByProduct.get(v.product.id);
        if (existing) {
          existing.variants.push({ id: v.id });
        } else {
          policyByProduct.set(v.product.id, {
            title: v.product.title,
            variants: [{ id: v.id }],
          });
        }
      }

      if (v.inventoryItem?.id && v.inventoryItem.tracked) {
        inventoryItemIds.push(v.inventoryItem.id);
      }
    }

    const uniqueInventoryItemIds = Array.from(new Set(inventoryItemIds));
    const changes = await getInventoryZeroingChanges({
      admin,
      inventoryItemIds: uniqueInventoryItemIds,
      allowedLocationIds: new Set(locationIds),
    });

    for (const chunk of chunkArray(changes, 250)) {
      const inv = await inventoryAdjustQuantitiesWithReasonFallback(admin, {
        name: "available",
        changes: chunk,
      });

      result.inventoryAdjustCalls += 1;
      const errors = inv.inventoryAdjustQuantities.userErrors || [];
      for (const e of errors) {
        if (e.code === "ITEM_NOT_STOCKED_AT_LOCATION") {
          result.inventoryAdjustIgnoredNotStockedErrors += 1;
          continue;
        }
        result.ok = false;
        result.inventoryAdjustUserErrors += 1;
        if (result.sampleErrors.length < 25) {
          result.sampleErrors.push({
            scope: "inventoryAdjustQuantities",
            message: e.message,
            code: e.code || undefined,
          });
        }
      }
    }

    for (const [productId, { title, variants: variantsForProduct }] of policyByProduct.entries()) {
      for (const chunk of chunkArray(variantsForProduct, 250)) {
        yield {
          currentTitle: title,
          variantsScanned: result.variantsScanned,
          policyUpdatedVariants: result.policyUpdatedVariants,
          done: false,
        };

        const res = await graphqlJson<{
          productVariantsBulkUpdate: {
            productVariants?: Array<{ id: string; inventoryPolicy: string }>;
            userErrors: Array<{ message: string; code?: string | null }>;
          };
        }>(
          admin,
          `#graphql
            mutation InventoryResetDenyPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
              productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants { id inventoryPolicy }
                userErrors { message code }
              }
            }`,
          {
            productId,
            variants: chunk.map((v) => ({ id: v.id, inventoryPolicy: "DENY" })),
          }
        );

        result.policyUpdateCalls += 1;
        result.policyUpdatedVariants += chunk.length;

        const errors = res.productVariantsBulkUpdate.userErrors || [];
        for (const e of errors) {
          result.ok = false;
          result.policyUpdateUserErrors += 1;
          if (result.sampleErrors.length < 25) {
            result.sampleErrors.push({
              scope: "productVariantsBulkUpdate",
              message: e.message,
              code: e.code || undefined,
            });
          }
        }
      }
    }

    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor || null;
  }

  yield {
    currentTitle: "",
    variantsScanned: result.variantsScanned,
    policyUpdatedVariants: result.policyUpdatedVariants,
    done: true,
    result,
  };
}

export async function runInventoryReset({
  admin,
  locationIds,
  conditions,
}: {
  admin: { graphql: AdminGraphQL };
  locationIds: string[];
  conditions?: InventoryResetConditions | null;
}): Promise<InventoryResetResult> {
  let lastResult: InventoryResetResult | undefined;
  for await (const update of runInventoryResetStreaming({
    admin,
    locationIds,
    conditions,
  })) {
    if (update.done && update.result) {
      lastResult = update.result;
    }
  }
  if (!lastResult) {
    throw new Error("Inventory reset did not complete");
  }
  return lastResult;
}

async function inventoryAdjustQuantitiesWithReasonFallback(
  admin: { graphql: AdminGraphQL },
  input: { name: "available" | "on_hand"; changes: InventoryChangeInputLike[] }
) {
  const reasonFallbacks = ["correction", "cycle_count", "other"];
  let lastResponse: {
    inventoryAdjustQuantities: {
      inventoryAdjustmentGroup?: { id: string } | null;
      userErrors: Array<{ message: string; code?: string | null }>;
    };
  } | null = null;

  for (const reason of reasonFallbacks) {
    const inv = await graphqlJson<{
      inventoryAdjustQuantities: {
        inventoryAdjustmentGroup?: { id: string } | null;
        userErrors: Array<{ message: string; code?: string | null }>;
      };
    }>(
      admin,
      `#graphql
        mutation InventoryResetAdjustQuantities($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
          inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
            inventoryAdjustmentGroup { id }
            userErrors { message code }
          }
        }`,
      {
        input: {
          name: input.name,
          reason,
          changes: input.changes,
        },
        idempotencyKey: randomUUID(),
      }
    );

    lastResponse = inv;
    const hasInvalidReason = (
      inv.inventoryAdjustQuantities.userErrors || []
    ).some((e) => e.code === "INVALID_REASON");
    if (!hasInvalidReason) return inv;
  }

  return lastResponse!;
}

async function getInventoryZeroingChanges({
  admin,
  inventoryItemIds,
  allowedLocationIds,
}: {
  admin: { graphql: AdminGraphQL };
  inventoryItemIds: string[];
  allowedLocationIds: Set<string>;
}): Promise<InventoryChangeInputLike[]> {
  const changes: InventoryChangeInputLike[] = [];

  for (const chunk of chunkArray(inventoryItemIds, 50)) {
    const data = await graphqlJson<{
      nodes: Array<
        | {
            __typename: "InventoryItem";
            id: string;
            inventoryLevels: {
              nodes: Array<{
                location: { id: string };
                quantities: Array<{ name: string; quantity: number }>;
              }>;
            };
          }
        | { __typename: string }
        | null
      >;
    }>(
      admin,
      `#graphql
        query InventoryResetInventoryLevels($ids: [ID!]!) {
          nodes(ids: $ids) {
            __typename
            ... on InventoryItem {
              id
              inventoryLevels(first: 250) {
                nodes {
                  location { id }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }`,
      { ids: chunk }
    );

    for (const node of data.nodes) {
      if (!node || node.__typename !== "InventoryItem") continue;
      for (const level of node.inventoryLevels.nodes) {
        if (!allowedLocationIds.has(level.location.id)) continue;
        const available = level.quantities.find((q) => q.name === "available");
        if (!available) continue;
        if (available.quantity === 0) continue;
        changes.push({
          inventoryItemId: node.id,
          locationId: level.location.id,
          delta: -available.quantity,
        });
      }
    }
  }

  return changes;
}

async function graphqlJson<T>(
  admin: { graphql: AdminGraphQL },
  query: string,
  variables: Record<string, unknown>
) {
  const response = await admin.graphql(query, { variables });
  const body = (await response.json()) as { data?: T; errors?: unknown };

  if (!body.data) {
    throw new Error(
      `Shopify GraphQL request failed: ${JSON.stringify(body.errors || body)}`
    );
  }

  return body.data;
}

function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += chunkSize) {
    out.push(arr.slice(i, i + chunkSize));
  }
  return out;
}

type InventoryChangeInputLike = {
  inventoryItemId: string;
  locationId: string;
  delta: number;
};
