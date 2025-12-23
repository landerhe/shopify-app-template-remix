import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  Modal,
  Page,
  Text,
  Banner,
  List,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type InventoryResetResult = {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "run") {
    return json<InventoryResetResult>(
      {
        ok: false,
        locations: 0,
        variantsScanned: 0,
        inventoryAdjustCalls: 0,
        inventoryAdjustUserErrors: 0,
        inventoryAdjustIgnoredNotStockedErrors: 0,
        policyUpdateCalls: 0,
        policyUpdatedVariants: 0,
        policyUpdateUserErrors: 0,
        sampleErrors: [{ scope: "request", message: "Invalid intent" }],
      },
      { status: 400 },
    );
  }

  const locations = await getAllLocationIds(admin);
  const result = await runInventoryReset({
    admin,
    locationIds: locations,
  });

  return json<InventoryResetResult>(result);
};

export default function InventoryResetRoute() {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isRunning =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const result = fetcher.data;
  const hasResult = Boolean(result);

  const errorList = useMemo(() => {
    if (!result?.sampleErrors?.length) return [];
    return result.sampleErrors.slice(0, 10);
  }, [result]);

  const onRun = () => {
    setConfirmOpen(false);
    fetcher.submit({ intent: "run" }, { method: "post" });
    shopify.toast.show("Running inventory reset…");
  };

  return (
    <Page>
      <TitleBar title="Inventory reset" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {hasResult && result.ok && (
              <Banner title="Done" tone="success">
                <Text as="p" variant="bodyMd">
                  Updated inventory across all locations and ensured variants
                  don’t continue selling when out of stock.
                </Text>
              </Banner>
            )}
            {hasResult && !result.ok && (
              <Banner title="Some updates failed" tone="critical">
                <Text as="p" variant="bodyMd">
                  The job finished, but Shopify returned errors for some items.
                  Check the samples below.
                </Text>
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  One-click action
                </Text>
                <Text as="p" variant="bodyMd">
                  This will set <Text as="span" fontWeight="semibold">available</Text>{" "}
                  inventory to <Text as="span" fontWeight="semibold">0</Text>{" "}
                  for every variant at every location, and set “Continue selling
                  when out of stock” to <Text as="span" fontWeight="semibold">off</Text>{" "}
                  (inventory policy <Text as="span" fontWeight="semibold">DENY</Text>).
                </Text>
                <Banner tone="warning" title="Be careful">
                  <List>
                    <List.Item>
                      This affects <Text as="span" fontWeight="semibold">all</Text>{" "}
                      products in the store.
                    </List.Item>
                    <List.Item>
                      For stores with lots of products, this can take several
                      minutes and may hit Shopify API limits.
                    </List.Item>
                  </List>
                </Banner>

                <InlineStack gap="300" align="end">
                  <Button
                    tone="critical"
                    variant="primary"
                    loading={isRunning}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Set all inventory to 0
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {hasResult && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Summary
                  </Text>
                  <Divider />
                  <List type="bullet">
                    <List.Item>Locations: {result.locations}</List.Item>
                    <List.Item>Variants scanned: {result.variantsScanned}</List.Item>
                    <List.Item>
                      Inventory adjust calls: {result.inventoryAdjustCalls}
                    </List.Item>
                    <List.Item>
                      Inventory adjust user errors: {result.inventoryAdjustUserErrors}
                      {result.inventoryAdjustIgnoredNotStockedErrors > 0
                        ? ` (ignored not-stocked-at-location: ${result.inventoryAdjustIgnoredNotStockedErrors})`
                        : ""}
                    </List.Item>
                    <List.Item>
                      Policy update calls: {result.policyUpdateCalls}
                    </List.Item>
                    <List.Item>
                      Variants switched to DENY: {result.policyUpdatedVariants}
                    </List.Item>
                    <List.Item>
                      Policy update user errors: {result.policyUpdateUserErrors}
                    </List.Item>
                  </List>

                  {errorList.length > 0 && (
                    <>
                      <Divider />
                      <Text as="h3" variant="headingSm">
                        Sample errors
                      </Text>
                      <List type="bullet">
                        {errorList.map((e, idx) => (
                          <List.Item key={`${e.scope}-${idx}`}>
                            {e.scope}: {e.message}
                            {e.code ? ` (${e.code})` : ""}
                          </List.Item>
                        ))}
                      </List>
                    </>
                  )}
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm inventory reset"
        primaryAction={{
          content: "Yes, set all inventory to 0",
          destructive: true,
          onAction: onRun,
          loading: isRunning,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmOpen(false),
            disabled: isRunning,
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              This will update every variant in the store. This can’t be undone
              automatically.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

async function getAllLocationIds(admin: { graphql: Function }) {
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
        query InventoryResetLocations($after: String) {
          locations(first: 250, after: $after) {
            nodes { id name }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after },
    );

    for (const loc of data.locations.nodes) locationIds.push(loc.id);
    if (!data.locations.pageInfo.hasNextPage) break;
    after = data.locations.pageInfo.endCursor || null;
  }

  return locationIds;
}

async function runInventoryReset({
  admin,
  locationIds,
}: {
  admin: { graphql: Function };
  locationIds: string[];
}): Promise<InventoryResetResult> {
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

  while (true) {
    const data = await graphqlJson<{
      productVariants: {
        nodes: Array<{
          id: string;
          inventoryPolicy: "CONTINUE" | "DENY";
          product: { id: string };
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
              product { id }
              inventoryItem { id tracked }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after },
    );

    const variants = data.productVariants.nodes;
    result.variantsScanned += variants.length;

    const inventoryItemIds: string[] = [];

    const policyByProduct = new Map<string, Array<{ id: string }>>();

    for (const v of variants) {
      if (v.inventoryPolicy !== "DENY") {
        const list = policyByProduct.get(v.product.id) || [];
        list.push({ id: v.id });
        policyByProduct.set(v.product.id, list);
      }

      if (v.inventoryItem?.id) {
        // Skip variants that don't track inventory; there won't be inventory levels to adjust.
        if (v.inventoryItem.tracked) {
          inventoryItemIds.push(v.inventoryItem.id);
        }
      }
    }

    // 1) Set inventory quantities to 0 by adjusting current available quantities down to 0.
    // This avoids compare-and-set requirements some shops enforce on inventorySetQuantities.
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

    // 2) Ensure variants don't continue selling when out of stock (batched by product).
    for (const [productId, variantsForProduct] of policyByProduct.entries()) {
      for (const chunk of chunkArray(variantsForProduct, 250)) {
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
          },
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

  return result;
}

async function inventoryAdjustQuantitiesWithReasonFallback(
  admin: { graphql: Function },
  input: { name: "available" | "on_hand"; changes: InventoryChangeInputLike[] },
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
        mutation InventoryResetAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
          inventoryAdjustQuantities(input: $input) {
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
      },
    );

    lastResponse = inv;
    const hasInvalidReason = (inv.inventoryAdjustQuantities.userErrors || []).some(
      (e) => e.code === "INVALID_REASON",
    );
    if (!hasInvalidReason) return inv;
  }

  return lastResponse!;
}

async function getInventoryZeroingChanges({
  admin,
  inventoryItemIds,
  allowedLocationIds,
}: {
  admin: { graphql: Function };
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
      { ids: chunk },
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
  admin: { graphql: Function },
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await admin.graphql(query, { variables });
  const body = (await response.json()) as { data?: T; errors?: unknown };

  if (!body.data) {
    throw new Error(
      `Shopify GraphQL request failed: ${JSON.stringify(body.errors || body)}`,
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


