// Mawzun Shopify webhook listener.
//
// Topics. Upstream (frappe/ecommerce_integrations constants.py) subscribes five:
//   orders/create, orders/paid, orders/fulfilled, orders/cancelled,
//   orders/partially_fulfilled
//
// We subscribe four of those, and the two omissions are deliberate:
//   - `orders/paid` — upstream turns it into a Sales Invoice + Payment Entry.
//     Mawzun has no invoice or payment LEDGER (PaymentMethod is only a lookup
//     table of Cash/Visa, and nothing records that an order was paid), so there
//     is no counterpart to create. Subscribing would mean storing a status
//     nobody reads.
//   - `orders/partially_fulfilled` — upstream makes a partial Delivery Note.
//     Our order pipeline is status-based (NEW → CONFIRMED → ON_THE_WAY →
//     DELIVERED) with no per-shipment document, so a partial fulfillment has
//     nowhere to land; the full `orders/fulfilled` event still moves the order.
//
// Routes:
//   POST /webhooks/orders/create     — orders/create + orders/updated
//   POST /webhooks/orders/cancelled  — orders/cancelled
//   POST /webhooks/products/update   — products/update (upsert + linkage ids)
//   POST /webhooks/products/create   — products/create (same handler)
//   POST /webhooks/orders/fulfilled  — orders/fulfilled
// GET  /healthz                     — liveness
//
// Pipeline: verify HMAC → find store by shop domain → dedupe / act → touch
// last_synced_at. Any failure is recorded in sync_errors and acknowledged 200
// so Shopify stops retrying a permanently-bad payload.
//
// The Postgres URL is NOT preset: production uses the Hyperdrive binding;
// local dev resolves it live from Heroku's Platform API.

import { verifyWebhook, ShopifyAdminApi, type ShopifyOrder, type ShopifyProduct } from "./shopify";
import { makeSql, makeHyperdriveSql, findStoreByDomain, touchSyncedAt } from "./db";
import { makeDbUrlResolver, type DbUrlResolver } from "./dbUrlResolver";
import { ingestOrder, cancelOrder, recordSyncError } from "./ingest";
import { upsertShopifyProduct, collectInventoryPush, pushInventoryToShopify } from "./products";
import { applyFulfillment } from "./fulfillment";
import { openToken } from "./secretbox";

export interface Env {
  HEROKU_API_TOKEN: string;
  HEROKU_APP_NAME: string;
  HYPERDRIVE?: Hyperdrive;
  APP_SECRET: string;
  DATABASE_SSL?: string;
  DB_URL_TTL_MS?: string;
  INVENTORY_PUSH_SKUS_PER_RUN?: string;
}

// Isolate-level cache of the URL string only (no I/O object) — safe to share
// across requests; the SQL client itself stays per-request.
const resolverCache = new Map<string, DbUrlResolver>();
function getResolver(env: Env): DbUrlResolver {
  let r = resolverCache.get(env.HEROKU_APP_NAME);
  if (!r) {
    r = makeDbUrlResolver(env);
    resolverCache.set(env.HEROKU_APP_NAME, r);
  }
  return r;
}

function isCredentialError(err: unknown): boolean {
  const msg = String(err);
  return /28P01|28000|password authentication failed|credential/i.test(msg);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    if (req.method === "POST" && url.pathname === "/webhooks/orders/create") {
      return handleOrderWebhook(req, env, "orders/create");
    }
    if (req.method === "POST" && url.pathname === "/webhooks/orders/updated") {
      return handleOrderWebhook(req, env, "orders/updated");
    }
    if (req.method === "POST" && url.pathname === "/webhooks/orders/cancelled") {
      return handleCancelWebhook(req, env);
    }
    if (req.method === "POST" && url.pathname === "/webhooks/products/create") {
      return handleProductWebhook(req, env);
    }
    if (req.method === "POST" && url.pathname === "/webhooks/products/update") {
      return handleProductWebhook(req, env);
    }
    if (req.method === "POST" && url.pathname === "/webhooks/orders/fulfilled") {
      return handleFulfilledWebhook(req, env);
    }

    return new Response("Not found", { status: 404 });
  },

  // Cron trigger: push Mawzun stock levels to Shopify for every store with
  // autoSync enabled. Hourly by default (see wrangler.jsonc crons).
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runInventoryPush(env);
  },
};

