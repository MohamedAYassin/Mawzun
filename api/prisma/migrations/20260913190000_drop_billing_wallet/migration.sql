-- NOTE: the dormant 'TRIAL' value stays in the CompanyStatus enum on purpose:
-- Postgres forbids ALTER TYPE ... DROP VALUE inside a migration transaction,
-- and nothing in the code can write it anymore.

-- Billing/subscription removal: no tax ID yet, so every company is just ACTIVE.
-- Drops the wallet/ledger/withdrawal/payout tables and the billing plan +
-- subscription tables, and takes the Company model back to a plain status.
ALTER TABLE "companies" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
UPDATE "companies" SET "status" = 'ACTIVE' WHERE "status" = 'TRIAL';

ALTER TABLE "companies" DROP COLUMN IF EXISTS "trial_ends_at";
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_planId_fkey";
ALTER TABLE "companies" DROP COLUMN IF EXISTS "plan_id";

DROP TABLE IF EXISTS "withdrawal_requests";
DROP TABLE IF EXISTS "ledger_entries";
DROP TABLE IF EXISTS "payout_methods";
DROP TABLE IF EXISTS "subscriptions";
DROP TABLE IF EXISTS "billing_plans";

DO $$ BEGIN
  DROP TYPE IF EXISTS "LedgerDirection";
  DROP TYPE IF EXISTS "LedgerEntryType";
  DROP TYPE IF EXISTS "WithdrawalStatus";
  DROP TYPE IF EXISTS "PayoutMethodType";
  DROP TYPE IF EXISTS "SubscriptionStatus";
  DROP TYPE IF EXISTS "BillingInterval";
END $$;
