// Shopify product sync: products/update + products/create webhooks → Mawzun
// products table, and Mawzun → Shopify inventory push.
//
// Ported from frappe/ecommerce_integrations (shopify/product.py,
// shopify/inventory.py — MIT/GPL-3 licensed upstream) onto Mawzun's schema.
//
// Direction 1 (Shopify → Mawzun): upsert the product keyed by its SKU. The
// webhook body carries the full product; no Admin API round-trip needed.
// Variants are flattened: each Shopify variant with a distinct SKU becomes a
// Mawzun ProductVariant under a shared base product (Shopify option1/2/3
// joined as the variant name).
//
// Direction 2 (Mawzun → Shopify): push stock levels for SKUs that exist on
// both sides. StockLevel is per storage location; available = sum(onHand -
// reserved) across locations. Shopify's REST InventoryLevel.set is called per
// inventory_item_id (upstream batches by 50 — kept here as sequential calls
// since the worker is already per-request).
//
// Everything here is raw SQL against the shared DB (camelCase quoted columns).

import type { Sql } from "./db";
import type { ShopifyProduct } from "./shopify";

// ---------- Direction 1: Shopify → Mawzun ----------


// Map Shopify status → Mawzun isActive. Draft/archived products stay inactive
// rather than being hidden from orders entirely (soft state, matches upstream).
function shopifyStatusToActive(status: string | undefined): boolean {
  return status === undefined || status === "active";
}

export async function upsertShopifyProduct(
  sql: Sql,
  companyId: string,
  product: ShopifyProduct
): Promise<"created" | "updated"> {
  const baseSku = product.variants[0]?.sku ?? `SHOPIFY-${product.id}`;
  const isActive = shopifyStatusToActive(product.status);

  return await sql.begin(async (tx) => {
    // Group variants by SKU: variants sharing one SKU collapse into one Mawzun
    // product row (SKU is Mawzun's product identity — orders reference it).
    const bySku = new Map<string, ShopifyProduct["variants"][number]>();
    for (const v of product.variants) {
      const sku = v.sku ?? `SHOPIFY-${product.id}-${v.id}`;
      if (!bySku.has(sku)) bySku.set(sku, v);
    }
    // Linkage ids for the base product (drives the inventory push).
    const v0 = product.variants[0];
    const v0Id = v0 ? String(v0.id) : null;
    const v0ItemId = v0?.inventory_item_id ? String(v0.inventory_item_id) : null;

    // Base product: the first SKU's row is created/updated with the product
    // title; further SKUs become their own products carrying the option names.
    const existing = await tx`
      SELECT id FROM products
      WHERE "companyId" = ${companyId} AND "skuCode" = ${baseSku} AND "deletedAt" IS NULL
      LIMIT 1`;

    let productId: string;
    let action: "created" | "updated";
    if (existing.length > 0) {
      productId = existing[0].id;
      await tx`
        UPDATE products SET "updatedAt" = now(), name = ${product.title}, "isActive" = ${isActive},
                           "shopifyVariantId" = ${v0Id}, "shopifyInventoryItemId" = ${v0ItemId}
        WHERE id = ${productId}`;
      action = "updated";
    } else {
      const created = await tx`
        INSERT INTO products (id, "createdAt", "updatedAt", "companyId", name, "skuCode", "isActive",
                              "shopifyVariantId", "shopifyInventoryItemId")
        VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${product.title}, ${baseSku}, ${isActive},
                ${v0Id}, ${v0ItemId})
        RETURNING id`;
      productId = created[0].id;
      action = "created";
    }

    // Variant rows: one per distinct SKU beyond the base, or attribute rows
    // under the base product when the product genuinely has variants.
    for (const [sku, v] of bySku) {
      const variantName =
        [v.option1, v.option2, v.option3].filter(Boolean).join(" / ") || v.title || product.title;
      const price = Number(v.price) || 0;

      if (sku === baseSku) {
        // Price/variant data lands on the base product itself.
        await tx`
          UPDATE products SET "updatedAt" = now(), price = ${price}, barcode = ${v.barcode ?? null}
          WHERE id = ${productId}`;
        continue;
      }
      const prod = await tx`
        SELECT id FROM products
        WHERE "companyId" = ${companyId} AND "skuCode" = ${sku} AND "deletedAt" IS NULL LIMIT 1`;
      if (prod.length > 0) {
        await tx`
          UPDATE products SET "updatedAt" = now(), price = ${price}, "isActive" = ${isActive},
                              "shopifyVariantId" = ${String(v.id)},
                              "shopifyInventoryItemId" = ${v.inventory_item_id ? String(v.inventory_item_id) : null}
          WHERE id = ${prod[0].id}`;
        continue;
      }
      // Distinct SKU not present: create it as its own product row (Mawzun
      // orders map by product SKU; a separate row keeps ingest 1:1).
      await tx`
        INSERT INTO products (id, "createdAt", "updatedAt", "companyId", name, "skuCode", "isActive", price, barcode,
                              "shopifyVariantId", "shopifyInventoryItemId")
        VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${variantName}, ${sku}, ${isActive}, ${price}, ${v.barcode ?? null},
                ${String(v.id)}, ${v.inventory_item_id ? String(v.inventory_item_id) : null})`;
    }

    // Images: first image as primary. Shopify CDN URLs render directly; the
    // frontend caches them (R2 quota), so no copy step.
    const img = product.image?.src ?? product.images?.[0]?.src;
    if (img) {
      const hasImg = await tx`
        SELECT id FROM product_images WHERE "productId" = ${productId} LIMIT 1`;
      if (hasImg.length === 0) {
        await tx`
          INSERT INTO product_images (id, "createdAt", "updatedAt", "companyId", "productId", "imageUrl", "isPrimary", "sortOrder")
          VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${productId}, ${img}, true, 0)`;
      }
    }

    return action;
  });
}

