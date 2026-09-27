// Mawzun AI API — v1 read surface for agents.
//
// Every response is `{ success, data }` JSON; every query is scoped by the
// API key's company. Writes live in writes.ts (same route table, same scope).
//
// Column names: the shared database is created by Prisma with camelCase
// quoted identifiers (e.g. "companyId", "skuCode") — every query below must
// quote them exactly. Handlers receive a request-scoped `sql` (see index.ts).

import type { Sql } from "./auth";
import { writeRoutes } from "./writes";
import { registerResources } from "./resourceSpecs";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export interface HandlerCtx {
  body: unknown;
  env: Record<string, unknown>;
}

export interface Route {
  method: string;
  segments: string[];
  handler: (sql: Sql, companyId: string, params: Record<string, string>, url: URL, ctx?: HandlerCtx) => Promise<Response>;
}

const routes: Route[] = [];

function get(pattern: string, handler: Route["handler"]) {
  routes.push({
    method: "GET",
    segments: pattern.split("/").filter(Boolean),
    handler,
  });
}

// `post`, `patch` and `del` used to live here and were never called — every
// write in this worker goes through writes.ts, which pushes to the same table
// directly. They were removed rather than left in place because an unused
// helper in the route table reads as "some route uses this", and it kept the
// unused-symbol check permanently non-empty, hiding the next real one.

// Low-stock threshold: worker env AI_LOW_STOCK_THRESHOLD wins, then the
// ?lowStock= query param, then the 5-unit default.
function lowStockThreshold(url: URL, ctx?: HandlerCtx): number {
  const fromEnv = Number((ctx?.env?.AI_LOW_STOCK_THRESHOLD ?? "") as string);
  if (Number.isFinite(fromEnv) && fromEnv >= 0) return fromEnv;
  const fromQuery = Number(url.searchParams.get("lowStock"));
  if (Number.isFinite(fromQuery) && fromQuery >= 0) return fromQuery;
  return 5;
}

// ── products ────────────────────────────────────────────────────────────────
get("/v1/products", async (sql, companyId, _p, url) => {
  const search = url.searchParams.get("search");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const items = search
    ? await sql`
        SELECT id, name, "skuCode", price, "isActive", "archivedAt"
        FROM products WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
          AND name ILIKE ${"%" + search + "%"}
        ORDER BY name LIMIT ${limit}`
    : await sql`
        SELECT id, name, "skuCode", price, "isActive", "archivedAt"
        FROM products WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
        ORDER BY name LIMIT ${limit}`;
  return json({ items, count: items.length });
});

get("/v1/products/:id", async (sql, companyId, p) => {
  const rows = await sql`
    SELECT p.id, p.name, p."skuCode", p.price, p."isActive", p."archivedAt",
           coalesce(sl."onHand", 0) AS "onHand"
    FROM products p
    LEFT JOIN (SELECT "productId", sum("onHand") "onHand" FROM stock_levels GROUP BY "productId") sl
      ON sl."productId" = p.id
    WHERE p."companyId" = ${companyId} AND p.id = ${p.id} AND p."deletedAt" IS NULL`;
  if (rows.length === 0) return json({ error: "product not found" }, 404);
  return json(rows[0]);
});

// ── stock ───────────────────────────────────────────────────────────────────
get("/v1/stock/levels", async (sql, companyId, _p, url, ctx) => {
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
  const items = await sql`
    SELECT sl."productId", sl."storageLocationId", pr.name AS "productName", w.name AS warehouse,
           loc.name AS location, sl."onHand", sl.reserved,
           sl."onHand" - sl.reserved AS available
    FROM stock_levels sl
    JOIN products pr ON pr.id = sl."productId" AND pr."deletedAt" IS NULL
    JOIN storage_locations loc ON loc.id = sl."storageLocationId"
    JOIN warehouses w ON w.id = loc."warehouseId"
    WHERE sl."companyId" = ${companyId}
    ORDER BY pr.name LIMIT ${limit}`;
  const low = items.filter((i: Record<string, unknown>) => Number(i.available) <= lowStockThreshold(url, ctx));
  return json({ items, lowStock: low });
});

// ── orders ──────────────────────────────────────────────────────────────────
get("/v1/orders", async (sql, companyId, _p, url) => {
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const status = url.searchParams.get("status");
  const customerId = url.searchParams.get("customerId");
  // Filters compose: status and/or customerId. Three explicit branches keep
  // the raw SQL readable (postgres.js tagged templates can't concat clauses).
  const SELECT_COLS = sql`
    SELECT id, "orderNumber", status, "createdAt"::text, "orderActualPrice", "currencyCode", "externalNumber"
    FROM orders WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL`;
  let items;
  if (status && customerId) {
    items = await sql`${SELECT_COLS} AND status = ${status} AND "customerId" = ${customerId}
      ORDER BY "createdAt" DESC LIMIT ${limit}`;
  } else if (status) {
    items = await sql`${SELECT_COLS} AND status = ${status}
      ORDER BY "createdAt" DESC LIMIT ${limit}`;
  } else if (customerId) {
    items = await sql`${SELECT_COLS} AND "customerId" = ${customerId}
      ORDER BY "createdAt" DESC LIMIT ${limit}`;
  } else {
    items = await sql`${SELECT_COLS}
      ORDER BY "createdAt" DESC LIMIT ${limit}`;
  }
  return json({ items, count: items.length });
});

