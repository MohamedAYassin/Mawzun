// Product export: Mawzun → Shopify.
//
// The missing direction. Import (orders/products from Shopify) and the stock
// push already exist; this creates or updates the PRODUCT itself on Shopify so
// a catalogue built in Mawzun can be sold there.
//
// Two operations, chosen per product by the linkage ids that product ingestion
// already writes:
//
//   shopifyVariantId IS NULL  -> POST /products.json   (create, then store the
//                                                      returned ids)
//   shopifyVariantId IS SET   -> PUT  /products/{id}.json (update that product)
//
// Writing the ids back after a create is what makes this idempotent. Without it
// the second push would see a null id and create a DUPLICATE product on Shopify
// — which is the one failure mode that is expensive to clean up by hand.
//
// Scope, deliberately: one product = one Shopify product with a single default
// variant. Mawzun's variants are separate rows with their own SKU (that is how
// order ingest maps them 1:1), so a "product family" is exported as several
// Shopify products rather than one multi-variant product. Merging them would
// need a family→product mapping that does not exist, and would break the SKU
// correspondence the order ingest depends on.

import type { Db } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { BadRequestError, NotFoundError } from "../../shared/errors.js";
import { env } from "../../config/env.js";
import { openToken } from "./secretbox.js";
import { assertShopifyEnabled } from "./stores.js";

// Prisma client or transaction client — raw SQL via $queryRaw.
type Tx = Db | PrismaClient;

const MAX_PRODUCTS_PER_RUN = env.SHOPIFY_EXPORT_MAX_PRODUCTS;
const API_VERSION = "2026-01";

/** A Shopify Admin API failure carrying its status, so callers can tell a
 *  permanent rejection (422 bad payload) from a retryable one (429, 5xx). */
export class ShopifyExportError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ShopifyExportError";
    this.status = status;
    this.retryable = status === 429 || status >= 500;
  }
}

interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  skuCode: string | null;
  barcode: string | null;
  price: string;
  weightKg: string | null;
  isActive: boolean;
  shopifyVariantId: string | null;
  imageUrl: string | null;
}

export interface ExportSummary {
  requested: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { productId: string; sku: string | null; message: string }[];
}

export const ExportProductsSchema = {
  parse(body: unknown): { productIds: string[] } {
    const b = (body ?? {}) as { productIds?: unknown };
    if (!Array.isArray(b.productIds)) {
      throw new BadRequestError("حدد منتجاً واحداً على الأقل للتصدير.");
    }
    const ids = b.productIds.filter((v): v is string => typeof v === "string" && v.length > 0);
    if (ids.length === 0) throw new BadRequestError("حدد منتجاً واحداً على الأقل للتصدير.");
    // Bounded so one request cannot open an unbounded number of Admin API calls.
    if (ids.length > MAX_PRODUCTS_PER_RUN) {
      throw new BadRequestError(
        `الحد الأقصى ${MAX_PRODUCTS_PER_RUN} منتجاً في المرة. قسّم التحديد ثم أعد المحاولة.`
      );
    }
    return { productIds: ids };
  },
};

/**
 * Creates or updates the given products on the store's Shopify catalogue.
 *
 * Per product: a create that succeeds but whose id write-back fails is reported
 * as a failure — the next run would otherwise duplicate it. A Shopify rejection
 * is recorded per product and does not stop the rest of the batch.
 */
