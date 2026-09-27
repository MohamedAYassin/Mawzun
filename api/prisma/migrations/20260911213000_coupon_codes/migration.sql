-- Coupon codes: company-level discount codes redeemable at order creation.
-- A code is either a percentage (percentage, 0-100) or a fixed amount
-- (discountType FIXED, amount in company currency). Optional value floor
-- (minimum order total) and usage cap (maxRedemptions, null = unlimited).
-- Redemptions are counted on the coupon row when an order consumes it.
-- NOTE: company ids are TEXT in this database (uuid(7) strings), so the FK
-- column is TEXT, not UUID.

CREATE TABLE "coupons" (
    "id"                    TEXT PRIMARY KEY,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"             TIMESTAMP(3) NOT NULL,

    "companyId"             TEXT NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,

    "code"                  VARCHAR(60) NOT NULL,
    "discountType"          "DiscountType" NOT NULL DEFAULT 'PERCENTAGE',
    "value"                 DECIMAL(18,2) NOT NULL DEFAULT 0,
    "minOrderTotal"         DECIMAL(18,2),
    "maxRedemptions"        INTEGER,
    "redemptionCount"       INTEGER NOT NULL DEFAULT 0,
    "expiresAt"             TIMESTAMP(3),
    "isActive"              BOOLEAN NOT NULL DEFAULT true,
    "deletedAt"             TIMESTAMP(3),

    CONSTRAINT "coupons_company_code_unique" UNIQUE ("companyId", "code")
);

CREATE INDEX "coupons_companyId_idx" ON "coupons"("companyId");

-- Orders record which coupon was applied (code snapshot survives coupon
-- deletion, mirroring how order line items survive product deletion).
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "couponId" TEXT REFERENCES "coupons"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "couponCode" VARCHAR(60);
