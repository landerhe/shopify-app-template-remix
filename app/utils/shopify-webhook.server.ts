import crypto from "crypto";

type ShopifyWebhookAuthResult =
  | { ok: true; topic: string; shop: string; webhookId?: string; apiVersion?: string }
  | { ok: false; status: number; message: string };

function getHeader(headers: Headers, name: string) {
  return headers.get(name) || headers.get(name.toLowerCase());
}

export async function verifyShopifyWebhookRequest(
  request: Request,
): Promise<ShopifyWebhookAuthResult> {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    return { ok: false, status: 500, message: "Missing SHOPIFY_API_SECRET" };
  }

  // IMPORTANT: Verify using the RAW request body.
  // We explicitly clone() before reading so downstream logic can still read the body if needed.
  const rawBody = await request.clone().text();

  const hmacHeader = getHeader(request.headers, "X-Shopify-Hmac-Sha256");
  if (!hmacHeader) {
    return { ok: false, status: 401, message: "Missing HMAC header" };
  }

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(hmacHeader, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, message: "Invalid HMAC" };
  }

  const topic = getHeader(request.headers, "X-Shopify-Topic") || "";
  const shop = getHeader(request.headers, "X-Shopify-Shop-Domain") || "";
  const webhookId = getHeader(request.headers, "X-Shopify-Webhook-Id") || undefined;
  const apiVersion = getHeader(request.headers, "X-Shopify-Api-Version") || undefined;

  if (!topic || !shop) {
    return { ok: false, status: 400, message: "Missing topic/shop headers" };
  }

  return { ok: true, topic, shop, webhookId, apiVersion };
}

export async function readShopifyWebhookJson<T = unknown>(
  request: Request,
): Promise<{ rawBody: string; json: T }> {
  const rawBody = await request.clone().text();
  const json = (rawBody ? JSON.parse(rawBody) : {}) as T;
  return { rawBody, json };
}


