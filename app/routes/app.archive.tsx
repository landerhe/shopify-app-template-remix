import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  Divider,
  FormLayout,
  InlineStack,
  Layout,
  List,
  Modal,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  archiveProductsByQuery,
  buildProductSearchQuery,
  type ArchiveResult,
} from "../utils/archive-products.server";

type ArchiveActionData = ArchiveResult & { intent: "archive" };

type ArchiveErrorData = {
  intent: "error";
  message: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "archive") {
    return json<ArchiveErrorData>(
      { intent: "error", message: "Invalid intent" },
      { status: 400 }
    );
  }

  const vendor = String(formData.get("vendor") || "").trim();
  const tags = String(formData.get("tags") || "").trim();
  const titleContains = String(formData.get("titleContains") || "").trim();

  const query = buildProductSearchQuery({ vendor, tags, titleContains });

  if (!query) {
    return json<ArchiveErrorData>(
      { intent: "error", message: "Enter at least one condition." },
      { status: 400 }
    );
  }

  const result = await archiveProductsByQuery(admin, { query });
  return json<ArchiveActionData>({ intent: "archive", ...result });
};

export default function ArchiveRoute() {
  const shopify = useAppBridge();
  const fetcher = useFetcher<typeof action>();
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");
  const [titleContains, setTitleContains] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const isRunning =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";

  const result = fetcher.data;
  const hasResult = Boolean(result && "scanned" in result);
  const archiveResult = hasResult ? (result as ArchiveActionData) : null;
  const hasError =
    result && "intent" in result && result.intent === "error";

  const hasConditions = Boolean(
    vendor.trim() || tags.trim() || titleContains.trim()
  );

  const onArchive = () => {
    setConfirmOpen(false);
    const formData = new FormData();
    formData.set("intent", "archive");
    formData.set("vendor", vendor);
    formData.set("tags", tags);
    formData.set("titleContains", titleContains);
    fetcher.submit(formData, { method: "post" });
    shopify.toast.show("Archiving matching products…");
  };

  useEffect(() => {
    if (!archiveResult) return;
    if (archiveResult.ok) shopify.toast.show("Archiving complete");
    else shopify.toast.show("Archiving finished with errors");
  }, [archiveResult, shopify]);

  return (
    <Page backAction={{ content: "Home", url: "/app" }}>
      <TitleBar title="Bulk archive" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {hasError && (
              <Banner
                title="Validation error"
                tone="critical"
                onDismiss={() => {}}
              >
                <Text as="p" variant="bodyMd">
                  {(result as ArchiveErrorData).message}
                </Text>
              </Banner>
            )}

            {hasResult && archiveResult?.ok && (
              <Banner title="Done" tone="success">
                <Text as="p" variant="bodyMd">
                  Archived {archiveResult.archived} product
                  {archiveResult.archived === 1 ? "" : "s"}.
                </Text>
              </Banner>
            )}

            {hasResult && archiveResult && !archiveResult.ok && (
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
                  Set one or more conditions to match products. All matching
                  products will be archived.
                </Text>

                <FormLayout>
                  <TextField
                    label="Vendor"
                    value={vendor}
                    onChange={setVendor}
                    placeholder="e.g. Acme"
                    autoComplete="off"
                    disabled={isRunning}
                  />
                  <TextField
                    label="Tags"
                    value={tags}
                    onChange={setTags}
                    placeholder="e.g. sale, clearance"
                    autoComplete="off"
                    disabled={isRunning}
                    helpText="Comma-separated list of tags. Products must have all listed tags."
                  />
                  <TextField
                    label="Title contains"
                    value={titleContains}
                    onChange={setTitleContains}
                    placeholder='e.g. hoodie or "green hoodie"'
                    autoComplete="off"
                    disabled={isRunning}
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
                    tone="critical"
                    variant="primary"
                    loading={isRunning}
                    disabled={!hasConditions}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Archive matching products
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {hasResult && archiveResult && (
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
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Archive matching products?"
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
            This will archive every product that matches your conditions. You can
            unarchive later, but this action may impact storefront visibility
            immediately.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
