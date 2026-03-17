/**
 * Bulk archive products by conditions (vendor, tags, title contains).
 * Uses Shopify product search query syntax.
 * @see https://shopify.dev/docs/api/usage/search-syntax
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

/**
 * Escape special characters for Shopify search syntax.
 * Special chars: : \ ( )
 */
function escapeSearchValue(value: string): string {
  return value.replace(/[\\:()]/g, "\\$&");
}

/**
 * Build a Shopify product search query from conditions.
 * Returns empty string if no conditions provided.
 */
export function buildProductSearchQuery(conditions: ArchiveConditions): string {
  const parts: string[] = [];

  if (conditions.vendor?.trim()) {
    const val = escapeSearchValue(conditions.vendor.trim());
    parts.push(`vendor:${val}`);
  }

  if (conditions.tags?.trim()) {
    const tagList = conditions.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tag of tagList) {
      parts.push(`tag:${escapeSearchValue(tag)}`);
    }
  }

  if (conditions.titleContains?.trim()) {
    const val = conditions.titleContains.trim();
    const escaped = escapeSearchValue(val);
    parts.push(val.includes(" ") ? `title:"${escaped}"` : `title:${escaped}`);
  }

  return parts.join(" ");
}

/**
 * Archive all products matching the given Shopify product search query.
 */
export async function archiveProductsByQuery(
  admin: { graphql: AdminGraphQL },
  { query }: { query: string }
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

  type ProductsQueryResult = {
    products: {
      nodes: Array<{ id: string; status: string }>;
      pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    };
  };

  while (true) {
    const data: ProductsQueryResult = await graphqlJson<ProductsQueryResult>(
      admin,
      `#graphql
        query ProductsByQuery($after: String, $query: String!) {
          products(first: 250, after: $after, query: $query) {
            nodes { id status }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after, query }
    );

    for (const p of data.products.nodes) {
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
            productUpdate(input: { id: $id, status: ARCHIVED }) {
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
