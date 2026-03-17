import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getHomepageInventoryMetrics,
  type HomepageInventoryMetrics,
} from "../utils/inventory-metrics.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const metrics = await getHomepageInventoryMetrics(admin);
  return json<HomepageInventoryMetrics>(metrics);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "generateProduct") {
    return json(
      { intent: "error", message: "Invalid intent" } satisfies ErrorActionData,
      { status: 400 },
    );
  }

  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
        },
      },
    },
  );
  const responseJson = await response.json();

  const product = responseJson.data!.productCreate!.product!;
  const variantId = product.variants.edges[0]!.node!.id!;

  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyRemixTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    },
  );

  const variantResponseJson = await variantResponse.json();

  return json<GenerateProductActionData>({
    intent,
    product: responseJson!.data!.productCreate!.product,
    variant:
      variantResponseJson!.data!.productVariantsBulkUpdate!.productVariants,
  });
};

export default function Index() {
  const metrics = useLoaderData<typeof loader>();
  const generateFetcher = useFetcher<typeof action>();

  const shopify = useAppBridge();
  const isGenerating =
    ["loading", "submitting"].includes(generateFetcher.state) &&
    generateFetcher.formMethod === "POST";

  const productId =
    generateFetcher.data && "product" in generateFetcher.data
      ? (generateFetcher.data.product as { id?: string })?.id?.replace(
          "gid://shopify/Product/",
          ""
        )
      : undefined;

  useEffect(() => {
    if (productId) {
      shopify.toast.show("Product created");
    }
  }, [productId, shopify]);

  const generateProduct = () =>
    generateFetcher.submit({ intent: "generateProduct" }, { method: "POST" });

  const formatCount = (count: number, hasMore: boolean) =>
    hasMore ? `${count}+` : String(count);

  const showProductData =
    generateFetcher.data &&
    "product" in generateFetcher.data &&
    Boolean(generateFetcher.data.product);

  return (
    <Page>
      <TitleBar title="Inventory overview">
        <button variant="primary" onClick={generateProduct}>
          Generate a product
        </button>
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">
                    Store status
                  </Text>
                  {metrics.setupComplete ? (
                    <Badge tone="success">Set up</Badge>
                  ) : (
                    <Badge tone="warning">Setup needed</Badge>
                  )}
                </InlineStack>
                <Text variant="bodyMd" as="p">
                  {metrics.setupComplete
                    ? "Your store is configured with products and locations. Use the tools below to manage inventory policies."
                    : "Add products and configure locations in your Shopify admin to get started."}
                </Text>
                <InlineStack gap="600" wrap>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Products
                    </Text>
                    <Text as="span" variant="headingMd">
                      {formatCount(metrics.totalProducts, metrics.hasMoreProducts)}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Variants sampled
                    </Text>
                    <Text as="span" variant="headingMd">
                      {formatCount(metrics.totalVariants, metrics.hasMoreVariants)}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Need attention
                    </Text>
                    <Text as="span" variant="headingMd">
                      {metrics.variantsWithContinuePolicy > 0 ? (
                        <Text as="span" tone="critical">
                          {metrics.variantsWithContinuePolicy} variants
                        </Text>
                      ) : (
                        <Text as="span" tone="success">None</Text>
                      )}
                    </Text>
                  </BlockStack>
                </InlineStack>
                <InlineStack gap="300">
                  <Button url="/app/archive">
                    Bulk archive by conditions
                  </Button>
                  {metrics.variantsWithContinuePolicy > 0 && (
                    <>
                      <Button url="/app/inventory-scan" variant="primary">
                        Scan inventory policies
                      </Button>
                      <Button url="/app/inventory-reset" tone="critical">
                        Reset inventory
                      </Button>
                    </>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Get started with products
                  </Text>
                  <Text variant="bodyMd" as="p">
                    This embedded app uses{" "}
                    <Link
                      url="https://shopify.dev/docs/apps/tools/app-bridge"
                      target="_blank"
                      removeUnderline
                    >
                      App Bridge
                    </Link>{" "}
                    and{" "}
                    <Link
                      url="https://shopify.dev/docs/api/admin-graphql"
                      target="_blank"
                      removeUnderline
                    >
                      Admin GraphQL
                    </Link>
                    . Generate a product to try the API, or use{" "}
                    <Link url="/app/inventory-scan" removeUnderline>
                      Inventory scan
                    </Link>{" "}
                    and{" "}
                    <Link url="/app/inventory-reset" removeUnderline>
                      Inventory reset
                    </Link>{" "}
                    to manage your store.
                  </Text>
                </BlockStack>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Get started with products
                  </Text>
                  <Text as="p" variant="bodyMd">
                    Generate a product with GraphQL and get the JSON output for
                    that product. Learn more about the{" "}
                    <Link
                      url="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate"
                      target="_blank"
                      removeUnderline
                    >
                      productCreate
                    </Link>{" "}
                    mutation in our API references.
                  </Text>
                </BlockStack>
                <InlineStack gap="300">
                  <Button loading={isGenerating} onClick={generateProduct}>
                    Generate a product
                  </Button>
                  {showProductData ? (
                    <Button
                      url={`shopify:admin/products/${productId}`}
                      target="_blank"
                      variant="plain"
                    >
                      View product
                    </Button>
                  ) : null}
                </InlineStack>
                {showProductData &&
                generateFetcher.data &&
                "product" in generateFetcher.data
                  ? (() => {
                      const data = generateFetcher.data as GenerateProductActionData;
                      const productJson = JSON.stringify(
                        data.product ?? {},
                        null,
                        2
                      );
                      const variantJson = JSON.stringify(
                        data.variant ?? {},
                        null,
                        2
                      );
                      return (
                        <>
                          <Text as="h3" variant="headingMd">
                            productCreate mutation
                          </Text>
                          <Box
                            padding="400"
                            background="bg-surface-active"
                            borderWidth="025"
                            borderRadius="200"
                            borderColor="border"
                            overflowX="scroll"
                          >
                            <pre style={{ margin: 0 }}>
                              <code>{productJson}</code>
                            </pre>
                          </Box>
                          <Text as="h3" variant="headingMd">
                            productVariantsBulkUpdate mutation
                          </Text>
                          <Box
                            padding="400"
                            background="bg-surface-active"
                            borderWidth="025"
                            borderRadius="200"
                            borderColor="border"
                            overflowX="scroll"
                          >
                            <pre style={{ margin: 0 }}>
                              <code>{variantJson}</code>
                            </pre>
                          </Box>
                        </>
                      );
                    })()
                  : null}
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    App template specs
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Framework
                      </Text>
                      <Link
                        url="https://remix.run"
                        target="_blank"
                        removeUnderline
                      >
                        Remix
                      </Link>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Database
                      </Text>
                      <Link
                        url="https://www.prisma.io/"
                        target="_blank"
                        removeUnderline
                      >
                        Prisma
                      </Link>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Interface
                      </Text>
                      <span>
                        <Link
                          url="https://polaris.shopify.com"
                          target="_blank"
                          removeUnderline
                        >
                          Polaris
                        </Link>
                        {", "}
                        <Link
                          url="https://shopify.dev/docs/apps/tools/app-bridge"
                          target="_blank"
                          removeUnderline
                        >
                          App Bridge
                        </Link>
                      </span>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        API
                      </Text>
                      <Link
                        url="https://shopify.dev/docs/api/admin-graphql"
                        target="_blank"
                        removeUnderline
                      >
                        GraphQL API
                      </Link>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Next steps
                  </Text>
                  <List>
                    <List.Item>
                      Build an{" "}
                      <Link
                        url="https://shopify.dev/docs/apps/getting-started/build-app-example"
                        target="_blank"
                        removeUnderline
                      >
                        {" "}
                        example app
                      </Link>{" "}
                      to get started
                    </List.Item>
                    <List.Item>
                      Explore Shopify’s API with{" "}
                      <Link
                        url="https://shopify.dev/docs/apps/tools/graphiql-admin-api"
                        target="_blank"
                        removeUnderline
                      >
                        GraphiQL
                      </Link>
                    </List.Item>
                  </List>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

type GenerateProductActionData = {
  intent: "generateProduct";
  product: unknown;
  variant: unknown;
};

type ErrorActionData = {
  intent: "error";
  message: string;
};

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
