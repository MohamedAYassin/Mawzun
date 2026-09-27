// Error breadcrumb capture: controlled errors land in error_log so the admin
// panel can show a recent-error trail, and the http_errors_total counter
// marks them for Grafana.
//
// LOG DATABASE ISOLATION: breadcrumbs go to the DEDICATED logs database
// (LOG_DATABASE_URL) when configured, keeping log write volume and retention
// completely off the application Postgres. When LOG_DATABASE_URL is unset the
// trail falls back to the main database (dev convenience); set it in production.
//
// WHAT IS RECORDED, and why each field is safe to keep:
//   message, route, method, status, requestId — the shape of the failure.
//   ipAddress, userAgent — who and where. Needed to tell one user hitting a bug
//     from an outage, and to spot an abusive client. Both are personal data:
//     they live only in this trail, pruned to 200 rows, read by platform staff,
//     and never returned by the API.
//   userId, companyId — the tenant, so a breadcrumb can be tied to a report
//     without a join. Ids only, never the email or name.
//   body — the REDACTED request body, and the reason this is worth doing at
//     all: "validation failed" is nearly useless without the payload, while
//     "validation failed on {quantity: -5}" is a bug report.
//
// WHAT IS NEVER RECORDED: passwords, tokens, cookies, card numbers, IBANs,
// signatures — anything whose key looks like a credential — and the body of any
// /auth/* request, withheld wholesale because those bodies ARE the credentials.
// Those rules live in redact.ts, the one place that decides this, so a rule
// cannot be forgotten at one of the three capture sites.
//
// - fire-and-forget: capture() never throws and never awaits in the request
//   path.
// - message truncated to 500 chars; body to 2000.
// - retention: the newest 200 rows, pruned on insert.
import { Pool } from "pg";
import { env } from "../config/env.js";
import { dbAdmin } from "../config/database.js";
import { bodyForLog, truncate } from "./redact.js";

export interface ErrorContext {
  route?: string;
  method?: string;
  status?: number;
  requestId?: string;
  service?: string;
  ipAddress?: string;
  userAgent?: string;
  userId?: string;
  companyId?: string;
  /** Raw request body. Redacted here — callers pass it through untouched. */
  body?: unknown;
}

// Dedicated logs pool (separate database). Lazy + singleton: created on first
// use so importing this module never opens connections in tests.
let logsPool: Pool | null = null;
let logsPoolTried = false;
let schemaEnsured = false;

/**
 * Retention, with server errors protected.
 *
 * The trail keeps the newest 200 rows. That is fine while the only writers are
 * 5xx and the occasional 4xx, but validation failures are now captured too and
 * they are by far the highest-volume 4xx — a broken frontend deploy or a bot
 * can produce thousands in a minute, and 200 rows of that is a few seconds of
 * history. A burst would push out the very 5xx rows you are trying to diagnose,
 * which is the worst possible moment to lose them.
 *
 * So recent 5xx rows are exempt from the prune. The exemption is bounded by
 * TIME rather than by count, so it cannot grow without limit: a sustained error
 * storm keeps at most 24h of 5xx, which is the window anyone actually
 * investigates. The index below is what keeps the predicate cheap — without it
 * the NOT (...) clause is a sequential scan on every single insert.
 */
const LOGS_PRUNE_SQL = `DELETE FROM error_log
  WHERE id NOT IN (
    SELECT id FROM error_log ORDER BY "createdAt" DESC LIMIT 200
  )
  AND NOT (status >= 500 AND "createdAt" > now() - interval '24 hours')`;

const LOGS_PRUNE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS error_log_status_created_idx
  ON error_log (status, "createdAt" DESC)`;

const LOGS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS error_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  source      VARCHAR(50) NOT NULL DEFAULT 'backend',
  message     VARCHAR(500) NOT NULL,
  route       VARCHAR(200),
  method      VARCHAR(10),
  status      INTEGER,
  "requestId" VARCHAR(64),
  "ipAddress" VARCHAR(45),
  "userAgent" VARCHAR(300),
  "userId"    VARCHAR(40),
  "companyId" VARCHAR(40),
  body        TEXT
)`;

/**
 * Brings an EXISTING error_log up to the current shape.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing when the table is already there, so
 * a logs database created before these columns existed would keep the old shape
 * and every insert would fail — silently, because capture swallows its own
 * errors. That is the worst outcome: logging appears configured and records
 * nothing. ADD COLUMN IF NOT EXISTS is idempotent and covers both a live logs
 * database and the main-database fallback.
 */
