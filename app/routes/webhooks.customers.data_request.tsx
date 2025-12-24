import type { ActionFunctionArgs } from "@remix-run/node";
import db from "../db.server";
import {
  readShopifyWebhookJson,
  verifyShopifyWebhookRequest,
} from "../utils/shopify-webhook.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await verifyShopifyWebhookRequest(request);
  if (!auth.ok) return new Response(auth.message, { status: auth.status });

  const { json } = await readShopifyWebhookJson(request);

  console.info("[shopify-webhook] customers/data_request", {
    shop: auth.shop,
    webhookId: auth.webhookId,
    apiVersion: auth.apiVersion,
  });

  await db.webhookEvent.create({
    data: {
      topic: auth.topic,
      shop: auth.shop,
      webhookId: auth.webhookId,
      apiVersion: auth.apiVersion,
      payload: json as any,
    },
  });

  return new Response("OK", { status: 200 });
};


