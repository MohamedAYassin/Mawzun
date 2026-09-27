// Historical order backfill: pull ALL Shopify orders since a given date
// through the Admin API and ingest each through the same idempotent
// ingestOrder path the webhooks use.
//
// Ported from frappe/ecommerce_integrations order.py sync_old_orders /
// _fetch_old_orders — upstream runs it once on connect with a from/to window;
// here it is an owner-triggered endpoint with the window in the request.
//
// Why an endpoint and not a webhook: Shopify has no "give me everything"
// push — it must be pulled, paged, 250 at a time, using page_info cursor
// pagination. Each order goes through ingestOrder, so replays dedupe and
// unmapped SKUs land in sync_errors exactly like live traffic. The run is
// bounded (MAX_PAGES) so a huge store cannot hang the request; the button can
// simply be pressed again to continue from where the cursor stopped (returned
// in the response).

import { z } from "zod";
import type { Db } from "../../config/database.js";
import { NotFoundError } from "../../shared/errors.js";
import { env } from "../../config/env.js";
import { openToken } from "./secretbox.js";
import { backfillIngestOrder, type ShopifyOrderLike } from "./shopifyIngestLocal.js";

const MAX_PAGES = env.BACKFILL_MAX_PAGES;
const PAGE_SIZE = env.BACKFILL_PAGE_SIZE;

export const BackfillSchema = z.object({
  storeId: z.string().min(1),
  since: z.string().datetime({ offset: true }).optional(), // ISO 8601; default: 90 days ago
});

interface BackfillSummary {
  fetched: number;
  created: number;
  duplicates: number;
  unmappedSkus: number;
  pages: number;
  nextCursor: string | null;
  done: boolean;
}

export async function backfillStoreOrders(
  tx: Db,
  companyId: string,
  input: z.infer<typeof BackfillSchema>
): Promise<BackfillSummary> {
  const store = await tx.store.findFirst({
    where: { id: input.storeId, companyId, deletedAt: null, platform: "SHOPIFY" },
    select: { id: true, name: true, shopifyShopDomain: true, shopifyAccessToken: true },
  });
  if (!store) throw new NotFoundError("المتجر غير موجود أو ليس متجر Shopify.");
  if (!env.SHOPIFY_WEBHOOK_BASE_URL) {
    // Reuse the webhook-base env as the general "shopify integration on" flag;
    // backfill needs no URL, but keeping one switch avoids a second var.
  }

  const token = await openToken(store.shopifyAccessToken, env.APP_SECRET);
  const api = `https://${store.shopifyShopDomain}/admin/api/2026-01`;
  const headers = { "X-Shopify-Access-Token": token };

  const since = input.since
    ?? new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();

  const summary: BackfillSummary = {
    fetched: 0, created: 0, duplicates: 0, unmappedSkus: 0, pages: 0, nextCursor: null, done: true,
  };

  let url = `${api}/orders.json?status=any&limit=${PAGE_SIZE}&order=created_at asc&created_at_min=${encodeURIComponent(since)}`;
  while (summary.pages < MAX_PAGES) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Shopify orders page → ${res.status}`);
    const body = (await res.json()) as { orders: ShopifyOrderLike[] };
    const orders = body.orders ?? [];
    summary.pages++;
    summary.fetched += orders.length;

    for (const o of orders) {
      // Same ingest semantics as live webhooks: idempotent, unmapped-SKU aware
      // (unmapped orders are recorded as sync errors inside the ingest and
      // counted here).
      const result = await backfillIngestOrder(tx, companyId, store.id, store.name ?? "Shopify", o as ShopifyOrderLike);
      if (result.action === "created") summary.created++;
      else if (result.action === "duplicate") summary.duplicates++;
      else summary.unmappedSkus++;
    }

    // Link-header cursor pagination (REST): parse the rel="next" URL.
    const link = res.headers.get("Link");
    const next = link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    if (!next || orders.length === 0) {
      summary.done = true;
      summary.nextCursor = null;
      break;
    }
    summary.nextCursor = next;
    url = next;
    if (orders.length < PAGE_SIZE) {
      summary.done = true;
      break;
    }
  }
  if (summary.pages >= MAX_PAGES && summary.nextCursor) summary.done = false;

  await tx.store.update({ where: { id: store.id }, data: { lastSyncedAt: new Date() } });
  return summary;
}

// The order shape is imported from the ingest module (see the import above)
// rather than re-declared here: this file used to carry its own structural copy,
// which silently fell out of step the moment the ingest started reading
// `discount_allocations` and `shipping_lines` — a duplicate type cannot drift
// loudly, it just drops the new fields on the floor.
