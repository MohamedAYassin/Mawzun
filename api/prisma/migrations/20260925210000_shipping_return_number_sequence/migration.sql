-- Allocate shipping-return references atomically, like every other numbered
-- document in the system.
--
-- The create handler derived the reference from a row count:
--
--     const taken = await tx.shippingReturn.count({ where: { companyId } });
--     const referenceNumber = `RET-${String(taken + 1).padStart(6, "0")}`;
--
-- That is read-then-write. Two requests that overlap both read the same count
-- and compute the same reference, and because (companyId, referenceNumber) is
-- UNIQUE, the loser does not get a duplicate — it fails. Measured against the
-- real pool: 8 concurrent creates produced 3 rows and 5 CONFLICT errors, so
-- three quarters of the throughput was thrown away and the user saw a bare
-- "هذه القيمة مستخدمة بالفعل." for no fault of their own.
--
-- Invoices, purchase orders, production batches and orders already keep a
-- counter on company_settings and increment it atomically inside the same
-- transaction as the insert. This brings returns in line with them rather than
-- inventing a second mechanism.
--
-- DEFAULT 1 matches the other counters, so a company with no returns yet
-- starts at RET-000001.
--
-- The backfill matters for any database that already holds returns: a counter
-- starting at 1 would immediately collide with an existing RET-000001. Each
-- company's counter is therefore advanced past the highest return number it
-- already has. References that do not match the RET-<digits> shape (older rows
-- were created with random references) are ignored by the regex rather than
-- failing the cast, and GREATEST keeps the operation from ever lowering a
-- counter that is already ahead.
ALTER TABLE "company_settings"
  ADD COLUMN "returnPrefix" VARCHAR(20) NOT NULL DEFAULT 'RET',
  ADD COLUMN "returnNextNumber" INTEGER NOT NULL DEFAULT 1;

UPDATE "company_settings" cs
SET "returnNextNumber" = GREATEST(
  cs."returnNextNumber",
  COALESCE((
    SELECT MAX(CAST(SUBSTRING(sr."referenceNumber" FROM 5) AS INTEGER)) + 1
    FROM "shipping_returns" sr
    WHERE sr."companyId" = cs."companyId"
      AND sr."referenceNumber" ~ '^RET-[0-9]+$'
  ), 1)
);