async function handleOrderWebhook(req: Request, env: Env, topic: string): Promise<Response> {
  const rawBody = await req.text();
  const shopDomain = (req.headers.get("X-Shopify-Shop-Domain") ?? "").toLowerCase();
  if (!shopDomain) {
    return new Response("missing shop domain", { status: 400 });
  }

  const auth = await authenticateWebhook(req, env, rawBody, shopDomain);
  if ("response" in auth) return auth.response;
  const { sql, store } = auth;

  try {
    const order = JSON.parse(rawBody) as ShopifyOrder;

    try {
      // Fetch the authoritative version through the Admin API — webhook bodies
      // can lag or be partial; the API is the source of truth.
      let authoritative = order;
      try {
        const token = await openToken(store.shopifyAccessToken, env.APP_SECRET);
        const api = new ShopifyAdminApi(shopDomain, token);
        authoritative = await api.getOrder(order.id);
      } catch {
        // Admin API unavailable: proceed with the webhook body rather than dropping.
      }

      const result = await ingestOrder(sql, store.companyId, store.id, authoritative);

      if (result.unmappedSkus.length > 0) {
        await recordSyncError(
          sql,
          store.companyId,
          store.id,
          store.name,
          "UNMAPPED_SKU",
          String(order.id ?? ""),
          `أصناف بدون مطابقة SKU: ${result.unmappedSkus.join(", ")}`,
          { skus: result.unmappedSkus, order }
        );
        // Order not created; the merchant maps the SKUs then retries from Shopify.
        return jsonRes({ recorded: true, unmappedSkus: result.unmappedSkus });
      }

      await touchSyncedAt(sql, store.id);
      return jsonRes(result);
    } catch (err) {
      await recordSyncError(
        sql,
        store.companyId,
        store.id,
        store.name,
        topic,
        String(order.id ?? ""),
        err instanceof Error ? err.message : String(err),
        order
      );
      // 200: the payload was malformed permanently or the failure is recorded —
      // either way retrying the same delivery will not help.
      return jsonRes({ recorded: true });
    }
  } finally {
    sql.end({ timeout: 1 }).catch(() => {});
  }
}

// orders/cancelled — mirror the cancellation onto the ingested order.
async function handleCancelWebhook(req: Request, env: Env): Promise<Response> {
  const rawBody = await req.text();
  const shopDomain = (req.headers.get("X-Shopify-Shop-Domain") ?? "").toLowerCase();
  if (!shopDomain) {
    return new Response("missing shop domain", { status: 400 });
  }

  const auth = await authenticateWebhook(req, env, rawBody, shopDomain);
  if ("response" in auth) return auth.response;
  const { sql, store } = auth;

  try {
    const order = JSON.parse(rawBody) as ShopifyOrder;
    const outcome = await cancelOrder(
      sql,
      store.companyId,
      store.id,
      String(order.id),
      order.cancel_reason ?? null
    );
    if (outcome === "already_shipped") {
      await recordSyncError(
        sql, store.companyId, store.id, store.name, "CANCEL_AFTER_SHIP",
        String(order.id), "تم شحن الطلب قبل الإلغاء — عالج الإرجاع يدوياً.", order
      );
    }
    if (outcome !== "not_found") await touchSyncedAt(sql, store.id);
    return jsonRes({ action: outcome });
  } catch (err) {
    await recordSyncError(
      sql, store.companyId, store.id, store.name, "orders/cancelled",
      String((JSON.parse(rawBody) as ShopifyOrder).id ?? ""),
      err instanceof Error ? err.message : String(err)
    );
    return jsonRes({ recorded: true });
  } finally {
    sql.end({ timeout: 1 }).catch(() => {});
  }
}

