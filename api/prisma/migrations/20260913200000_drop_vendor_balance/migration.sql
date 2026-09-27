-- Vendor balance was only ever written by the removed wallet ledger, so it has
-- been a frozen zero on every row. Drop the column instead of showing a
-- number that can never change.
ALTER TABLE "vendors" DROP COLUMN IF EXISTS "balance";
