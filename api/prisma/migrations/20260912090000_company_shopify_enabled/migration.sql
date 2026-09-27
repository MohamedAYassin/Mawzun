-- Per-company Shopify switch: companies on deployments without webhook
-- capability can disable Shopify entirely. Default enabled.

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "shopifyEnabled" BOOLEAN NOT NULL DEFAULT true;
