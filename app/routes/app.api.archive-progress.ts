import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { archiveProductsByQueryStreaming } from "../utils/archive-products.server";

/**
 * Resource route that streams archive progress as NDJSON.
 * POST with formData: intent=archive, archiveAll, vendor, tags, titleContains
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "archive") {
    return new Response(
      JSON.stringify({ error: "Invalid intent", message: "Expected intent: archive" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const vendor = String(formData.get("vendor") || "").trim();
  const tags = String(formData.get("tags") || "").trim();
  const titleContains = String(formData.get("titleContains") || "").trim();
  const archiveAll = formData.get("archiveAll") === "true";
  const hasConditions = Boolean(vendor || tags || titleContains);

  if (!archiveAll && !hasConditions) {
    return new Response(
      JSON.stringify({
        error: "validation",
        message: "Enter at least one condition or select Archive all products.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const update of archiveProductsByQueryStreaming(admin, {
          query: null,
          conditions: archiveAll ? undefined : { vendor, tags, titleContains },
        })) {
          controller.enqueue(encoder.encode(JSON.stringify(update) + "\n"));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: "server",
              message: err instanceof Error ? err.message : "Archive failed",
              done: true,
            }) + "\n"
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
};