get("/v1/orders/:id", async (sql, companyId, p) => {
  // :id accepts the Mawzun order number OR an external (Shopify) number.
  const order = await sql`
    SELECT o.id, o."orderNumber", o.type, o.status, o."createdAt"::text, o."orderPrice",
           o."orderActualPrice", o."currencyCode", o."shippingCost", o."discountPercentage", o."detailedAddress",
           c.name AS "customerName", c."phoneNumber1", st.name AS "storeName",
           o."externalNumber", o."externalId"
    FROM orders o
    JOIN customers c ON c.id = o."customerId"
    LEFT JOIN stores st ON st.id = o."storeId"
    WHERE o."companyId" = ${companyId} AND o."deletedAt" IS NULL
      AND (o."orderNumber" = ${p.id} OR o."externalNumber" = ${p.id} OR o."externalId" = ${p.id} OR o.id::text = ${p.id})
    LIMIT 1`;
  if (order.length === 0) return json({ error: "order not found" }, 404);
  const items = await sql`
    SELECT oi.quantity, oi."unitPrice", pr.name AS "productName", pr."skuCode"
    FROM order_items oi
    LEFT JOIN products pr ON pr.id = oi."productId"
    WHERE oi."orderId" = ${order[0].id}`;
  return json({ ...order[0], items });
});

// ── customers ───────────────────────────────────────────────────────────────
get("/v1/customers", async (sql, companyId, _p, url) => {
  const search = url.searchParams.get("search");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const items = search
    ? await sql`
        SELECT id, name, "phoneNumber1", email, "isActive"
        FROM customers WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
          AND (name ILIKE ${"%" + search + "%"} OR "phoneNumber1" ILIKE ${"%" + search + "%"})
        ORDER BY name LIMIT ${limit}`
    : await sql`
        SELECT id, name, "phoneNumber1", email, "isActive"
        FROM customers WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
        ORDER BY name LIMIT ${limit}`;
  return json({ items, count: items.length });
});

get("/v1/customers/:id", async (sql, companyId, p) => {
  const cust = await sql`
    SELECT id, name, "phoneNumber1", "phoneNumber2", email, address, "isActive"
    FROM customers WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL`;
  if (cust.length === 0) return json({ error: "customer not found" }, 404);
  const orders = await sql`
    SELECT id, "orderNumber", status, "createdAt"::text, "orderActualPrice"
    FROM orders WHERE "companyId" = ${companyId} AND "customerId" = ${p.id} AND "deletedAt" IS NULL
    ORDER BY "createdAt" DESC LIMIT 20`;
  return json({ ...cust[0], orders });
});

// ── notifications ───────────────────────────────────────────────────────────
get("/v1/notifications", async (sql, companyId, _p, url) => {
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
  const items = await sql`
    SELECT id, title, message, category, "isRead", "createdAt"::text
    FROM notifications WHERE "companyId" = ${companyId}
    ORDER BY "createdAt" DESC LIMIT ${limit}`;
  return json({ items });
});

// ── coupons (reads; writes in writes.ts) ────────────────────────────────────
get("/v1/coupons", async (sql, companyId) => {
  const items = await sql`
    SELECT id, code, "discountType", value, "minOrderTotal", "maxRedemptions",
           "redemptionCount", "expiresAt"::text, "isActive"
    FROM coupons WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
    ORDER BY code`;
  return json({ items, count: items.length });
});

get("/v1/coupons/:id", async (sql, companyId, p) => {
  const rows = await sql`
    SELECT id, code, "discountType", value, "minOrderTotal", "maxRedemptions",
           "redemptionCount", "expiresAt"::text, "isActive"
    FROM coupons WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL`;
  if (rows.length === 0) return json({ error: "coupon not found" }, 404);
  return json(rows[0]);
});

// ── vendors (reads; writes in writes.ts) ────────────────────────────────────
get("/v1/vendors", async (sql, companyId, _p, url) => {
  const kind = url.searchParams.get("kind");
  const items = kind
    ? await sql`
        SELECT id, kind, name, "contactPerson", "phoneNumber", email, address,
               "taxNumber", notes, "isActive", "commissionRate"
        FROM vendors WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL AND kind = ${kind}
        ORDER BY name`
    : await sql`
        SELECT id, kind, name, "contactPerson", "phoneNumber", email, address,
               "taxNumber", notes, "isActive", "commissionRate"
        FROM vendors WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
        ORDER BY name`;
  return json({ items, count: items.length });
});

get("/v1/vendors/:id", async (sql, companyId, p) => {
  const rows = await sql`
    SELECT id, kind, name, "contactPerson", "phoneNumber", email, address,
           "taxNumber", notes, "isActive", "commissionRate"
    FROM vendors WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL`;
  if (rows.length === 0) return json({ error: "vendor not found" }, 404);
  return json(rows[0]);
});

export { routes, json };

routes.push(...writeRoutes);

// Generated CRUD for the resource families the dashboard exposes. Registered
// LAST on purpose: an explicit handler above wins over a generated one, so a
// resource with bespoke behaviour keeps it and only the remaining verbs are
// generated. Without that ordering a generic PATCH could shadow a specific one.
registerResources(routes);
