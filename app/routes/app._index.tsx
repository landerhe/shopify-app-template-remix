import { useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Banner,
  Divider,
  List,
  Modal,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  getHomepageInventoryMetrics,
  type HomepageInventoryMetrics,
} from "../utils/inventory-metrics.server";
import {
  scanInventoryPolicies,
  type InventoryPolicyScanResult,
} from "../utils/inventory-scan.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const metrics = await getHomepageInventoryMetrics(admin);
  return json<HomepageInventoryMetrics>(metrics);
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
      { status: 400 }
    );
  }

  const result = await scanInventoryPolicies(admin);
  return json<InventoryPolicyScanResult>(result);
};

export default function Index() {
  const metrics = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const scanFetcher = useFetcher<typeof action>();
  const [confirmScanOpen, setConfirmScanOpen] = useState(false);

  const isScanRunning =
    ["loading", "submitting"].includes(scanFetcher.state) &&
    scanFetcher.formMethod === "POST";

  const scanResult = scanFetcher.data;
  const hasScanResult = Boolean(scanResult && "productsScanned" in scanResult);

  const offenders = useMemo(
    () => (scanResult?.sampleOffenders || []).slice(0, 25),
    [scanResult]
  );

  const formatCount = (count: number, hasMore: boolean) =>
    hasMore ? `${count}+` : String(count);

  const onScan = () => {
    setConfirmScanOpen(false);
    scanFetcher.submit({ intent: "scan" }, { method: "post" });
    shopify.toast.show("Scanning inventory policies…");
  };

  return (
    <Page>
      <TitleBar title="Inventory overview" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap={false}>
                  <Text as="h2" variant="headingMd">
                    Store status
                  </Text>
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
                    Bulk archive / Set active
                  </Button>
                  <Button
                    variant="primary"
                    loading={isScanRunning}
                    onClick={() => setConfirmScanOpen(true)}
                  >
                    Scan inventory policies
                  </Button>
                  <Button url="/app/inventory-reset" tone="critical">
                    Reset inventory
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {hasScanResult && scanResult?.ok && (
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

            {hasScanResult && scanResult && !scanResult.ok && (
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

            {hasScanResult && scanResult && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Scan summary
                  </Text>
                  <Divider />
                  <List type="bullet">
                    <List.Item>
                      Products scanned: {scanResult.productsScanned}
                    </List.Item>
                    <List.Item>
                      Variants scanned: {scanResult.variantsScanned}
                    </List.Item>
                    <List.Item>
                      Products with CONTINUE: {scanResult.productsWithContinue}
                    </List.Item>
                    <List.Item>
                      Variants with CONTINUE: {scanResult.variantsWithContinue}
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
          </Layout.Section>
        </Layout>
      </BlockStack>

      <Modal
        open={confirmScanOpen}
        onClose={() => setConfirmScanOpen(false)}
        title="Scan all products?"
        primaryAction={{
          content: "Scan now",
          onAction: onScan,
          loading: isScanRunning,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmScanOpen(false),
            disabled: isScanRunning,
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This scans every variant in the store and reports any with
            &quot;Continue selling when out of stock&quot; turned on. It may
            take a while on large catalogs.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
