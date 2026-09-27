// Local re-implementation of the webhook worker's order ingest for the
// backfill path. The worker keeps its own copy (Workers can't import from the
// Backend tree); the SQL is identical and must stay identical — see the
// worker's src/ingest.ts for the full design notes (idempotency key,
// customer resolution, unmapped-SKU gate).
//
// Differences from the worker version:
// - tx is a Prisma client, so raw SQL goes through $queryRaw/$executeRaw.
// - Unmapped SKUs are recorded through recordSyncError (shared module) instead
//   of being returned for the webhook handler to record.

import type { Db } from "../../config/database.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

// Any Prisma client or transaction client works — raw SQL via $queryRaw.
type Tx = Db | PrismaClient;

export interface BackfillIngestResult {
  action: "created" | "duplicate" | "unmapped";
}

/** One discounted amount on a line, or on the order's shipping. */
interface ShopifyDiscountAllocation {
  amount: string | number;
}

interface ShopifyLineItem {
  sku: string | null;
  quantity: number;
  price: string;
  title: string;
  discount_allocations?: ShopifyDiscountAllocation[] | null;
}

export interface ShopifyOrderLike {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  currency?: string | null;
  customer?: { first_name?: string; last_name?: string; email?: string; phone?: string } | null;
  line_items: ShopifyLineItem[];
  shipping_address?: {
    address1?: string; city?: string; country?: string; zip?: string; phone?: string;
  } | null;
  shipping_lines?: { price?: string | number; discount_allocations?: ShopifyDiscountAllocation[] | null }[] | null;
}

/**
 * Sum of every discount allocation on a line.
 *
 * Shopify reports the gross price in `price` and puts the reduction in
 * `discount_allocations[]`; upstream subtracts it before writing the item
 * (order.py `_get_total_discount`). Not doing that books a discounted order at
 * full price — the customer paid less than the order says.
 */
function totalDiscount(item: ShopifyLineItem): number {
  let sum = 0;
  for (const d of item.discount_allocations ?? []) sum += Number(d.amount) || 0;
  return sum;
}

/**
 * Shipping actually charged: the sum of shipping lines, net of their own
 * discounts. Shopify's order-level `shipping_lines` is authoritative — the
 * address carries no amount.
 */