// products/create + products/update — upsert product + Shopify linkage ids
// (variant/inventory_item) that drive the Mawzun → Shopify stock push.
async function handleProductWebhook(req: Request, env: Env): Promise<Response> {
  const rawBody = await req.text();
  const shopDomain = (req.headers.get("X-Shopify-Shop-Domain") ?? "").toLowerCase();
  if (!shopDomain) {
    return new Response("missing shop domain", { status: 400 });
  }

  const auth = await authenticateWebhook(req, env, rawBody, shopDomain);
  if ("response" in auth) return auth.response;
  const { sql, store } = auth;

  try {
    const product = JSON.parse(rawBody) as ShopifyProduct;
    const action = await upsertShopifyProduct(sql, store.companyId, product);
    await touchSyncedAt(sql, store.id);
    return jsonRes({ action, productId: product.id });
  } catch (err) {
    await recordSyncError(
      sql, store.companyId, store.id, store.name, "products/update",
      String((JSON.parse(rawBody) as ShopifyProduct).id ?? ""),
      err instanceof Error ? err.message : String(err)
    );
    return jsonRes({ recorded: true });
  } finally {
    sql.end({ timeout: 1 }).catch(() => {});
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// orders/fulfilled — Shopify says the merchant shipped. Mirror onto the
// ingested order's status pipeline (see fulfillment.ts for the state rules).
async function handleFulfilledWebhook(req: Request, env: Env): Promise<Response> {
  const rawBody = await req.text();
  const shopDomain = (req.headers.get("X-Shopify-Shop-Domain") ?? "").toLowerCase();
  if (!shopDomain) {
    return new Response("missing shop domain", { status: 400 });
  }

  const auth = await authenticateWebhook(req, env, rawBody, shopDomain);
  if ("response" in auth) return auth.response;
  const { sql, store } = auth;

  try {
    const order = JSON.parse(rawBody) as ShopifyOrder & {
      fulfillments?: { id: number; tracking_number?: string | null }[];
    };
    const hasTracking = (order.fulfillments ?? []).some((f) => f.tracking_number);
    const outcome = await applyFulfillment(
      sql,
      store.companyId,
      store.id,
      String(order.id),
      hasTracking
    );
    if (outcome === "not_found") {
      await recordSyncError(
        sql, store.companyId, store.id, store.name, "FULFILLMENT_NO_ORDER",
        String(order.id), "وصل إشعار شحن لطلب غير موجود — أكمل استيراد الطلب أولاً.", order
      );
    }
    if (outcome === "marked_on_the_way") await touchSyncedAt(sql, store.id);
    return jsonRes({ action: outcome });
  } catch (err) {
    await recordSyncError(
      sql, store.companyId, store.id, store.name, "orders/fulfilled",
      String((JSON.parse(rawBody) as ShopifyOrder).id ?? ""),
      err instanceof Error ? err.message : String(err)
    );
    return jsonRes({ recorded: true });
  } finally {
    sql.end({ timeout: 1 }).catch(() => {});
  }
}

// Cron entry: push stock Mawzun → Shopify for all active SHOPIFY stores with
// autoSyncEnabled. Per store: collect mapped SKUs (limit 250/run), unseal the
// store token, push via Admin API. Failures land in sync_errors — the next
// hourly run retries by simply re-pushing current levels.
async function runInventoryPush(env: Env): Promise<void> {
  const { sql, stores } = await withStoresForPush(env);
  if (!sql) return;
  try {
    for (const store of stores) {
      try {
        const perRun = Math.max(1, Number(env.INVENTORY_PUSH_SKUS_PER_RUN ?? 250));
        const rows = await collectInventoryPush(sql, store.companyId, perRun);
        if (rows.length === 0) continue;
        const token = await openToken(store.shopifyAccessToken, env.APP_SECRET);
        const api = new ShopifyAdminApi(store.shopifyShopDomain, token);
        const { pushed, failed, rateLimited } = await pushInventoryToShopify(api, rows);
        console.log(`inventory push ${store.shopifyShopDomain}: ${pushed} pushed, ${failed} failed${rateLimited ? " (rate limited — remainder deferred to the next run)" : ""}`);
        if (failed > 0) {
          // A rate limit is not a data problem: the same payload will succeed
          // next run, so it is recorded as retryable rather than as a failure
          // the operator needs to investigate.
          await recordSyncError(
            sql, store.companyId, store.id, store.name,
            rateLimited ? "INVENTORY_PUSH_RATE_LIMITED" : "INVENTORY_PUSH_PARTIAL",
            "",
            rateLimited
              ? `تأجيل رفع ${failed} صنف بسبب حد معدل Shopify — سيُعاد تلقائياً في التشغيل القادم.`
              : `فشل رفع ${failed} من ${pushed + failed} مستوى مخزون إلى Shopify.`,
            { pushed, failed, rateLimited }
          );
        }
        await touchSyncedAt(sql, store.id);
      } catch (err) {
        console.error("inventory push failed", store.shopifyShopDomain, err);
        try {
          await recordSyncError(
            sql, store.companyId, store.id, store.name, "INVENTORY_PUSH",
            "", err instanceof Error ? err.message : String(err)
          );
        } catch { /* DB itself down — next cron run retries */ }
      }
    }
  } finally {
    sql.end({ timeout: 1 }).catch(() => {});
  }
}

// Load the sql client + eligible stores for the cron push. Hyperdrive binding
// in prod; Heroku resolver locally. Returns sql=null when the DB is reachable
// by neither path (cron exits quietly; next run retries).
async function withStoresForPush(env: Env): Promise<{
  sql: Awaited<ReturnType<typeof makeHyperdriveSql>> | null;
  stores: (NonNullable<Awaited<ReturnType<typeof findStoreByDomain>>>)[];
}> {
  let sql;
  if (env.HYPERDRIVE) {
    sql = makeHyperdriveSql(env.HYPERDRIVE);
  } else {
    try {
      sql = makeSql(await getResolver(env).get(), env);
    } catch (err) {
      console.error("inventory push: db-url resolve failed", err);
      return { sql: null, stores: [] };
    }
  }
  try {
    const rows = await sql`
      SELECT id, "companyId", name, "shopifyShopDomain", "shopifyAccessToken"
      FROM stores
      WHERE "deletedAt" IS NULL AND platform = 'SHOPIFY' AND "isActive" = true
        AND "autoSyncEnabled" = true AND "shopifyLocationId" IS NOT NULL`;
    return { sql, stores: rows as unknown as (NonNullable<Awaited<ReturnType<typeof findStoreByDomain>>>)[] };
  } catch (err) {
    console.error("inventory push: store list failed", err);
    sql.end({ timeout: 1 }).catch(() => {});
    return { sql: null, stores: [] };
  }
}


// Shared preamble: DB client (Hyperdrive in prod, Heroku-resolved locally),
// store lookup by shop domain with credential-rotation retry, HMAC verify.
// Returns either the failure Response or the open { sql, store } pair; the
// caller owns closing the client in its finally block.
async function authenticateWebhook(
  req: Request,
  env: Env,
  rawBody: string,
  shopDomain: string
): Promise<{ response: Response } | { sql: Awaited<ReturnType<typeof makeHyperdriveSql>>; store: NonNullable<Awaited<ReturnType<typeof findStoreByDomain>>> }> {
  const hmacHeader = req.headers.get("X-Shopify-Hmac-Sha256") ?? "";
  const resolver = getResolver(env);
  // Hyperdrive binding wins when present (production: pooled, no per-query
  // socket storm). Otherwise resolve the URL live from Heroku (local dev).
  let sql;
  if (env.HYPERDRIVE) {
    sql = makeHyperdriveSql(env.HYPERDRIVE);
  } else {
    let dbUrl: string;
    try {
      dbUrl = await resolver.get();
    } catch (err) {
      console.error("db-url resolve failed", err);
      // 500 (not 200) so Shopify retries the delivery later.
      return { response: new Response("database unavailable", { status: 500 }) };
    }
    sql = makeSql(dbUrl, env);
  }
  try {
    const store = await findStoreByDomain(sql, shopDomain).catch(async (err) => {
      if (isCredentialError(err)) {
        resolver.invalidate();
        const fresh = makeSql(await resolver.get(), env);
        try {
          return await findStoreByDomain(fresh, shopDomain);
        } finally {
          fresh.end({ timeout: 1 }).catch(() => {});
        }
      }
      throw err;
    });
    if (!store) {
      // Unknown shop: 401 so Shopify unregisters the delivery.
      return { response: new Response("unknown shop", { status: 401 }) };
    }

    const valid = await verifyWebhook(rawBody, hmacHeader, store.shopifyWebhookSecret);
    if (!valid) {
      return { response: new Response("invalid signature", { status: 401 }) };
    }
    return { sql, store };
  } catch (err) {
    sql.end({ timeout: 1 }).catch(() => {});
    throw err;
  }
}
