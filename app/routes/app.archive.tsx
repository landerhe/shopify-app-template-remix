import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  Divider,
  FormLayout,
  InlineStack,
  Layout,
  List,
  Modal,
  Page,
  ProgressBar,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  unarchiveProductsByQuery,
  type ArchiveResult,
  type UnarchiveResult,
} from "../utils/archive-products.server";

type ArchiveProgress = {
  currentTitle: string;
  scanned: number;
  archived: number;
  alreadyArchived: number;
  done: boolean;
  result?: ArchiveResult;
};

const PROGRESS_THROTTLE_MS = 100;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "unarchive") {
    return json({ error: "Invalid intent" }, { status: 400 });
  }

  const vendor = String(formData.get("vendor") || "").trim();
  const tags = String(formData.get("tags") || "").trim();
  const titleContains = String(formData.get("titleContains") || "").trim();
  const unarchiveAll = formData.get("archiveAll") === "true";
  const hasConditions = Boolean(vendor || tags || titleContains);

  if (!unarchiveAll && !hasConditions) {
    return json(
      {
        error:
          "Enter at least one condition or select Archive all products to unarchive all archived products.",
      },
      { status: 400 }
    );
  }

  const result = await unarchiveProductsByQuery(admin, {
    query: null,
    conditions: unarchiveAll ? undefined : { vendor, tags, titleContains },
  });
  return json<UnarchiveResult & { intent: "unarchive" }>({
    intent: "unarchive",
    ...result,
  });
};