function netShipping(o: ShopifyOrderLike): number {
  let sum = 0;
  for (const line of o.shipping_lines ?? []) {
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
async function nextOrderNumber(tx: Tx, companyId: string): Promise<string> {
  const rows = (await tx.$queryRaw<{ orderPrefix: string; orderNextNumber: number }[]>`
    INSERT INTO company_settings (id, "createdAt", "updatedAt", "companyId", "orderPrefix", "orderNextNumber")
    VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, 'ORD', 2)
    ON CONFLICT ("companyId") DO UPDATE
      SET "orderNextNumber" = company_settings."orderNextNumber" + 1, "updatedAt" = now()
    RETURNING "orderPrefix", "orderNextNumber"`) as { orderPrefix: string; orderNextNumber: number }[];
  const s = rows[0];
  // The counter is stored as the NEXT number to hand out; the Backend subtracts
  // one for the same reason (orders.ts nextOrderNumber).
  return `${s.orderPrefix}-${String(s.orderNextNumber - 1).padStart(6, "0")}`;
}

export async function backfillIngestOrder(
  tx: Tx,
  companyId: string,
  storeId: string,
  storeName: string,
  o: ShopifyOrderLike
): Promise<BackfillIngestResult> {
  const externalId = String(o.id);

  // NOTE: every id column in this schema is TEXT, not uuid (Prisma models use
  // String @id @default(uuid(7)) and the migration created TEXT). A `::uuid`
  // cast here fails with `operator does not exist: text = uuid` — it is not a
  // no-op. Plain parameters, no cast.
  const existing = (await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM orders
    WHERE "companyId" = ${companyId} AND "storeId" = ${storeId} AND "externalId" = ${externalId}
    LIMIT 1`) as { id: string }[];
  if (existing.length > 0) return { action: "duplicate" };

  const displayName =
    o.customer
      ? [o.customer.first_name, o.customer.last_name].filter(Boolean).join(" ").trim()
      : o.email?.split("@")[0] ?? "عميل Shopify";
  const phone = o.phone ?? o.customer?.phone ?? o.shipping_address?.phone ?? null;
  const email = o.email ?? o.customer?.email ?? null;

  let customerId: string | null = null;
  if (email) {
    const rows = (await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM customers WHERE "companyId" = ${companyId} AND email = ${email} AND "deletedAt" IS NULL LIMIT 1`) as { id: string }[];
    customerId = rows[0]?.id ?? null;
  }
  if (!customerId && phone) {
    const rows = (await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM customers
      WHERE "companyId" = ${companyId} AND ("phoneNumber1" = ${phone} OR "phoneNumber2" = ${phone})
        AND "deletedAt" IS NULL LIMIT 1`) as { id: string }[];
    customerId = rows[0]?.id ?? null;
  }
  if (!customerId) {
    const created = (await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO customers (id, "createdAt", "updatedAt", "companyId", name, "phoneNumber1", email)
      VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${displayName}, ${phone ?? ""}, ${email})
      RETURNING id`) as { id: string }[];
    customerId = created[0].id;
  }

  // Unmapped-SKU gate BEFORE any order insert (order_items.productId NOT NULL).
  const unmapped: string[] = [];
  for (const item of o.line_items) {
    if (!item.sku) { unmapped.push("(بدون SKU)"); continue; }
    const prod = (await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products
      WHERE "companyId" = ${companyId} AND "skuCode" = ${item.sku} AND "deletedAt" IS NULL LIMIT 1`) as { id: string }[];
    if (prod.length === 0) unmapped.push(item.sku);
  }
  if (unmapped.length > 0) {
    const msg = `أصناف بدون مطابقة SKU: ${unmapped.join(", ")}`;
    await tx.$executeRaw`
      INSERT INTO sync_errors (id, "createdAt", "updatedAt", "companyId", "storeId", "storeName",
                               "errorType", "externalId", "errorMessage", status, "rawJson")
      VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${storeId}, ${storeName},
              'UNMAPPED_SKU', ${externalId}, ${msg}, 'PENDING',
              ${JSON.stringify({ skus: unmapped, order: o })}::jsonb)`;
    return { action: "unmapped" };
  }

  const orderNumber = await nextOrderNumber(tx, companyId);

  const address = o.shipping_address
    ? [o.shipping_address.address1, o.shipping_address.city, o.shipping_address.country, o.shipping_address.zip]
        .filter(Boolean).join(", ")
    : null;

  // Totals are computed here because the schema defaults them to 0 and nothing
  // recomputes them later: the status-change path leaves them alone, so an
  // ingested order would sit at 0 forever and the revenue reports (which SUM
  // orderActualPrice) would count every Shopify sale as zero.
  //
  // Line price is NET of the line's discount, matching upstream's
  // `_get_item_price`; `orderPrice` is the gross including shipping, and
  // `orderActualPrice` is what the customer actually paid.
  let subtotal = 0;
  const linePrices: number[] = [];
  for (const item of o.line_items) {
    const qty = Number(item.quantity) || 0;
    const gross = Number(item.price) || 0;
    // Spread the line discount across the units so the stored unit price stays
    // a unit price. A fully-discounted line nets to 0, never negative.
    const netUnit = qty > 0 ? Math.max(0, gross - totalDiscount(item) / qty) : gross;
    linePrices.push(netUnit);
    subtotal += netUnit * qty;
  }
  const shippingCost = netShipping(o);
  const orderPrice = subtotal + shippingCost;
  const orderActualPrice = orderPrice;

  const order = (await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO orders (id, "createdAt", "updatedAt", "companyId", "orderNumber", type, status,
                        "customerId", "storeId", "externalId", "externalNumber",
                        "shippingCost", "discountPercentage", "orderPrice", "orderActualPrice",
                        "detailedAddress", notes, "currencyCode")
    VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${orderNumber}, 'SALE', 'NEW',
            ${customerId}, ${storeId}, ${externalId}, ${o.name},
            ${shippingCost}, 0, ${orderPrice}, ${orderActualPrice},
            ${address}, ${"Shopify order " + o.name}, ${(o.currency ?? "EGP").slice(0, 3)})
    RETURNING id`) as { id: string }[];

  for (let i = 0; i < o.line_items.length; i++) {
    const item = o.line_items[i];
    const prod = (await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products WHERE "companyId" = ${companyId} AND "skuCode" = ${item.sku} AND "deletedAt" IS NULL LIMIT 1`) as { id: string }[];
    await tx.$executeRaw`
      INSERT INTO order_items (id, "createdAt", "updatedAt", "companyId", "orderId", "productId",
                               quantity, "unitPrice", "itemDiscountPercentage", "itemDiscountAmount", "discountType")
      VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${order[0].id},
              ${prod[0].id}, ${item.quantity}, ${linePrices[i]}, 0, ${totalDiscount(item)}, 'PERCENTAGE')`;
  }

  return { action: "created" };
}
