-- Error breadcrumbs for the admin panel.
-- Small rolling table (pruned to the newest 200 rows by the capture path).
CREATE TABLE IF NOT EXISTS error_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      VARCHAR(50) NOT NULL DEFAULT 'backend',
  message     VARCHAR(500) NOT NULL,
  route       VARCHAR(200),
  method      VARCHAR(10),
  status      INTEGER,
  "requestId" VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS error_log_created_idx ON error_log ("createdAt" DESC);
