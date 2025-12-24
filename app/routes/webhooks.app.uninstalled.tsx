import type { ActionFunctionArgs } from "@remix-run/node";
import db from "../db.server";
import {
  readShopifyWebhookJson,
  verifyShopifyWebhookRequest,
} from "../utils/shopify-webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Catch & Release: verify quickly, enqueue work, return 200 immediately.
  const auth = await verifyShopifyWebhookRequest(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const { rawBody, json } = await readShopifyWebhookJson(request);

  await db.webhookEvent.create({
    data: {
      topic: auth.topic,
      shop: auth.shop,
      webhookId: auth.webhookId,
      apiVersion: auth.apiVersion,
      payload: json as any,
    },
  });

  // Intentionally no synchronous deletion here; Vercel functions should respond fast.
  return new Response("OK", { status: 200 });
};
