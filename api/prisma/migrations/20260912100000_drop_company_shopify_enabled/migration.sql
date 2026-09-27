-- Revert: shopifyEnabled moved from company_settings to a SaaS-wide env flag
-- (SHOPIFY_FEATURE_ENABLED) — per-company toggle removed.

ALTER TABLE "company_settings"
  DROP COLUMN IF EXISTS "shopifyEnabled";