export default function ArchiveRoute() {
  const shopify = useAppBridge();
  const unarchiveFetcher = useFetcher<typeof action>();
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");
  const [titleContains, setTitleContains] = useState("");
  const [archiveAll, setArchiveAll] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmUnarchiveOpen, setConfirmUnarchiveOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [archiveResult, setArchiveResult] = useState<ArchiveResult | null>(null);
  const [hasError, setHasError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ArchiveProgress | null>(null);
  const [unarchiveResult, setUnarchiveResult] =
    useState<UnarchiveResult | null>(null);
  const lastProgressUpdate = useRef(0);
  const pendingProgress = useRef<ArchiveProgress | null>(null);

  const isUnarchiveRunning =
    ["loading", "submitting"].includes(unarchiveFetcher.state) &&
    unarchiveFetcher.formMethod === "POST";

  const unarchiveData = unarchiveFetcher.data;
  const hasUnarchiveResult =
    Boolean(unarchiveData) &&
    "intent" in unarchiveData &&
    unarchiveData.intent === "unarchive";
  const resolvedUnarchiveResult = hasUnarchiveResult
    ? (unarchiveData as UnarchiveResult & { intent: "unarchive" })
    : null;

  const flushProgress = useCallback(() => {
    if (pendingProgress.current) {
      setProgress(pendingProgress.current);
      pendingProgress.current = null;
    }
  }, []);

  const hasConditions =
    archiveAll ||
    Boolean(vendor.trim() || tags.trim() || titleContains.trim());

  const onArchive = useCallback(async () => {
    setConfirmOpen(false);
    setHasError(null);
    setArchiveResult(null);
    setProgress(null);
    setIsRunning(true);
    shopify.toast.show("Archiving matching products…");

    const formData = new FormData();
    formData.set("intent", "archive");
    formData.set("archiveAll", String(archiveAll));
    formData.set("vendor", vendor);
    formData.set("tags", tags);
    formData.set("titleContains", titleContains);

    try {
      const res = await fetch("/app/api/archive-progress", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setHasError(
          (errData as { message?: string }).message ?? "Archive request failed"
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
            const update = JSON.parse(line) as ArchiveProgress & {
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
              setArchiveResult(update.result);
              if (update.result.ok) shopify.toast.show("Archiving complete");
              else shopify.toast.show("Archiving finished with errors");
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      flushProgress();
    } catch (err) {
      setHasError(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setIsRunning(false);
    }
  }, [archiveAll, vendor, tags, titleContains, shopify, flushProgress]);

  useEffect(() => {
    if (!isRunning && pendingProgress.current) {
      flushProgress();
    }
  }, [isRunning, flushProgress]);

  useEffect(() => {
    if (unarchiveFetcher.data && "error" in unarchiveFetcher.data) {
      setHasError(
        (unarchiveFetcher.data as { error?: string }).error ?? "Unarchive failed"
      );
      return;
    }
    if (resolvedUnarchiveResult) {
      setUnarchiveResult(resolvedUnarchiveResult);
      if (resolvedUnarchiveResult.ok)
        shopify.toast.show("Set active complete");
      else shopify.toast.show("Set active finished with errors");
    }
  }, [unarchiveFetcher.data, resolvedUnarchiveResult, shopify]);

  const onUnarchive = () => {
    setConfirmUnarchiveOpen(false);
    const formData = new FormData();
    formData.set("intent", "unarchive");
    formData.set("archiveAll", String(archiveAll));
    formData.set("vendor", vendor);
    formData.set("tags", tags);
    formData.set("titleContains", titleContains);
    unarchiveFetcher.submit(formData, { method: "post" });
    shopify.toast.show("Setting matching products active…");
  };

  return (
    <Page backAction={{ content: "Home", url: "/app" }}>
      <TitleBar title="Bulk archive" />
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
                      ? `Processing: ${progress.currentTitle} — ${progress.scanned} scanned, ${progress.archived} archived`
                      : `Archiving… ${progress.scanned} scanned, ${progress.archived} archived`}
                  </Text>
                </BlockStack>
              </Card>
            )}

            {archiveResult?.ok && (
              <Banner title="Done" tone="success">
                <Text as="p" variant="bodyMd">
                  Archived {archiveResult.archived} product
                  {archiveResult.archived === 1 ? "" : "s"}.
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

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Archive products by conditions
                </Text>
                <Text as="p" variant="bodyMd">
                  Set one or more conditions to match products, or archive all
                  products. All matching products will be archived. Use "Set
                  active" to unarchive archived products.
                </Text>

                <FormLayout>
                  <Checkbox
                    label="Archive all / Unarchive all archived"
                    checked={archiveAll}
                    onChange={setArchiveAll}
                    disabled={isRunning || isUnarchiveRunning}
                    helpText="When checked, all products will be archived (or all archived products will be set active). Conditions below are ignored."
                  />
                  <TextField
                    label="Vendor"
                    value={vendor}
                    onChange={setVendor}
                    placeholder="e.g. Acme"
                    autoComplete="off"
                    disabled={isRunning || isUnarchiveRunning || archiveAll}
                  />
                  <TextField
                    label="Tags"
                    value={tags}
                    onChange={setTags}
                    placeholder="e.g. sale, clearance"
                    autoComplete="off"
                    disabled={isRunning || isUnarchiveRunning || archiveAll}
                    helpText="Comma-separated list of tags. Products with any listed tag will match."
                  />
                  <TextField
                    label="Title contains"
                    value={titleContains}
                    onChange={setTitleContains}
                    placeholder='e.g. hoodie or "green hoodie"'
                    autoComplete="off"
                    disabled={isRunning || isUnarchiveRunning || archiveAll}
                    helpText="Words or phrase to search in product title."
                  />
                </FormLayout>

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
                    variant="primary"
                    loading={isUnarchiveRunning}
                    disabled={!hasConditions || isRunning}
                    onClick={() => setConfirmUnarchiveOpen(true)}
                  >
                    Set active (unarchive) matching products
                  </Button>
                  <Button
                    tone="critical"
                    variant="primary"
                    loading={isRunning}
                    disabled={!hasConditions || isUnarchiveRunning}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Archive matching products
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {unarchiveResult && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Set active summary
                  </Text>
                  <Divider />
                  <List type="bullet">
                    <List.Item>
                      Archived products scanned: {unarchiveResult.scanned}
                    </List.Item>
                    <List.Item>Set active: {unarchiveResult.activated}</List.Item>
                    <List.Item>
                      Shopify user errors: {unarchiveResult.userErrors}
                    </List.Item>
                  </List>

                  {unarchiveResult.sampleErrors.length > 0 && (
                    <>
                      <Divider />
                      <Text as="h3" variant="headingSm">
                        Sample errors
                      </Text>
                      <List type="bullet">
                        {unarchiveResult.sampleErrors
                          .slice(0, 10)
                          .map((e, idx) => (
                            <List.Item key={`${e.scope}-${idx}`}>
                              {e.scope}: {e.message}
                              {e.field?.length
                                ? ` (field: ${e.field.join(".")})`
                                : ""}
                            </List.Item>
                          ))}
                      </List>
                    </>
                  )}
                </BlockStack>
              </Card>
            )}

            {archiveResult && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Summary
                  </Text>
                  <Divider />
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
                        {archiveResult.sampleErrors
                          .slice(0, 10)
                          .map((e, idx) => (
                            <List.Item key={`${e.scope}-${idx}`}>
                              {e.scope}: {e.message}
                              {e.field?.length
                                ? ` (field: ${e.field.join(".")})`
                                : ""}
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
        open={confirmUnarchiveOpen}
        onClose={() => setConfirmUnarchiveOpen(false)}
        title={
          archiveAll
            ? "Set all archived products active?"
            : "Set active (unarchive) matching products?"
        }
        primaryAction={{
          content: "Yes, set them active",
          onAction: onUnarchive,
          loading: isUnarchiveRunning,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setConfirmUnarchiveOpen(false),
            disabled: isUnarchiveRunning,
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            {archiveAll
              ? "This will set all archived products back to active. They will become visible on your sales channels."
              : "This will set all archived products that match your conditions back to active. They will become visible on your sales channels."}
          </Text>
        </Modal.Section>
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={archiveAll ? "Archive all products?" : "Archive matching products?"}
        primaryAction={{
          content: "Yes, archive them",
          destructive: true,
          onAction: onArchive,
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
            {archiveAll
              ? "This will archive every product in your store. You can unarchive later, but this action may impact storefront visibility immediately."
              : "This will archive every product that matches your conditions. You can unarchive later, but this action may impact storefront visibility immediately."}
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