// ---------- Direction 2: Mawzun → Shopify ----------

export interface InventoryPushRow {
  sku: string;
  available: number; // whole units — Shopify has no fractional stock
  variantId: number;
  inventoryItemId: number;
  locationId: number;
}

// Collect SKUs to push: products active in Mawzun, with stock rows, carrying a
// shopify_variant_id map. The mapping table is populated by products/update
// ingestion (inventory_item_id) — SKUs never seen from Shopify are skipped,
// matching upstream behaviour (it only pushes for mapped Ecommerce Items).
//
// KNOWN LIMITATION — one Shopify location per store. Upstream maps EACH ERPNext
// warehouse to its own Shopify location (shopify_warehouse_mapping); Mawzun
// stores a single `stores.shopifyLocationId`, so stock is SUMMED across every
// storage location and pushed to that one location. For a merchant running
// several Shopify locations the per-location split is lost (the total is right).
// Lifting this needs a warehouse → location mapping table; until then this is
// the documented boundary rather than a silent one.
export async function collectInventoryPush(
  sql: Sql,
  companyId: string,
  limit = 250
): Promise<InventoryPushRow[]> {
  const rows = await sql`
    SELECT p."skuCode" AS sku,
           p."shopifyVariantId" AS "variantId",
           p."shopifyInventoryItemId" AS "inventoryItemId",
           s."shopifyLocationId" AS "locationId",
           GREATEST(0, FLOOR(COALESCE(SUM(sl."onHand" - sl."reserved"), 0)))::int AS available
    FROM products p
    JOIN stock_levels sl ON sl."productId" = p.id
    JOIN stores s ON s."companyId" = p."companyId"
      AND s.platform = 'SHOPIFY' AND s."deletedAt" IS NULL AND s."isActive" = true
    WHERE p."companyId" = ${companyId}
      AND p."deletedAt" IS NULL
      AND p."isActive" = true
      AND p."shopifyVariantId" IS NOT NULL
      AND p."shopifyInventoryItemId" IS NOT NULL
      AND s."shopifyLocationId" IS NOT NULL
    GROUP BY p.id, p."skuCode", p."shopifyVariantId", p."shopifyInventoryItemId", s."shopifyLocationId"
    LIMIT ${limit}`;
  return rows as unknown as InventoryPushRow[];
}

// Admin API: POST /inventory_levels/set.json
//
// A rate limit (429) must not be counted the same as a rejected SKU. The
// reference (inventory.py) batches 50 and commits per batch so a throttle does
// not lose the whole run; here the loop stops early on a retryable failure and
// reports how far it got, so the next hourly run resumes from the same data
// (the push is idempotent — it re-sends current levels, not deltas).
export async function pushInventoryToShopify(
  api: { post: (path: string, body: unknown) => Promise<void> },
  rows: InventoryPushRow[]
): Promise<{ pushed: number; failed: number; rateLimited: boolean }> {
  let pushed = 0;
  let failed = 0;
  let rateLimited = false;

  for (const row of rows) {
    try {
      await api.post("/inventory_levels/set.json", {
        location_id: row.locationId,
        inventory_item_id: row.inventoryItemId,
        available: row.available,
      });
      pushed++;
    } catch (err) {
      failed++;
      // Retryable (429 / 5xx): stop instead of hammering. Every further call
      // would fail the same way, and the run reports a partial success that the
      // caller records as a retryable sync error rather than a data problem.
      const retryable = (err as { retryable?: boolean })?.retryable === true;
      if (retryable) {
        rateLimited = true;
        break;
      }
    }
  }
  return { pushed, failed, rateLimited };
}
