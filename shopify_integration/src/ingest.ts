// Order ingestion: Shopify webhook → Mawzun orders table (idempotent).
//
// Identity: orders."companyId" + orders."storeId" + orders."externalId" is
// unique — a webhook replay or duplicate delivery finds the existing row and
// exits.
//
// Customer mapping: match by email first, then phone; if neither exists,
// create a customer (owners may edit them later).
//
// Stock: ingested orders are created with status NEW and do NOT commit stock
// — the company confirms them exactly like manual orders, so overselling is
// still caught by the normal confirm flow.
//
// Money: totals ARE computed here. `orderPrice`/`orderActualPrice` default to 0
// in the schema and nothing recomputes them later (the status-change path
// leaves them alone), so omitting them would book every Shopify order at zero
// and the revenue reports — which SUM orderActualPrice — would read 0 for the
// whole channel.
//
// Column names are Prisma camelCase quoted identifiers throughout, and every id
// column is TEXT (never uuid — a ::uuid cast fails with `operator does not
// exist: text = uuid`).

import type { Sql } from "./db";
import type { ShopifyOrder } from "./shopify";

export interface IngestResult {
  action: "created" | "duplicate";
  orderId: string;
  orderNumber: string;
  unmappedSkus: string[];
}

/**
 * Sum of every discount allocation on a line.
 *
 * Shopify reports the gross price in `price` and puts the reduction in
 * `discount_allocations[]`; upstream subtracts it before writing the item
 * (order.py `_get_total_discount`). Not doing that books a discounted order at
 * full price — the customer paid less than the order says.
 */
function totalDiscount(item: ShopifyOrder["line_items"][number]): number {
  let sum = 0;
  for (const d of item.discount_allocations ?? []) sum += Number(d.amount) || 0;
  return sum;
}

/**
 * Shipping actually charged: the sum of shipping lines, net of their own
 * discounts. Shopify's order-level `shipping_lines` is authoritative — the
 * shipping address carries no amount.
 */
function netShipping(order: ShopifyOrder): number {
  let sum = 0;
  for (const line of order.shipping_lines ?? []) {
    sum += Number(line.price) || 0;
    for (const d of line.discount_allocations ?? []) sum -= Number(d.amount) || 0;
  }
  return Math.max(0, sum);
}

/**
 * Next order number from the company's own sequence — the SAME counter the
 * dashboard uses (`company_settings.orderNextNumber`).
 *
 * The previous version scanned `max(digits) + 1` across existing order numbers,
 * which ignored `orderPrefix` and raced: two webhooks arriving together read
 * the same max and both produced the same number, colliding on
 * `@@unique([companyId, orderNumber])` and losing one order.
 *
 * The upsert is a single statement, so the row lock serialises concurrent
 * callers instead of both reading the same value.
 */
async function nextOrderNumber(sql: Sql, companyId: string): Promise<string> {
  const rows = await sql`
    INSERT INTO company_settings (id, "createdAt", "updatedAt", "companyId", "orderPrefix", "orderNextNumber")
    VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, 'ORD', 2)
    ON CONFLICT ("companyId") DO UPDATE
      SET "orderNextNumber" = company_settings."orderNextNumber" + 1, "updatedAt" = now()
    RETURNING "orderPrefix", "orderNextNumber"`;
  const s = rows[0] as { orderPrefix: string; orderNextNumber: number };
  // The counter stores the NEXT number to hand out; the Backend subtracts one
  // for the same reason (orders.ts nextOrderNumber).
  return `${s.orderPrefix}-${String(s.orderNextNumber - 1).padStart(6, "0")}`;
}

