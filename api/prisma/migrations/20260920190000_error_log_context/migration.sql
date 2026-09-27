-- Error breadcrumbs carry enough to diagnose a failure without a repro.
--
-- The trail previously recorded only the shape of the request (route, method,
-- status). That answers "what failed" but not "who hit it, from where, and with
-- what input" — so a 400 was a dead end unless it was reproducible.
--
-- Added:
--   ipAddress, userAgent — the client. Personal data, and deliberately kept
--     only here: the trail is pruned to 200 rows and read by platform staff,
--     and the API never returns it.
--   userId, companyId — the tenant, as ids only, so a breadcrumb ties to a
--     report without a join and without storing a name or an email.
--   body — the REDACTED request body. This is the field that turns
--     "validation failed" into "validation failed on {quantity: -5}". Passwords,
--     tokens, cookies and card data are stripped before the write, and /auth/*
--     bodies are withheld entirely; see src/observability/redact.ts.
--
-- All nullable: existing rows predate these fields and a breadcrumb is still
-- useful without them.
ALTER TABLE error_log
  ADD COLUMN IF NOT EXISTS "ipAddress" VARCHAR(45),
  ADD COLUMN IF NOT EXISTS "userAgent" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "userId"    VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "companyId" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS body        TEXT;