export async function exportProductsToStore(
  tx: Tx,
  companyId: string,
  storeId: string,
  productIds: string[]
): Promise<ExportSummary> {
  await assertShopifyEnabled();

  const store = await tx.store.findFirst({
    where: { id: storeId, companyId, deletedAt: null, platform: "SHOPIFY" },
    select: { id: true, name: true, shopifyShopDomain: true, shopifyAccessToken: true },
  });
  if (!store) throw new NotFoundError("المتجر غير موجود أو ليس متجر Shopify.");
  if (!store.shopifyShopDomain || !store.shopifyAccessToken) {
    throw new BadRequestError("المتجر غير مهيأ للتصدير — بيانات اعتماد Shopify ناقصة.");
  }

  const products = await loadProducts(tx, companyId, productIds);
  const token = await openToken(store.shopifyAccessToken, env.APP_SECRET);
  const api = new ShopifyProductApi(store.shopifyShopDomain, token);

  const summary: ExportSummary = {
    requested: productIds.length,
    created: 0, updated: 0, skipped: 0, failed: 0, errors: [],
  };

  for (const product of products) {
    // A product without a SKU cannot be matched back on the Shopify side (order
    // ingest maps by SKU), so exporting one would create an order line that can
    // never be ingested. Skip it and say so rather than creating that trap.
    if (!product.skuCode) {
      summary.skipped++;
      summary.errors.push({ productId: product.id, sku: null, message: "المنتج بلا رمز SKU — لا يمكن مطابقته عند استيراد الطلبات." });
      continue;
    }
    try {
      const payload = buildPayload(product);
      if (product.shopifyVariantId) {
        await api.updateProduct(product.shopifyVariantId, payload);
        summary.updated++;
      } else {
        const created = await api.createProduct(payload);
        // Persist the linkage BEFORE counting the product as done: an id we
        // failed to store is a duplicate waiting to happen.
        await tx.$executeRaw`
          UPDATE products
          SET "shopifyVariantId" = ${created.variantId},
              "shopifyInventoryItemId" = ${created.inventoryItemId},
              "updatedAt" = now()
          WHERE id = ${product.id} AND "companyId" = ${companyId}`;
        summary.created++;
      }
    } catch (err) {
      summary.failed++;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ productId: product.id, sku: product.skuCode, message });
      await recordExportError(tx, companyId, store, product, message);
    }
  }

  if (summary.created > 0 || summary.updated > 0) {
    await tx.store.update({ where: { id: store.id }, data: { lastSyncedAt: new Date() } });
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function loadProducts(tx: Tx, companyId: string, ids: string[]): Promise<ProductRow[]> {
  // One query for the whole selection. The primary image comes from the same
  // product_images ordering the list endpoint uses, so what the operator sees
  // in the table is what gets exported.
  //
  // The id list goes through Prisma.join (the idiom the report modules use)
  // rather than `= ANY($1::text[])`: passing a JS array as a single parameter
  // does not bind to a text[] here and the query silently matched nothing.
  const rows = await tx.$queryRaw<ProductRow[]>`
    SELECT p.id, p.name, p.description, p."skuCode", p.barcode,
           p.price::text AS price, p."weightKg"::text AS "weightKg", p."isActive",
           p."shopifyVariantId"::text AS "shopifyVariantId",
           (SELECT pi."imageUrl" FROM product_images pi
             WHERE pi."productId" = p.id
             ORDER BY pi."isPrimary" DESC, pi."sortOrder" ASC
             LIMIT 1) AS "imageUrl"
    FROM products p
    WHERE p."companyId" = ${companyId}
      AND p."deletedAt" IS NULL
      AND p.id IN (${Prisma.join(ids)})`;
  return rows;
}

/** Shopify's product payload for one Mawzun product (single default variant). */
function buildPayload(p: ProductRow) {
  return {
    product: {
      title: p.name,
      body_html: p.description ?? undefined,
      status: p.isActive ? "active" : "draft",
      // No vendor/product_type mapping exists in the schema; sending them empty
      // would overwrite a merchant's own values on update, so they are omitted.
      variants: [
        {
          sku: p.skuCode,
          price: Number(p.price).toFixed(2),
          barcode: p.barcode ?? undefined,
          // Shopify takes grams.
          grams: p.weightKg ? Math.round(Number(p.weightKg) * 1000) : undefined,
          inventory_management: "shopify",
        },
      ],
      ...(p.imageUrl ? { images: [{ src: p.imageUrl }] } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Admin API
// ---------------------------------------------------------------------------

/** Minimal Admin API client for the product endpoints. */
export class ShopifyProductApi {
  private readonly base: string;
  constructor(
    private readonly shopDomain: string,
    private readonly accessToken: string
  ) {
    this.base = `https://${shopDomain}/admin/api/${API_VERSION}`;
  }

  async createProduct(payload: unknown): Promise<{ productId: string; variantId: string; inventoryItemId: string | null }> {
    const body = await this.send("POST", "/products.json", payload);
    const product = (body as { product?: ShopifyProductResponse }).product;
    const variant = product?.variants?.[0];
    if (!product?.id || !variant?.id) {
      throw new ShopifyExportError("Shopify لم تُرجع معرّف المنتج.", 502);
    }
    return {
      productId: String(product.id),
      variantId: String(variant.id),
      inventoryItemId: variant.inventory_item_id ? String(variant.inventory_item_id) : null,
    };
  }

  async updateProduct(variantId: string, payload: unknown): Promise<void> {
    // The stored id is the VARIANT id, so the product id must be resolved from
    // it. GET /variants/{id}.json carries product_id, which is what PUT needs.
    const variant = (await this.send("GET", `/variants/${variantId}.json`)) as {
      variant?: { product_id?: number };
    };
    const productId = variant.variant?.product_id;
    if (!productId) {
      throw new ShopifyExportError(`لم يتم العثور على المنتج المرتبط بالمُعرّف ${variantId}.`, 404);
    }
    await this.send("PUT", `/products/${productId}.json`, payload);
  }

  private async send(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        "X-Shopify-Access-Token": this.accessToken,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      // Shopify explains a 422 in the body; without it the operator sees only a
      // status number and cannot fix the product.
      const detail = await res.text().catch(() => "");
      throw new ShopifyExportError(
        `Shopify ${method} ${path} → ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        res.status
      );
    }
    if (res.status === 204) return {};
    return res.json().catch(() => ({}));
  }
}

interface ShopifyProductResponse {
  id: number;
  variants?: { id: number; inventory_item_id?: number | null }[];
}

// ---------------------------------------------------------------------------
// Error trail
// ---------------------------------------------------------------------------

/** One PENDING sync error per product, with the same anti-spam notification
 *  shape the ingest path uses (one unread per store+type). */
async function recordExportError(
  tx: Tx,
  companyId: string,
  store: { id: string; name: string },
  product: ProductRow,
  message: string
): Promise<void> {
  try {
    await tx.$executeRaw`
      INSERT INTO sync_errors (id, "createdAt", "updatedAt", "companyId", "storeId", "storeName",
                               "errorType", "externalId", "errorMessage", status, "rawJson")
      VALUES (gen_random_uuid()::text, now(), now(), ${companyId}, ${store.id}, ${store.name},
              'PRODUCT_EXPORT', ${product.skuCode ?? product.id}, ${message.slice(0, 2000)}, 'PENDING',
              ${JSON.stringify({ productId: product.id, sku: product.skuCode })}::jsonb)`;
  } catch {
    // The export result already reports the failure; losing the trail row must
    // not turn a reported failure into a 500.
  }
}
