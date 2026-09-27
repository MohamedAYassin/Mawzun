// Order status mirroring for Shopify fulfillment events.
//
// Ported from frappe/ecommerce_integrations shopify/fulfillment.py — upstream
// creates a Delivery Note per fulfillment; Mawzun's counterpart is the order
// status pipeline (ON_THE_WAY → DELIVERED). orders/fulfilled arrives when the
// merchant ships (or a 3PL ships) on Shopify's side; we mirror it so the
// confirmation/shipping dashboards agree with Shopify.
//
// Boundary: only orders that exist AND came from this store are touched, and
// only in the forward direction (never regress DELIVERED/RETURNED back). A
// fulfillment for an order we don't have is a sync error so the operator can
// backfill it (e.g. it was never ingested because of an unmapped SKU).

import type { Sql } from "./db";

export type FulfillmentOutcome =
  | "marked_on_the_way"
  | "marked_delivered"
  | "already_delivered"
  | "not_found"
  | "skipped_local";

export async function applyFulfillment(
  sql: Sql,
  companyId: string,
  storeId: string,
  shopifyOrderId: string,
  hasTracking: boolean
): Promise<FulfillmentOutcome> {
  const rows = await sql`
    SELECT id, status FROM orders
    WHERE "companyId" = ${companyId} AND "storeId" = ${storeId} AND "externalId" = ${shopifyOrderId}
    LIMIT 1`;
  if (rows.length === 0) return "not_found";

  const status = rows[0].status as string;
  // Local lifecycle states the operator manages manually — Shopify's shipping
  // events must not trample them (e.g. RETURNED handled via shipping-returns).
  const localStates = ["RETURNED", "RETURNED_TO_WAREHOUSE", "CANCELLED"];
  if (localStates.includes(status)) return "skipped_local";
  if (status === "DELIVERED") return "already_delivered";

  // Shopify "fulfilled" = handed to carrier. With tracking we trust it reached
  // the carrier; without, it may still be an in-house handoff — either way the
  // order has left the confirm queue. Map: anything pre-ship → ON_THE_WAY.
  // (True DELIVERED confirmation stays with the carrier flow / cod collection.)
  if (status === "ON_THE_WAY") return "already_delivered"; // no regression, no-op
  if (status === "POSTPONED" || status === "NO_ANSWER") {
    // Customer-service states are operator decisions — a Shopify fulfillment
    // overrides them because the goods physically shipped.
  }

  await sql`
    UPDATE orders SET status = 'ON_THE_WAY', "updatedAt" = now(),
      notes = COALESCE(notes, '') || ${"\n[Shopify] تم شحن الطلب من المتجر" + (hasTracking ? " (برقم تتبع)" : "")}
    WHERE id = ${rows[0].id}`;
  return "marked_on_the_way";
}
