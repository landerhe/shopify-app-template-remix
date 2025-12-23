import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
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
  Banner,
  Divider,
  Modal,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "archivePeruzzo") {
    const result = await archiveProductsByVendor(admin, { vendor: "Peruzzo" });
    return json<ArchivePeruzzoActionData>({ intent, ...result });
  }

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
  const generateFetcher = useFetcher<typeof action>();
  const archiveFetcher = useFetcher<typeof action>();

  const shopify = useAppBridge();
  const isGenerating =
    ["loading", "submitting"].includes(generateFetcher.state) &&
    generateFetcher.formMethod === "POST";

  const isArchiving =
    ["loading", "submitting"].includes(archiveFetcher.state) &&
    archiveFetcher.formMethod === "POST";

  const productId =
    generateFetcher.data && "product" in generateFetcher.data
      ? generateFetcher.data.product?.id.replace("gid://shopify/Product/", "")
      : undefined;

  useEffect(() => {
    if (productId) {
      shopify.toast.show("Product created");
    }
  }, [productId, shopify]);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const archiveResult = useMemo(() => {
    if (!archiveFetcher.data) return null;
    if ("ok" in archiveFetcher.data) return archiveFetcher.data;
    return null;
  }, [archiveFetcher.data]);

  useEffect(() => {
    if (!archiveResult) return;
    if (archiveResult.ok) shopify.toast.show("Archiving complete");
    else shopify.toast.show("Archiving finished with errors");
  }, [archiveResult, shopify]);

  const generateProduct = () =>
    generateFetcher.submit({ intent: "generateProduct" }, { method: "POST" });

  const archivePeruzzo = () => {
    setConfirmOpen(false);
    archiveFetcher.submit({ intent: "archivePeruzzo" }, { method: "POST" });
    shopify.toast.show("Archiving Peruzzo products…");
  };

  return (
    <Page>
      <TitleBar title="Remix app template">
        <button variant="primary" onClick={generateProduct}>
          Generate a product
        </button>
      </TitleBar>
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Congrats on creating a new Shopify app 🎉
                  </Text>
                  <Text variant="bodyMd" as="p">
                    This embedded app template uses{" "}
                    <Link
                      url="https://shopify.dev/docs/apps/tools/app-bridge"
                      target="_blank"
                      removeUnderline
                    >
                      App Bridge
                    </Link>{" "}
                    interface examples like an{" "}
                    <Link url="/app/additional" removeUnderline>
                      additional page in the app nav
                    </Link>
                    , as well as an{" "}
                    <Link
                      url="https://shopify.dev/docs/api/admin-graphql"
                      target="_blank"
                      removeUnderline
                    >
                      Admin GraphQL
                    </Link>{" "}
                    mutation demo, to provide a starting point for app
                    development.
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
                  {generateFetcher.data &&
                    "product" in generateFetcher.data &&
                    generateFetcher.data.product && (
                    <Button
                      url={`shopify:admin/products/${productId}`}
                      target="_blank"
                      variant="plain"
                    >
                      View product
                    </Button>
                  )}
                </InlineStack>
                {generateFetcher.data &&
                  "product" in generateFetcher.data &&
                  generateFetcher.data.product && (
                  <>
                    <Text as="h3" variant="headingMd">
                      {" "}
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
                        <code>
                          {JSON.stringify(generateFetcher.data.product, null, 2)}
                        </code>
                      </pre>
                    </Box>
                    <Text as="h3" variant="headingMd">
                      {" "}
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
                        <code>
                          {JSON.stringify(generateFetcher.data.variant, null, 2)}
                        </code>
                      </pre>
                    </Box>
                  </>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                {archiveResult && archiveResult.ok && (
                  <Banner title="Done" tone="success">
                    <Text as="p" variant="bodyMd">
                      Archived {archiveResult.archived} product
                      {archiveResult.archived === 1 ? "" : "s"} (vendor:{" "}
                      <Text as="span" fontWeight="semibold">
                        Peruzzo
                      </Text>
                      ).
                    </Text>
                  </Banner>
                )}

                {archiveResult && !archiveResult.ok && (
                  <Banner title="Some products could not be archived" tone="critical">
                    <Text as="p" variant="bodyMd">
                      The job finished, but Shopify returned errors for some
                      products. Review the sample errors below.
                    </Text>
                  </Banner>
                )}

                <Text as="h2" variant="headingMd">
                  Archive products by vendor
                </Text>

                <Text as="p" variant="bodyMd">
                  This will archive every product where vendor is{" "}
                  <Text as="span" fontWeight="semibold">
                    Peruzzo
                  </Text>
                  .
                </Text>

                <Banner tone="warning" title="Be careful">
                  <List>
                    <List.Item>
                      Archiving changes product visibility and sales channels.
                    </List.Item>
                    <List.Item>
                      For stores with lots of matching products, this can take a
                      while and may hit Shopify API limits.
                    </List.Item>
                  </List>
                </Banner>

                <InlineStack gap="300" align="end">
                  <Button
                    tone="critical"
                    variant="primary"
                    loading={isArchiving}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Archive Peruzzo products
                  </Button>
                </InlineStack>

                {archiveResult && (
                  <>
                    <Divider />
                    <Text as="h3" variant="headingSm">
                      Summary
                    </Text>
                    <List type="bullet">
                      <List.Item>Products scanned: {archiveResult.scanned}</List.Item>
                      <List.Item>Archived: {archiveResult.archived}</List.Item>
                      <List.Item>
                        Already archived: {archiveResult.alreadyArchived}
                      </List.Item>
                      <List.Item>
                        Shopify user errors: {archiveResult.userErrors}
                      </List.Item>
                    </List>

                    {archiveResult.sampleErrors.length > 0 && (
                      <>
                        <Divider />
                        <Text as="h3" variant="headingSm">
                          Sample errors
                        </Text>
                        <List type="bullet">
                          {archiveResult.sampleErrors.slice(0, 10).map((e, idx) => (
                            <List.Item key={`${e.scope}-${idx}`}>
                              {e.scope}: {e.message}
                              {e.code ? ` (${e.code})` : ""}
                            </List.Item>
                          ))}
                        </List>
                      </>
                    )}
                  </>
                )}
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

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Archive all Peruzzo products?"
        primaryAction={{
          content: "Yes, archive them",
          destructive: true,
          onAction: archivePeruzzo,
          loading: isArchiving,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmOpen(false),
            disabled: isArchiving,
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This will archive every product with vendor “Peruzzo”. You can
            unarchive later, but this action may impact storefront visibility
            immediately.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

type GenerateProductActionData = {
  intent: "generateProduct";
  product: unknown;
  variant: unknown;
};

type ArchivePeruzzoActionData = ArchivePeruzzoResult & {
  intent: "archivePeruzzo";
};

type ErrorActionData = {
  intent: "error";
  message: string;
};

type ArchivePeruzzoResult = {
  ok: boolean;
  scanned: number;
  archived: number;
  alreadyArchived: number;
  userErrors: number;
  sampleErrors: Array<{ scope: string; message: string; code?: string }>;
};

async function archiveProductsByVendor(
  admin: { graphql: Function },
  { vendor }: { vendor: string },
): Promise<ArchivePeruzzoResult> {
  const result: ArchivePeruzzoResult = {
    ok: true,
    scanned: 0,
    archived: 0,
    alreadyArchived: 0,
    userErrors: 0,
    sampleErrors: [],
  };

  const queryString = `vendor:${vendor}`;
  let after: string | null = null;

  while (true) {
    const data = await graphqlJson<{
      products: {
        nodes: Array<{ id: string; status: string }>;
        pageInfo: { hasNextPage: boolean; endCursor?: string | null };
      };
    }>(
      admin,
      `#graphql
        query ProductsByVendor($after: String, $query: String!) {
          products(first: 250, after: $after, query: $query) {
            nodes { id status }
            pageInfo { hasNextPage endCursor }
          }
        }`,
      { after, query: queryString },
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
          userErrors: Array<{ message: string; code?: string | null }>;
        };
      }>(
        admin,
        `#graphql
          mutation ArchiveProduct($id: ID!) {
            productUpdate(input: { id: $id, status: ARCHIVED }) {
              product { id status }
              userErrors { message code }
            }
          }`,
        { id: p.id },
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
              code: e.code || undefined,
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
