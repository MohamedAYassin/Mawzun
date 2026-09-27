-- Per-key AI throttle overrides (null = worker env default).
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rateLimitMax" INTEGER;
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "rateLimitWindowMs" INTEGER;
