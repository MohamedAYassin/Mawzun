-- Shopify product + inventory linkage (ported from frappe/ecommerce_integrations):
-- products carry their Shopify variant/inventory-item ids (written by
-- products/update ingestion) so stock can be pushed back to Shopify;
-- stores carry the single Shopify location their stock maps to.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "shopifyVariantId" BIGINT,
  ADD COLUMN IF NOT EXISTS "shopifyInventoryItemId" BIGINT;

CREATE INDEX IF NOT EXISTS "products_shopifyVariantId_idx" ON "products" ("shopifyVariantId");

ALTER TABLE "stores"
  ADD COLUMN IF NOT EXISTS "shopifyLocationId" BIGINT;
