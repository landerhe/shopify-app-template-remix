import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  InlineStack,
  Layout,
  List,
  Modal,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

type InventoryPolicyScanResult = {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "scan") {
    return json<InventoryPolicyScanResult>(
      {
        ok: false,
        productsScanned: 0,
        variantsScanned: 0,
        productsWithContinue: 0,
        variantsWithContinue: 0,
        sampleOffenders: [],
      },
      { status: 400 },
    );
  }

  const result = await scanInventoryPolicies(admin);
  return json<InventoryPolicyScanResult>(result);
};

export default function InventoryScanRoute() {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isRunning =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const result = fetcher.data;
  const hasResult = Boolean(result);

  const offenders = useMemo(
    () => (result?.sampleOffenders || []).slice(0, 25),
    [result],
  );

  const onScan = () => {
    setConfirmOpen(false);
    fetcher.submit({ intent: "scan" }, { method: "post" });
    shopify.toast.show("Scanning inventory policies…");
  };

  return (
    <Page>
      <TitleBar title="Inventory policy scan" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {hasResult && result.ok && (
              <Banner title="All set" tone="success">
                <Text as="p" variant="bodyMd">
                  Every variant is set to{" "}
                  <Text as="span" fontWeight="semibold">
                    DENY
                  </Text>{" "}
                  (does not continue selling when out of stock).
                </Text>
              </Banner>
            )}

            {hasResult && !result.ok && (
              <Banner title="Found variants that continue selling" tone="critical">
                <Text as="p" variant="bodyMd">
                  Some variants are set to{" "}
                  <Text as="span" fontWeight="semibold">
                    CONTINUE
                  </Text>
                  . Run the inventory reset to switch them to DENY.
                </Text>
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Check the whole store
                </Text>
                <Text as="p" variant="bodyMd">
                  This scans all variants and reports any that have “Continue
                  selling when out of stock” turned on (inventory policy{" "}
                  <Text as="span" fontWeight="semibold">
                    CONTINUE
                  </Text>
                  ).
                </Text>
                <Banner tone="warning" title="Heads up">
                  <List>
                    <List.Item>
                      For stores with lots of products, this can take several
                      minutes.
                    </List.Item>
                    <List.Item>
                      This is read-only: it will not change inventory or
                      policies.
                    </List.Item>
                  </List>
                </Banner>

                <InlineStack gap="300" align="end">
                  <Button
                    variant="primary"
                    loading={isRunning}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Scan products
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
                    <List.Item>Products scanned: {result.productsScanned}</List.Item>
                    <List.Item>Variants scanned: {result.variantsScanned}</List.Item>
                    <List.Item>
                      Products with CONTINUE: {result.productsWithContinue}
                    </List.Item>
                    <List.Item>
                      Variants with CONTINUE: {result.variantsWithContinue}
                    </List.Item>
                  </List>

                  {offenders.length > 0 && (
                    <>
                      <Divider />
                      <Text as="h3" variant="headingSm">
                        Sample offenders
                      </Text>
                      <List type="bullet">
                        {offenders.map((o, idx) => (
                          <List.Item key={`${o.productHandle}-${idx}`}>
                            {o.productTitle} — {o.variantTitle}
                            {o.sku ? ` (SKU: ${o.sku})` : ""}
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
        title="Scan all products?"
        primaryAction={{
          content: "Scan now",
          onAction: onScan,
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
          <Text as="p" variant="bodyMd">
            This scans every variant in the store and may take a while on large
            catalogs.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

async function scanInventoryPolicies(admin: { graphql: Function }) {
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
      { after },
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