export async function ingestOrder(
  sql: Sql,
  companyId: string,
  storeId: string,
  shopifyOrder: ShopifyOrder
): Promise<IngestResult> {
  const externalId = String(shopifyOrder.id);

  // Idempotency gate.
  //
  // This is also what makes orders/updated useful: when a delivery fails before
  // the order row exists (an unmapped SKU, or a transient DB error) no row is
  // created, so a LATER orders/updated for the same order is not a duplicate —
  // it is the recovery path, and the merchant can fix the SKU then let Shopify's
  // next update bring the order in. Once a row exists, further updates are
  // ignored on purpose: Mawzun owns the order from that point (status, stock,
  // returns) and silently overwriting it from Shopify would trample edits the
  // operator made here.
  const existing = await sql`
    SELECT id, "orderNumber" FROM orders
    WHERE "companyId" = ${companyId} AND "storeId" = ${storeId} AND "externalId" = ${externalId}
    LIMIT 1`;
  if (existing.length > 0) {
    return { action: "duplicate", orderId: existing[0].id, orderNumber: existing[0].orderNumber, unmappedSkus: [] };
  }

  const displayName =
    shopifyOrder.customer
      ? [shopifyOrder.customer.first_name, shopifyOrder.customer.last_name].filter(Boolean).join(" ").trim()
      : shopifyOrder.email?.split("@")[0] ?? "عميل Shopify";
  const phone = shopifyOrder.phone ?? shopifyOrder.customer?.phone ?? shopifyOrder.shipping_address?.phone ?? null;
  const email = shopifyOrder.email ?? shopifyOrder.customer?.email ?? null;

  // Customer: email → phone → create.
  let customerId: string;
  const byEmail = email
    ? await sql`SELECT id FROM customers WHERE "companyId" = ${companyId} AND email = ${email} AND "deletedAt" IS NULL LIMIT 1`
    : [];
  if (byEmail.length > 0) {
    customerId = byEmail[0].id;
  } else if (phone) {
    const byPhone = await sql`
      SELECT id FROM customers
      WHERE "companyId" = ${companyId} AND ("phoneNumber1" = ${phone} OR "phoneNumber2" = ${phone})
        AND "deletedAt" IS NULL LIMIT 1`;
    customerId = byPhone.length > 0 ? byPhone[0].id : "";
  } else {
    customerId = "";
  }
  if (!customerId) {
    // phoneNumber1 is NOT NULL in the schema (no default) — orders without a
    // phone get an empty string, matching manual entry behaviour.
    const created = await sql`
      INSERT INTO customers (id, "createdAt", "updatedAt", "companyId", name, "phoneNumber1", email)
      VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${displayName}, ${phone ?? ""}, ${email})
      RETURNING id`;
    customerId = created[0].id;
  }

  // All line items must map to products by SKU before the order is created —
  // order_items."productId" is NOT NULL. Unmapped SKUs are reported as
  // UNMAPPED_SKU sync errors so the merchant can map them and retry.
  const unmappedSkus: string[] = [];
  for (const item of shopifyOrder.line_items) {
    if (!item.sku) { unmappedSkus.push("(بدون SKU)"); continue; }
    const prod = await sql`SELECT id FROM products WHERE "companyId" = ${companyId} AND "skuCode" = ${item.sku} AND "deletedAt" IS NULL LIMIT 1`;
    if (prod.length === 0) unmappedSkus.push(item.sku);
  }
  if (unmappedSkus.length > 0) {
    return { action: "created", orderId: "", orderNumber: "", unmappedSkus };
  }

  // Money, computed once and used for both the order row and its lines.
  // Line price is NET of the line's discount (upstream `_get_item_price`); the
  // discount is spread across the units so the stored unit price stays a unit
  // price, and a fully-discounted line nets to 0, never negative.
  const linePrices: number[] = [];
  let subtotal = 0;
  for (const item of shopifyOrder.line_items) {
    const qty = Number(item.quantity) || 0;
    const gross = Number(item.price) || 0;
    const netUnit = qty > 0 ? Math.max(0, gross - totalDiscount(item) / qty) : gross;
    linePrices.push(netUnit);
    subtotal += netUnit * qty;
  }
  const shippingCost = netShipping(shopifyOrder);
  const orderPrice = subtotal + shippingCost;
  const orderActualPrice = orderPrice;

  // Order + items + sequence in ONE transaction: a failed insert must not leave
  // items without their order, and the sequence increment belongs to the same
  // unit of work (a gap on rollback is fine, a duplicate number is not).
  const rows = await sql.begin(async (tx) => {
    const orderNumber = await nextOrderNumber(tx as unknown as Sql, companyId);

    const order = await tx`
      INSERT INTO orders (id, "createdAt", "updatedAt", "companyId", "orderNumber", type, status,
                          "customerId", "storeId", "externalId", "externalNumber",
                          "shippingCost", "discountPercentage", "orderPrice", "orderActualPrice",
                          "detailedAddress", notes, "currencyCode")
      VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${orderNumber}, 'SALE', 'NEW',
              ${customerId}, ${storeId}, ${externalId}, ${shopifyOrder.name},
              ${shippingCost}, 0, ${orderPrice}, ${orderActualPrice},
              ${shopifyOrder.shipping_address
                ? [shopifyOrder.shipping_address.address1, shopifyOrder.shipping_address.city,
                   shopifyOrder.shipping_address.country, shopifyOrder.shipping_address.zip]
                   .filter(Boolean).join(", ")
                : null}, ${"Shopify order " + shopifyOrder.name}, ${(shopifyOrder.currency ?? "EGP").slice(0, 3)})
      RETURNING id, "orderNumber"`;

    const orderId = order[0].id;
    for (let i = 0; i < shopifyOrder.line_items.length; i++) {
      const item = shopifyOrder.line_items[i];
      // Every SKU was verified above, so the product must exist.
      const prod = await tx`SELECT id FROM products WHERE "companyId" = ${companyId} AND "skuCode" = ${item.sku} AND "deletedAt" IS NULL LIMIT 1`;
      const productId = prod[0].id;
      await tx`
        INSERT INTO order_items (id, "createdAt", "updatedAt", "companyId", "orderId", "productId",
                                 quantity, "unitPrice", "itemDiscountPercentage", "itemDiscountAmount", "discountType")
        VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${orderId},
                ${productId}, ${item.quantity}, ${linePrices[i]}, 0, ${totalDiscount(item)}, 'PERCENTAGE')`;
    }
    return order;
  });

  return { action: "created", orderId: rows[0].id, orderNumber: rows[0].orderNumber, unmappedSkus };
}

