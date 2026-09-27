-- Impersonation support: the admin worker (mawzun-admin) mints session rows
-- directly (one shared database, no service-to-service calls) and stamps the
-- acting platform admin's email into "impersonatedBy". The Backend refresh
-- flow carries the value across rotations, so every derived access token
-- announces the impersonation and /auth/me can banner it in the app.
ALTER TABLE "sessions" ADD COLUMN "impersonatedBy" TEXT;
