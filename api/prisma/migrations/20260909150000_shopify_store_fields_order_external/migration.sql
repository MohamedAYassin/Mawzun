-- Shopify store fields + external order identity
-- Created by prisma migrate diff (schema drift fix after --create-only refused non-interactive mode)

ALTER TABLE "stores" ADD COLUMN "shopifyAccessToken" VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE "stores" ADD COLUMN "shopifyWebhookSecret" VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE "stores" ADD COLUMN "shopifyShopDomain" VARCHAR(200) NOT NULL DEFAULT '';
ALTER TABLE "stores" ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "orders" ADD COLUMN "storeId" TEXT;
ALTER TABLE "orders" ADD COLUMN "externalId" VARCHAR(100);
ALTER TABLE "orders" ADD COLUMN "externalNumber" VARCHAR(100);

DO $$ BEGIN
  ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX "orders_companyId_storeId_externalId_key" ON "orders"("companyId", "storeId", "externalId");
CREATE INDEX "orders_storeId_idx" ON "orders"("storeId");

ALTER TABLE "stores" DROP COLUMN IF EXISTS "storeUrl_old";
