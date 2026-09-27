-- Trial + billing-category removal, part two.
--
-- The 20260913190000_drop_billing_wallet migration dropped every billing
-- TABLE but left the dormant 'TRIAL' enum value in place, because Postgres
-- could not drop an enum value inside that migration's transaction. Nothing
-- could write TRIAL anymore, so the value sat dormant -- until now.
--
-- ALTER TYPE ... DROP VALUE cannot run inside a transaction block either, so
-- this migration uses the label-rename swap: rename the type to a reserved
-- name, recreate the type without TRIAL / BILLING, cast the column over,
-- then drop the old shell. Every statement here is transactional and safe.
--
-- Payment states: no tax ID yet, so every company is just ACTIVE. Any row
-- that somehow still says TRIAL lands on ACTIVE, and any BILLING notification
-- lands on GENERAL -- the same mapping the wallet removal used.

-- 1. Residual rows first (a CHECK constraint on the new type would reject
--    them at the column rewrite otherwise).
UPDATE "companies" SET "status" = 'ACTIVE'::"CompanyStatus" WHERE "status"::text = 'TRIAL';
UPDATE "notifications" SET "category" = 'GENERAL'::"NotificationCategory" WHERE "category"::text = 'BILLING';

-- 2. Swap the enum types.
ALTER TYPE "CompanyStatus" RENAME TO "CompanyStatus_old";
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

ALTER TABLE "companies" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "companies" ALTER COLUMN "status" TYPE "CompanyStatus" USING ("status"::text)::"CompanyStatus";
ALTER TABLE "companies" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP TYPE "CompanyStatus_old";

ALTER TYPE "NotificationCategory" RENAME TO "NotificationCategory_old";
CREATE TYPE "NotificationCategory" AS ENUM ('GENERAL', 'ORDER', 'INVENTORY', 'SYSTEM');

ALTER TABLE "notifications" ALTER COLUMN "category" DROP DEFAULT;
ALTER TABLE "notifications" ALTER COLUMN "category" TYPE "NotificationCategory" USING ("category"::text)::"NotificationCategory";
ALTER TABLE "notifications" ALTER COLUMN "category" SET DEFAULT 'GENERAL';

DROP TYPE "NotificationCategory_old";
