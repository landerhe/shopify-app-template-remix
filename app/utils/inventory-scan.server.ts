type AdminGraphQL = (
  query: string,
  options?: { variables?: Record<string, unknown> }
) => Promise<Response>;

export type InventoryPolicyScanResult = {
  ok: boolean;
  productsScanned: number;
  variantsScanned: number;
  productsWithContinue: number;
  variantsWithContinue: number;
  sampleOffenders: Array<{
    productTitle: string;
    productHandle: string;
    variantTitle: string;
    sku?: string | null;
  }>;
};

export async function scanInventoryPolicies(
  admin: { graphql: AdminGraphQL }
): Promise<InventoryPolicyScanResult> {
  const productIds = new Set<string>();
  const productIdsWithContinue = new Set<string>();

  const result: InventoryPolicyScanResult = {
    ok: true,
    productsScanned: 0,
    variantsScanned: 0,
    productsWithContinue: 0,
    variantsWithContinue: 0,
    sampleOffenders: [],
  };

  let after: string | null = null;

  while (true) {
    const data = await graphqlJson<{
      productVariants: {
        nodes: Array<{
          id: string;
          title: string;
          sku?: string | null;
          inventoryPolicy: "CONTINUE" | "DENY";
          product: { id: string; title: string; handle: string };
        }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      };
    }>(
      admin,
      `#graphql
        query InventoryPolicyScanVariants($after: String) {
          productVariants(first: 250, after: $after) {
            nodes {
              id
              title
              sku
              inventoryPolicy
              product { id title handle }
            }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after }
    );

    const variants = data.productVariants.nodes;
    result.variantsScanned += variants.length;

    for (const v of variants) {
      productIds.add(v.product.id);
      if (v.inventoryPolicy === "CONTINUE") {
        result.ok = false;
        result.variantsWithContinue += 1;
        productIdsWithContinue.add(v.product.id);

        if (result.sampleOffenders.length < 25) {
          result.sampleOffenders.push({
            productTitle: v.product.title,
            productHandle: v.product.handle,
            variantTitle: v.title,
            sku: v.sku ?? null,
          });
        }
      }
    }

    if (!data.productVariants.pageInfo.hasNextPage) break;
    after = data.productVariants.pageInfo.endCursor || null;
  }

  result.productsScanned = productIds.size;
  result.productsWithContinue = productIdsWithContinue.size;

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
