import { useCallback, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  FormLayout,
  InlineStack,
  Layout,
  Modal,
  Page,
  ProgressBar,
  Text,
  TextField,
  Banner,
  List,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import type {
  InventoryResetProgressUpdate,
  InventoryResetResult,
} from "../utils/inventory-reset.server";

const PROGRESS_THROTTLE_MS = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function InventoryResetRoute() {
  const shopify = useAppBridge();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [includeAppLocations, setIncludeAppLocations] = useState(false);
  const [resetAll, setResetAll] = useState(true);
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");
  const [titleContains, setTitleContains] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<InventoryResetResult | null>(null);
  const [hasError, setHasError] = useState<string | null>(null);
  const [progress, setProgress] = useState<InventoryResetProgressUpdate | null>(
    null
  );
  const lastProgressUpdate = useRef(0);
  const pendingProgress = useRef<InventoryResetProgressUpdate | null>(null);

  const flushProgress = useCallback(() => {
    if (pendingProgress.current) {
      setProgress(pendingProgress.current);
      pendingProgress.current = null;
    }
  }, []);

  const errorList = result?.sampleErrors?.slice(0, 10) ?? [];

  const hasConditions =
    resetAll ||
    Boolean(vendor.trim() || tags.trim() || titleContains.trim());

  const onRun = useCallback(async () => {
    setConfirmOpen(false);
    setHasError(null);
    setResult(null);
    setProgress(null);
    setIsRunning(true);
    shopify.toast.show("Running inventory reset…");

    const formData = new FormData();
    formData.set("intent", "run");
    formData.set("includeAppLocations", String(includeAppLocations));
    formData.set("resetAll", String(resetAll));
    formData.set("vendor", vendor);
    formData.set("tags", tags);
    formData.set("titleContains", titleContains);

    try {
      const res = await fetch("/app/api/inventory-reset-progress", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setHasError(
          (errData as { message?: string }).message ??
            "Inventory reset request failed"
        );
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setHasError("Streaming not supported");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const update = JSON.parse(line) as InventoryResetProgressUpdate & {
              error?: string;
              message?: string;
            };
            if (update.error) {
              setHasError(update.message ?? update.error);
              return;
            }

            const now = Date.now();
            pendingProgress.current = update;
            if (now - lastProgressUpdate.current >= PROGRESS_THROTTLE_MS) {
              lastProgressUpdate.current = now;
              setProgress(update);
              pendingProgress.current = null;
            }

            if (update.done && update.result) {
              setResult(update.result);
              if (update.result.ok)
                shopify.toast.show("Inventory reset complete");
              else shopify.toast.show("Inventory reset finished with errors");
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      flushProgress();
    } catch (err) {
      setHasError(err instanceof Error ? err.message : "Inventory reset failed");
    } finally {
      setIsRunning(false);
    }
  }, [includeAppLocations, resetAll, vendor, tags, titleContains, shopify, flushProgress]);

  useEffect(() => {
    if (!isRunning && pendingProgress.current) {
      flushProgress();
    }
  }, [isRunning, flushProgress]);

  return (
    <Page backAction={{ content: "Home", url: "/app" }}>
      <TitleBar title="Inventory reset" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {hasError && (
              <Banner
                title="Error"
                tone="critical"
                onDismiss={() => setHasError(null)}
              >
                <Text as="p" variant="bodyMd">
                  {hasError}
                </Text>
              </Banner>
            )}

            {isRunning && progress && (
              <Card>
                <BlockStack gap="300">
                  <ProgressBar progress={75} size="small" tone="primary" />
                  <Text as="p" variant="bodyMd">
                    {progress.currentTitle
                      ? `Processing: ${progress.currentTitle} — ${progress.variantsScanned} variants scanned, ${progress.policyUpdatedVariants} policy updates`
                      : `Resetting inventory… ${progress.variantsScanned} variants scanned`}
                  </Text>
                </BlockStack>
              </Card>
            )}

            {result?.ok && (
              <Banner title="Done" tone="success">
                <Text as="p" variant="bodyMd">
                  Updated inventory across all locations and ensured variants
                  don’t continue selling when out of stock.
                </Text>
              </Banner>
            )}
            {result && !result.ok && (
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
                  Set inventory to 0
                </Text>
                <Text as="p" variant="bodyMd">
                  This will set <Text as="span" fontWeight="semibold">available</Text>{" "}
                  inventory to <Text as="span" fontWeight="semibold">0</Text>{" "}
                  for matching variants at every location, and set “Continue selling
                  when out of stock” to <Text as="span" fontWeight="semibold">off</Text>{" "}
                  (inventory policy <Text as="span" fontWeight="semibold">DENY</Text>).
                </Text>

                <FormLayout>
                  <Checkbox
                    label="Reset all products"
                    checked={resetAll}
                    onChange={setResetAll}
                    disabled={isRunning}
                    helpText="When checked, all products in the store will be reset. When unchecked, use the conditions below to filter."
                  />
                  <TextField
                    label="Vendor"
                    value={vendor}
                    onChange={setVendor}
                    placeholder="e.g. Acme"
                    autoComplete="off"
                    disabled={isRunning || resetAll}
                  />
                  <TextField
                    label="Tags"
                    value={tags}
                    onChange={setTags}
                    placeholder="e.g. sale, clearance"
                    autoComplete="off"
                    disabled={isRunning || resetAll}
                    helpText="Comma-separated list of tags. Products with any listed tag will match."
                  />
                  <TextField
                    label="Title contains"
                    value={titleContains}
                    onChange={setTitleContains}
                    placeholder='e.g. hoodie or "green hoodie"'
                    autoComplete="off"
                    disabled={isRunning || resetAll}
                    helpText="Words or phrase to search in product title."
                  />
                </FormLayout>

                <Checkbox
                  label="Include app/fulfillment service locations"
                  checked={includeAppLocations}
                  onChange={setIncludeAppLocations}
                  disabled={isRunning}
                  helpText="When checked, inventory at locations managed by fulfillment apps (e.g. 3PL, dropshipping) will also be set to 0. Leave unchecked to only update your own warehouse and retail locations."
                />

                <Banner tone="warning" title="Be careful">
                  <List>
                    <List.Item>
                      {resetAll ? (
                        <>This affects <Text as="span" fontWeight="semibold">all</Text> products in the store.</>
                      ) : (
                        <>This affects only products matching your conditions.</>
                      )}
                    </List.Item>
                    <List.Item>
                      For stores with lots of products, this can take several
                      minutes and may hit Shopify API limits.
                    </List.Item>
                  </List>
                </Banner>

                <InlineStack gap="300" align="end">
                  <Button url="/app" variant="plain">
                    Scan inventory policies
                  </Button>
                  <Button
                    tone="critical"
                    variant="primary"
                    loading={isRunning}
                    disabled={!hasConditions}
                    onClick={() => setConfirmOpen(true)}
                  >
                    {resetAll
                      ? "Set all inventory to 0"
                      : "Set matching inventory to 0"}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {result && (
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
        title={
          resetAll
            ? "Confirm inventory reset"
            : "Confirm reset for matching products"
        }
        primaryAction={{
          content: resetAll
            ? "Yes, set all inventory to 0"
            : "Yes, set matching inventory to 0",
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
              {resetAll ? "This will update every variant in the store." : "This will update variants of products matching your conditions."} This can’t be undone
              automatically.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}


