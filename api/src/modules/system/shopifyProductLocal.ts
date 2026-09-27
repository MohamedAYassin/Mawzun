// Local product upsert for the retry path — Prisma-$queryRaw mirror of the
// worker's src/products.ts upsertShopifyProduct. The worker keeps its own copy
// (Workers cannot import from the Backend tree); the SQL MUST stay identical.
// See the worker file for full design notes (SKU grouping, linkage ids, image).

import type { Db } from "../../config/database.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

type Tx = Db | PrismaClient;

export interface ShopifyProductLike {
  id: number;
  title: string;
  status?: string;
  image?: { src?: string } | null;
  images?: { src: string }[];
  variants: {
    id: number;
    sku: string | null;
    title?: string;
    option1?: string | null;
    option2?: string | null;
    option3?: string | null;
    price: string;
    barcode?: string | null;
    inventory_item_id?: number | null;
  }[];
}

export async function upsertShopifyProductLocal(
  tx: Tx,
  companyId: string,
  product: ShopifyProductLike
): Promise<void> {
  const isActive = product.status === undefined || product.status === "active";
  const baseSku = product.variants[0]?.sku ?? `SHOPIFY-${product.id}`;
  const v0 = product.variants[0];
  const v0Id = v0 ? String(v0.id) : null;
  const v0ItemId = v0?.inventory_item_id ? String(v0.inventory_item_id) : null;

  const bySku = new Map<string, ShopifyProductLike["variants"][number]>();
  for (const v of product.variants) {
    const sku = v.sku ?? `SHOPIFY-${product.id}-${v.id}`;
    if (!bySku.has(sku)) bySku.set(sku, v);
  }

  const existing = (await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM products
    WHERE "companyId" = ${companyId}::uuid AND "skuCode" = ${baseSku} AND "deletedAt" IS NULL
    LIMIT 1`) as { id: string }[];

  let productId: string;
  if (existing.length > 0) {
    productId = existing[0].id;
    await tx.$executeRaw`
      UPDATE products SET "updatedAt" = now(), name = ${product.title}, "isActive" = ${isActive},
                         "shopifyVariantId" = ${v0Id}, "shopifyInventoryItemId" = ${v0ItemId}
      WHERE id = ${productId}`;
  } else {
    const created = (await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO products (id, "createdAt", "updatedAt", "companyId", name, "skuCode", "isActive",
                            "shopifyVariantId", "shopifyInventoryItemId")
      VALUES (gen_random_uuid()::text, now(), now(), ${companyId}::uuid, ${product.title}, ${baseSku}, ${isActive},
              ${v0Id}, ${v0ItemId})
      RETURNING id`) as { id: string }[];
    productId = created[0].id;
  }

  for (const [sku, v] of bySku) {
    const variantName =
      [v.option1, v.option2, v.option3].filter(Boolean).join(" / ") || v.title || product.title;
    const price = Number(v.price) || 0;
    if (sku === baseSku) {
      await tx.$executeRaw`
        UPDATE products SET "updatedAt" = now(), price = ${price}, barcode = ${v.barcode ?? null}
        WHERE id = ${productId}`;
      continue;
    }
    const prod = (await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM products
      WHERE "companyId" = ${companyId}::uuid AND "skuCode" = ${sku} AND "deletedAt" IS NULL LIMIT 1`) as { id: string }[];
    if (prod.length > 0) {
      await tx.$executeRaw`
        UPDATE products SET "updatedAt" = now(), price = ${price}, "isActive" = ${isActive},
                            "shopifyVariantId" = ${String(v.id)},
                            "shopifyInventoryItemId" = ${v.inventory_item_id ? String(v.inventory_item_id) : null}
        WHERE id = ${prod[0].id}`;
      continue;
    }
    await tx.$executeRaw`
      INSERT INTO products (id, "createdAt", "updatedAt", "companyId", name, "skuCode", "isActive", price, barcode,
                            "shopifyVariantId", "shopifyInventoryItemId")
      VALUES (gen_random_uuid()::text, now(), now(), ${companyId}::uuid, ${variantName}, ${sku}, ${isActive}, ${price}, ${v.barcode ?? null},
              ${String(v.id)}, ${v.inventory_item_id ? String(v.inventory_item_id) : null})`;
  }

  const img = product.image?.src ?? product.images?.[0]?.src;
  if (img) {
    const hasImg = (await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM product_images WHERE "productId" = ${productId} LIMIT 1`) as { id: string }[];
    if (hasImg.length === 0) {
      await tx.$executeRaw`
        INSERT INTO product_images (id, "createdAt", "updatedAt", "companyId", "productId", "imageUrl", "isPrimary", "sortOrder")
        VALUES (gen_random_uuid()::text, now(), now(), ${companyId}::uuid, ${productId}, ${img}, true, 0)`;
    }
  }
}