export async function recordSyncError(
  sql: Sql,
  companyId: string,
  storeId: string | null,
  storeName: string,
  errorType: string,
  externalId: string,
  errorMessage: string,
  raw?: unknown
): Promise<void> {
  await sql`
    INSERT INTO sync_errors (id, "createdAt", "updatedAt", "companyId", "storeId", "storeName",
                             "errorType", "externalId", "errorMessage", status, "rawJson")
    VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${storeId}, ${storeName},
            ${errorType}, ${externalId}, ${errorMessage}, 'PENDING',
            ${raw ? JSON.stringify(raw) : null}::jsonb)`;

  // Company-wide notification (SYSTEM category) with an anti-spam action key:
  // one unread notification per store+errorType, no matter how many deliveries
  // fail. (notifications has no updatedAt column — only createdAt/readAt.)
  //
  // The message deliberately does NOT carry a "[errorType]" prefix: errorType is
  // an internal identifier (a webhook topic or a synthetic code), so prefixing it
  // showed merchants raw English like "[UNMAPPED_SKU]" in the notification bell.
  // Every message below already says what went wrong in Arabic, and the reader
  // lands on the sync-errors page where the type is labelled — so the code adds
  // nothing for them. (The action key still carries it for anti-spam; that is not
  // user-visible.) Do NOT re-add it as a translated prefix here: that would mean a
  // second copy of the Arabic type map, and two copies drift.
  await sql`
    INSERT INTO notifications (id, "createdAt", "companyId", "userId", title, message, category, link, "isRead", action)
    SELECT gen_random_uuid()::text, now(), ${companyId}, null,
           'فشل مزامنة ' || ${storeName},
           ${errorMessage.slice(0, 2000)},
           'SYSTEM', '/dashboard/sync-errors', false,
           'sync-error:' || ${storeId ?? storeName} || ':' || ${errorType}
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE "companyId" = ${companyId} AND "userId" IS NULL AND category = 'SYSTEM'
        AND "isRead" = false AND action = 'sync-error:' || ${storeId ?? storeName} || ':' || ${errorType}
    )`;
}

// orders/cancelled: mirror the cancellation onto the ingested Mawzun order.
// Ported from upstream cancel_order(): if the order hasn't shipped yet it is
// cancelled outright; if stock already moved (confirmed/delivered), the status
// change is recorded but reversal stays a manual returns-flow decision —
// same boundary upstream draws between cancel and refund/return.
export async function cancelOrder(
  sql: Sql,
  companyId: string,
  storeId: string,
  shopifyOrderId: string,
  reason: string | null
): Promise<"cancelled" | "not_found" | "already_shipped"> {
  const rows = await sql`
    SELECT id, status FROM orders
    WHERE "companyId" = ${companyId} AND "storeId" = ${storeId} AND "externalId" = ${shopifyOrderId}
    LIMIT 1`;
  if (rows.length === 0) return "not_found";

  const status = rows[0].status as string;
  const shipped = status === "ON_THE_WAY" || status === "DELIVERED";
  if (shipped) return "already_shipped";

  await sql`
    UPDATE orders SET status = 'CANCELLED', "updatedAt" = now(), notes =
      COALESCE(notes, '') || ${"\n[Shopify] تم إلغاء الطلب من المتجر" + (reason ? ` — السبب: ${reason}` : "")}
    WHERE id = ${rows[0].id}`;
  return "cancelled";
}
