/**
 * Lightweight inventory metrics for the homepage.
 * Used to satisfy Built for Shopify requirement: "Expose key metrics that are
 * helpful for merchants on the app's home page."
 */

type AdminGraphQL = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

export type HomepageInventoryMetrics = {
  hasProducts: boolean;
  hasLocations: boolean;
  totalProducts: number;
  hasMoreProducts: boolean;
  totalVariants: number;
  hasMoreVariants: boolean;
  variantsWithContinuePolicy: number;
  setupComplete: boolean;
};

export async function getHomepageInventoryMetrics(
  admin: { graphql: AdminGraphQL }
): Promise<HomepageInventoryMetrics> {
  const result: HomepageInventoryMetrics = {
    hasProducts: false,
    hasLocations: false,
    totalProducts: 0,
    hasMoreProducts: false,
    totalVariants: 0,
    hasMoreVariants: false,
    variantsWithContinuePolicy: 0,
    setupComplete: false,
  };

  try {
    // Check if store has products and get approximate counts
    const productsData = await graphqlJson<{
      products: {
        nodes: Array<{ id: string }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(
      admin,
      `#graphql
        query HomepageProducts($first: Int!) {
          products(first: $first) {
            nodes { id }
            pageInfo { hasNextPage }
          }
        }`,
      { first: 250 }
    );

    result.hasProducts = productsData.products.nodes.length > 0;
    result.totalProducts = productsData.products.nodes.length;
    result.hasMoreProducts = productsData.products.pageInfo.hasNextPage;

    // Check if store has locations
    const locationsData = await graphqlJson<{
      locations: {
        nodes: Array<{ id: string }>;
      };
    }>(
      admin,
      `#graphql
        query HomepageLocations {
          locations(first: 1) {
            nodes { id }
          }
        }`
    );

    result.hasLocations = locationsData.locations.nodes.length > 0;

    // Sample variants to count those with CONTINUE policy (need attention)
    const variantsData = await graphqlJson<{
      productVariants: {
        nodes: Array<{ id: string; inventoryPolicy: string }>;
        pageInfo: { hasNextPage: boolean };
      };
    }>(
      admin,
      `#graphql
        query HomepageVariants($first: Int!) {
          productVariants(first: $first) {
            nodes {
              id
              inventoryPolicy
            }
            pageInfo { hasNextPage }
          }
        }`,
      { first: 500 }
    );

    const variants = variantsData.productVariants.nodes;
    result.totalVariants = variants.length;
    result.hasMoreVariants = variantsData.productVariants.pageInfo.hasNextPage;
    result.variantsWithContinuePolicy = variants.filter(
      (v) => v.inventoryPolicy === "CONTINUE"
    ).length;

    result.setupComplete = result.hasProducts && result.hasLocations;
  } catch {
    // If any query fails, return minimal metrics
  }

  return result;
}

async function graphqlJson<T>(
  admin: { graphql: AdminGraphQL },
  query: string,
  variables?: Record<string, unknown>
) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const body = (await response.json()) as { data?: T; errors?: unknown };

  if (!body.data) {
    throw new Error(
      `Shopify GraphQL request failed: ${JSON.stringify(body.errors || body)}`
    );
  }

  return body.data;
}
