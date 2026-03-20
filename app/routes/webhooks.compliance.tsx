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
  const payload = json as Record<string, unknown>;
  const payloadShopDomain =
    typeof payload.shop_domain === "string" ? payload.shop_domain : null;
  const shopDomain = payloadShopDomain ?? auth.shop;

  // This single endpoint receives all mandatory compliance topics (GDPR).
  console.info("[shopify-webhook] compliance", {
    topic: auth.topic,
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

  // Fulfill mandatory webhook actions.
  switch (auth.topic) {
    case "shop/redact": {
      const [sessionResult, webhookResult] = await Promise.all([
        db.session.deleteMany({ where: { shop: shopDomain } }),
        db.webhookEvent.deleteMany({ where: { shop: shopDomain } }),
      ]);

      console.info("[shopify-webhook] shop/redact completed", {
        shop: shopDomain,
        deletedSessions: sessionResult.count,
        deletedWebhookEvents: webhookResult.count,
      });
      break;
    }
    case "customers/data_request":
    case "customers/redact":
      // This app does not store customer/order data.
      console.info("[shopify-webhook] customer compliance acknowledged", {
        topic: auth.topic,
        shop: shopDomain,
      });
      break;
    default:
      console.warn("[shopify-webhook] unexpected compliance topic", {
        topic: auth.topic,
        shop: shopDomain,
      });
  }

  return new Response("OK", { status: 200 });
};



