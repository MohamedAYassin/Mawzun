-- Orders carry the ISO 4217 currency they were placed in (multi-currency:
-- ingested Shopify orders keep their store currency; default EGP for local).

ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "currencyCode" VARCHAR(3) NOT NULL DEFAULT 'EGP';
