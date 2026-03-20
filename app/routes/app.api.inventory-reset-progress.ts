import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  getAllLocationIds,
  runInventoryResetStreaming,
} from "../utils/inventory-reset.server";

/**
 * Resource route that streams inventory reset progress as NDJSON.
 * POST with formData: intent=run, includeAppLocations, resetAll, vendor, tags, titleContains
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent !== "run") {
    return new Response(
      JSON.stringify({
        error: "Invalid intent",
        message: "Expected intent: run",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const includeAppLocations = formData.get("includeAppLocations") === "true";
  const resetAll = formData.get("resetAll") === "true";
  const vendor = String(formData.get("vendor") || "").trim();
  const tags = String(formData.get("tags") || "").trim();
  const titleContains = String(formData.get("titleContains") || "").trim();
  const hasConditions = Boolean(vendor || tags || titleContains);

  if (!resetAll && !hasConditions) {
    return new Response(
      JSON.stringify({
        error: "validation",
        message:
          "Enter at least one condition (vendor, tags, or title) or select Reset all products.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const locationIds = await getAllLocationIds(admin, includeAppLocations);

  const conditions = resetAll
    ? undefined
    : { vendor, tags, titleContains };

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      try {
        for await (const update of runInventoryResetStreaming({
          admin,
          locationIds,
          conditions,
        })) {
          controller.enqueue(encoder.encode(JSON.stringify(update) + "\n"));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error: "server",
              message: err instanceof Error ? err.message : "Inventory reset failed",
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