const LOGS_ADD_COLUMNS_SQL = `ALTER TABLE error_log
  ADD COLUMN IF NOT EXISTS "ipAddress" VARCHAR(45),
  ADD COLUMN IF NOT EXISTS "userAgent" VARCHAR(300),
  ADD COLUMN IF NOT EXISTS "userId"    VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "companyId" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS body        TEXT`;

function getLogsPool(): Pool | null {
  if (logsPool) return logsPool;
  if (logsPoolTried) return null;
  logsPoolTried = true;
  const url = process.env.LOG_DATABASE_URL;
  if (!url) return null;
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
  logsPool = new Pool({
    connectionString: url,
    max: 2, // breadcrumbs are low-volume; keep the footprint tiny
    ssl: isLocal ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
  });
  return logsPool;
}

/** Schema-on-write: ensures error_log exists in the logs DB once per pool.
 *  A fresh hosted logs DB needs zero manual setup. */
async function ensureLogsSchema(pool: Pool): Promise<void> {
  if (schemaEnsured) return;
  await pool.query(LOGS_SCHEMA_SQL);
  await pool.query(LOGS_ADD_COLUMNS_SQL);
  // The prune predicate filters on (status, createdAt); without this the
  // exemption below costs a sequential scan on every insert.
  await pool.query(LOGS_PRUNE_INDEX_SQL);
  schemaEnsured = true;
}

/**
 * Releases the dedicated logs pool. Tests call this in teardown: the pool is a
 * live handle, and without closing it the test process never drains and is
 * killed with SIGTERM after every assertion has already passed.
 *
 * Safe to call when the pool was never created. The pool is recreated lazily on
 * the next capture, so production never needs this.
 */
export async function closeLogsPool(): Promise<void> {
  const pool = logsPool;
  logsPool = null;
  logsPoolTried = false;
  schemaEnsured = false;
  if (!pool) return;
  try {
    await pool.end();
  } catch {
    // already closed / never connected — teardown must not throw
  }
}

export async function captureError(err: unknown, ctx: ErrorContext = {}): Promise<void> {
  if (env.LOG_BREADCRUMBS_DISABLED) return;
  const message = err instanceof Error ? err.message : String(err ?? "unknown error");
  const source = ctx.service ?? "backend";
  const route = ctx.route ?? null;

  // Redacted here, not at the call sites: three handlers build this context,
  // and a rule that must be remembered in three places gets forgotten in one.
  const body = route ? bodyForLog(route, ctx.body) : null;

  const row: (string | number | null)[] = [
    source,
    message.slice(0, 500),
    route,
    ctx.method ?? null,
    ctx.status ?? null,
    ctx.requestId ?? null,
    ctx.ipAddress ?? null,
    // A User-Agent is attacker-controlled and can be arbitrarily long. The
    // column is VARCHAR(300) and Postgres rejects an oversized value outright,
    // which would lose the entire breadcrumb rather than one field.
    ctx.userAgent ? truncate(ctx.userAgent, 300) : null,
    ctx.userId ?? null,
    ctx.companyId ?? null,
    body,
  ];

  const COLUMNS = `source, message, route, method, status, "requestId",
                   "ipAddress", "userAgent", "userId", "companyId", body`;
  const PLACEHOLDERS = "$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11";

  try {
    const pool = getLogsPool();
    if (pool) {
      await ensureLogsSchema(pool);
      // Dedicated logs database (production path).
      await pool.query(
        `INSERT INTO error_log (id, "createdAt", ${COLUMNS}) VALUES (gen_random_uuid(), now(), ${PLACEHOLDERS})`,
        row
      );
      await pool.query(LOGS_PRUNE_SQL);
    } else {
      // Fallback: main database (dev / not yet provisioned).
      await dbAdmin.$executeRawUnsafe(
        `INSERT INTO error_log (id, "createdAt", ${COLUMNS}) VALUES (gen_random_uuid(), now(), ${PLACEHOLDERS})`,
        ...row
      );
      await dbAdmin.$executeRawUnsafe(LOGS_PRUNE_SQL);
    }
  } catch {
    // The breadcrumb table being down must not turn an error into a crash.
  }
}
