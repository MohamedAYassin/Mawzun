// Shopify webhook auto-registration.
//
// Ported from frappe/ecommerce_integrations shopify/connection.py
// register_webhooks(): when a Shopify store is saved in Mawzun, the app
// registers the sync topics through the store's own Admin API — the merchant
// never opens the Shopify dashboard. Topics mirror the worker's routes:
//   orders/create, orders/updated, orders/cancelled,
//   products/create, products/update
//
// Signing secret: for a Shopify custom app, deliveries are signed with the
// app's API secret key — the value saved as shopifyWebhookSecret. The webhook
// resource itself carries no secret field.
//
// Registration is best-effort: a Shopify outage must never block saving a
// store. Outcome is returned for logging; callers decide what to surface.

const TOPICS: { topic: string; path: string }[] = [
  { topic: "orders/create", path: "/webhooks/orders/create" },
  { topic: "orders/updated", path: "/webhooks/orders/updated" },
  { topic: "orders/cancelled", path: "/webhooks/orders/cancelled" },
  { topic: "orders/fulfilled", path: "/webhooks/orders/fulfilled" },
  { topic: "products/create", path: "/webhooks/products/create" },
  { topic: "products/update", path: "/webhooks/products/update" },
];

export interface RegistrationResult {
  created: string[];
  updated: string[];
  skipped: string[];
  error?: string;
}

export async function registerShopifyWebhooks(
  shopDomain: string,
  plaintextAccessToken: string,
  baseUrl: string
): Promise<RegistrationResult> {
  const result: RegistrationResult = { created: [], updated: [], skipped: [] };
  try {
    const api = `https://${shopDomain.replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/api/2026-01`;
    const headers = {
      "X-Shopify-Access-Token": plaintextAccessToken,
      "Content-Type": "application/json",
    };
    const base = baseUrl.replace(/\/$/, "");

    const list = await fetch(`${api}/webhooks.json?limit=250`, { headers });
    if (!list.ok) throw new Error(`list webhooks → ${list.status}`);
    const existing = ((await list.json()) as { webhooks: { id: number; topic: string; address: string }[] }).webhooks ?? [];

    for (const { topic, path } of TOPICS) {
      const address = `${base}${path}`;
      const match = existing.find((w) => w.topic === topic);
      if (match && match.address === address) {
        result.skipped.push(topic);
        continue;
      }
      if (match) {
        // Same topic registered elsewhere (stale URL): repoint it here.
        const res = await fetch(`${api}/webhooks/${match.id}.json`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ webhook: { address } }),
        });
        if (!res.ok) throw new Error(`update ${topic} → ${res.status}`);
        result.updated.push(topic);
        continue;
      }
      const res = await fetch(`${api}/webhooks.json`, {
        method: "POST",
        headers,
        body: JSON.stringify({ webhook: { topic, address, format: "json" } }),
      });
      if (!res.ok) throw new Error(`create ${topic} → ${res.status}: ${await res.text()}`);
      result.created.push(topic);
    }
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}
