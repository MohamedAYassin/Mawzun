-- Platform-level settings for the admin worker (one shared database; the
-- worker reads/writes this table directly). Currently: the per-worker email
-- notification toggle + recipient. Deliberately NOT company data and NOT a
-- re-introduction of billing state — it backs the admin's own preferences.
CREATE TABLE IF NOT EXISTS "platform_settings" (
    "key" VARCHAR(120) NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);
