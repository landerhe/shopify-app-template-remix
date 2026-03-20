/**
 * Bulk archive products by conditions (vendor, tags, title contains).
 * Fetches all products and filters in-memory (Shopify's product search index
 * is unreliable and often returns 0 results for vendor/tag/title queries).
 */

type AdminGraphQL = (
  query: string,
  options?: { variables?: Record<string, unknown> }
) => Promise<Response>;

export type ArchiveConditions = {
  vendor?: string;
  tags?: string;
  titleContains?: string;
};

export type ArchiveResult = {
  ok: boolean;
  scanned: number;
  archived: number;
  alreadyArchived: number;
  userErrors: number;
  sampleErrors: Array<{
    scope: string;
    message: string;
    field?: string[];
  }>;
};

export type UnarchiveResult = {
  ok: boolean;
  scanned: number;
  activated: number;
  alreadyActive: number;
  userErrors: number;
  sampleErrors: Array<{
    scope: string;
    message: string;
    field?: string[];
  }>;
};

type ProductNode = {
  id: string;
  status: string;
  vendor?: string | null;
  tags?: string[] | null;
  title?: string | null;
};

/**
 * Check if a product matches the given conditions (case-insensitive).
 */
function productMatchesConditions(
  p: ProductNode,
  conditions: ArchiveConditions
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

/**
 * Archive all products matching the given conditions.
 * When conditions is null, archives all products.
 * Otherwise fetches all products and filters in-memory for reliability.
 */
export async function archiveProductsByQuery(
  admin: { graphql: AdminGraphQL },
  {
    query,
    conditions,
  }: { query: string | null; conditions?: ArchiveConditions }
): Promise<ArchiveResult> {
  const result: ArchiveResult = {
    ok: true,
    scanned: 0,
    archived: 0,
    alreadyArchived: 0,
    userErrors: 0,
    sampleErrors: [],
  };

  let after: string | null = null;
  const hasConditions = Boolean(
    conditions &&
      (conditions.vendor?.trim() ||
        conditions.tags?.trim() ||
        conditions.titleContains?.trim())
  );

  type ProductsQueryResult = {
    products: {
      nodes: ProductNode[];
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  };

  while (true) {
    const data: ProductsQueryResult = await graphqlJson<ProductsQueryResult>(
      admin,
      `#graphql
        query ProductsForArchive($after: String) {
          products(first: 250, after: $after) {
            nodes { id status vendor tags title }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after }
    );

    for (const p of data.products.nodes) {
      if (hasConditions && !productMatchesConditions(p, conditions!)) {
        continue;
      }
      result.scanned += 1;

      if (p.status === "ARCHIVED") {
        result.alreadyArchived += 1;
        continue;
      }

      const res = await graphqlJson<{
        productUpdate: {
          product?: { id: string; status: string } | null;
          userErrors: Array<{ message: string; field?: string[] | null }>;
        };
      }>(
        admin,
        `#graphql
          mutation ArchiveProduct($id: ID!) {
            productUpdate(product: { id: $id, status: ARCHIVED }) {
              product { id status }
              userErrors { message field }
            }
          }`,
        { id: p.id }
      );

      const errors = res.productUpdate.userErrors || [];
      if (errors.length > 0) {
        result.ok = false;
        result.userErrors += errors.length;
        for (const e of errors) {
          if (result.sampleErrors.length < 25) {
            result.sampleErrors.push({
              scope: "productUpdate",
              message: e.message,
              field: e.field || undefined,
            });
          }
        }
        continue;
      }

      result.archived += 1;
    }

    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor || null;
  }

  return result;
}

/**
 * Unarchive (set active) all products matching the given conditions.
 * When conditions is null, unarchives all products.
 * Only processes products that are currently ARCHIVED.
 */
export async function unarchiveProductsByQuery(
  admin: { graphql: AdminGraphQL },
  {
    query,
    conditions,
  }: { query: string | null; conditions?: ArchiveConditions }
): Promise<UnarchiveResult> {
  const result: UnarchiveResult = {
    ok: true,
    scanned: 0,
    activated: 0,
    alreadyActive: 0,
    userErrors: 0,
    sampleErrors: [],
  };

  let after: string | null = null;
  const hasConditions = Boolean(
    conditions &&
      (conditions.vendor?.trim() ||
        conditions.tags?.trim() ||
        conditions.titleContains?.trim())
  );

  type ProductsQueryResult = {
    products: {
      nodes: ProductNode[];
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  };

  while (true) {
    const data: ProductsQueryResult = await graphqlJson<ProductsQueryResult>(
      admin,
      `#graphql
        query ProductsForUnarchive($after: String) {
          products(first: 250, after: $after) {
            nodes { id status vendor tags title }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after }
    );

    for (const p of data.products.nodes) {
      if (p.status !== "ARCHIVED") continue;
      if (hasConditions && !productMatchesConditions(p, conditions!)) {
        continue;
      }
      result.scanned += 1;

      const res = await graphqlJson<{
        productUpdate: {
          product?: { id: string; status: string } | null;
          userErrors: Array<{ message: string; field?: string[] | null }>;
        };
      }>(
        admin,
        `#graphql
          mutation UnarchiveProduct($id: ID!) {
            productUpdate(product: { id: $id, status: ACTIVE }) {
              product { id status }
              userErrors { message field }
            }
          }`,
        { id: p.id }
      );

      const errors = res.productUpdate.userErrors || [];
      if (errors.length > 0) {
        result.ok = false;
        result.userErrors += errors.length;
        for (const e of errors) {
          if (result.sampleErrors.length < 25) {
            result.sampleErrors.push({
              scope: "productUpdate",
              message: e.message,
              field: e.field || undefined,
            });
          }
        }
        continue;
      }

      result.activated += 1;
    }

    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor || null;
  }

  return result;
}

export type ArchiveProgressUpdate = {
  currentTitle: string;
  scanned: number;
  archived: number;
  alreadyArchived: number;
  done: boolean;
  result?: ArchiveResult;
};

/**
 * Archive products with streaming progress updates.
 * Yields progress after each product is processed.
 */
export async function* archiveProductsByQueryStreaming(
  admin: { graphql: AdminGraphQL },
  {
    query,
    conditions,
  }: { query: string | null; conditions?: ArchiveConditions }
): AsyncGenerator<ArchiveProgressUpdate> {
  const result: ArchiveResult = {
    ok: true,
    scanned: 0,
    archived: 0,
    alreadyArchived: 0,
    userErrors: 0,
    sampleErrors: [],
  };

  let after: string | null = null;
  const hasConditions = Boolean(
    conditions &&
      (conditions.vendor?.trim() ||
        conditions.tags?.trim() ||
        conditions.titleContains?.trim())
  );

  type ProductsQueryResult = {
    products: {
      nodes: ProductNode[];
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  };

  while (true) {
    const data: ProductsQueryResult = await graphqlJson<ProductsQueryResult>(
      admin,
      `#graphql
        query ProductsForArchive($after: String) {
          products(first: 250, after: $after) {
            nodes { id status vendor tags title }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after }
    );

    for (const p of data.products.nodes) {
      if (hasConditions && !productMatchesConditions(p, conditions!)) {
        continue;
      }
      result.scanned += 1;

      if (p.status === "ARCHIVED") {
        result.alreadyArchived += 1;
        yield {
          currentTitle: p.title ?? "(untitled)",
          scanned: result.scanned,
          archived: result.archived,
          alreadyArchived: result.alreadyArchived,
          done: false,
        };
        continue;
      }

      const res = await graphqlJson<{
        productUpdate: {
          product?: { id: string; status: string } | null;
          userErrors: Array<{ message: string; field?: string[] | null }>;
        };
      }>(
        admin,
        `#graphql
          mutation ArchiveProduct($id: ID!) {
            productUpdate(product: { id: $id, status: ARCHIVED }) {
              product { id status }
              userErrors { message field }
            }
          }`,
        { id: p.id }
      );

      const errors = res.productUpdate.userErrors || [];
      if (errors.length > 0) {
        result.ok = false;
        result.userErrors += errors.length;
        for (const e of errors) {
          if (result.sampleErrors.length < 25) {
            result.sampleErrors.push({
              scope: "productUpdate",
              message: e.message,
              field: e.field || undefined,
            });
          }
        }
        yield {
          currentTitle: p.title ?? "(untitled)",
          scanned: result.scanned,
          archived: result.archived,
          alreadyArchived: result.alreadyArchived,
          done: false,
        };
        continue;
      }

      result.archived += 1;
      yield {
        currentTitle: p.title ?? "(untitled)",
        scanned: result.scanned,
        archived: result.archived,
        alreadyArchived: result.alreadyArchived,
        done: false,
      };
    }

    if (!data.products.pageInfo.hasNextPage) break;
    after = data.products.pageInfo.endCursor || null;
  }

  yield {
    currentTitle: "",
    scanned: result.scanned,
    archived: result.archived,
    alreadyArchived: result.alreadyArchived,
    done: true,
    result,
  };
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
