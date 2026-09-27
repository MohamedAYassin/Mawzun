import "dotenv/config";
import { z } from "zod";

// Fails fast at boot with a readable message rather than surfacing as a
// undefined deep inside a request handler.
// Observability kill-switch schema: "1"/"true"/"yes"/"on" (any case) = the
// named piece is DISABLED; unset/anything-else = enabled (fail open, so a
// typo'd value can never silently blind observability).
const flagsSchema = z
  .string()
  .optional()
  .transform((v) => /^(1|true|yes|on)$/i.test(v ?? ""));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),

  // Restricted role. Subject to row-level security.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // Privileged role. Used for identity resolution, platform admin and seeding.
  //
  // OPTIONAL, defaulting to DATABASE_URL: managed hosts like Heroku expose a
  // single rotating URL and hand out the table-owner role. In that mode RLS
  // cannot filter (the owner bypasses it), so tenant isolation rests on the
  // application-level companyId scoping around every query. Set a separate,
  // non-owner role URL here whenever the host allows it — the database then
  // enforces isolation as defense in depth.
  // Empty string (common when a platform var is cleared) counts as unset.
  DIRECT_DATABASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),

  JWT_KEY: z.string().min(16, "JWT_KEY must be at least 16 characters"),
  // Secret-box key (HKDF → AES-256-GCM) for sealing Shopify access tokens at rest.
  APP_SECRET: z.string().min(16, "APP_SECRET must be at least 16 characters").default("dev-only-app-secret-change-me"),
  JWT_ISSUER: z.string().default("Mawzun"),
  JWT_AUDIENCE: z.string().default("Mawzun-Client"),
  JWT_ACCESS_MINUTES: z.coerce.number().int().positive().default(60),
  JWT_REFRESH_MINUTES: z.coerce.number().int().positive().default(1440),
  JWT_REFRESH_REMEMBER_MINUTES: z.coerce.number().int().positive().default(43200),
  // Cloudflare Turnstile bot protection for login/signup. Unset = verification
  // skipped (local dev); set = missing/invalid token rejects the request.
  TURNSTILE_SECRET: z.string().min(1).optional(),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // Public base URL of the shopify_integration worker (e.g. https://<worker>.<subdomain>.workers.dev).
  // When set, saving a SHOPIFY store auto-registers the sync webhooks on that
  // store's Shopify via the Admin API — no dashboard clicking. Empty/unset in
  // dev keeps registration off.
  SHOPIFY_WEBHOOK_BASE_URL: z.string().url().optional(),

  // SaaS-wide Shopify kill switch. Shopify's sync requires a webhook-capable
  // deployment, so on the shared SaaS it is off by default; self-hosted
  // instances opt in by setting SHOPIFY_FEATURE_ENABLED=1. When off:
  //  - SHOPIFY store create/update-to rejected with self-host guidance
  //  - /settings exposes shopifyEnabled:false so the UI shows the guidance
  //  - webhook auto-registration never runs
  // Accepts 1/true/yes (case-insensitive); anything else = disabled.
  SHOPIFY_FEATURE_ENABLED: z
    .string()
    .optional()
    .transform((v) => /^(1|true|yes)$/i.test((v ?? "").trim())),

  // Per-company caps. Creation past the cap is rejected with 409.
  MAX_API_KEYS_PER_COMPANY: z.coerce.number().int().positive().default(5),
  MAX_SHOPIFY_STORES_PER_COMPANY: z.coerce.number().int().positive().default(3),
  MAX_USERS_PER_COMPANY: z.coerce.number().int().positive().default(10),
  BACKFILL_PAGE_SIZE: z.coerce.number().int().positive().default(250),
  BACKFILL_MAX_PAGES: z.coerce.number().int().positive().default(10),
  // Cap on products per export request: each one is an Admin API call, and the
  // caller re-runs to continue, so a large catalogue cannot hold one request
  // open for hundreds of round-trips.
  SHOPIFY_EXPORT_MAX_PRODUCTS: z.coerce.number().int().positive().default(50),

  // The largest page a list endpoint will serve.
  //
  // This is a ceiling, not a default: each endpoint keeps its own sensible
  // default (25, or 100 for roles) and a caller asking for more is clamped by
  // validation rather than silently given a partial page.
  //
  // It is configurable because the right value depends on the deployment. A
  // self-hosted instance with a fast database and few rows can raise it; a
  // shared instance under load can lower it to bound how much work one request
  // may ask for. Raising it is not free: `pageSize` multiplies the rows the
  // query returns, so a large ceiling on a big table turns one cheap request
  // into an expensive one.
  //
  // The 200 default matches the value that was hardcoded in every list schema
  // before this became a setting, so behaviour is unchanged unless an operator
  // sets it.
  PAGINATION_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(200),

  // Rate limiting + transport tunables.
  // Redis-backed (Upstash). REDIS_URL unset = every limiter fails open
  // (requests pass, error logged) — limits only enforce with REDIS_URL set.
  REDIS_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  // Serverless Redis cold-boots (1–5s), so the cap is generous and tunable.
  // Past it the request fails open — a slow cache must never hang login.
  REDIS_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  // How many Redis connections this process may hold.
  //
  // Every connection is created once and REUSED for the life of the process —
  // there is no per-request client anywhere. The pool is built on first use, so
  // a process that never rate-limits anything never opens a socket.
  //
  // Budget: Backend 10, each worker 2 (they reach Redis over REST via fetch,
  // which Cloudflare pools itself, so the figure is documentation there).
  //
  // Honest note on what this buys: Redis executes commands on a SINGLE thread,
  // so N connections do NOT multiply throughput the way N Postgres connections
  // do. ioredis already pipelines on one socket, so one connection handles
  // concurrent checks well. The pool bounds concurrency and limits head-of-line
  // blocking; it is not a parallelism multiplier. 2 is a good default; raise it
  // only if you measure contention.
  REDIS_POOL_MAX: z.coerce.number().int().positive().max(10).default(2),
  // Per-limiter kill switches. Unset (or anything but an explicit negative)
  // = on; 0/false/no = off. Lets you disable one limiter without touching
  // the others or redeploying code.
  RATE_LIMIT_AUTH_DISABLED: z
    .string()
    .optional()
    .transform((v) => /^(0|false|no)$/i.test((v ?? "").trim())),
  RATE_LIMIT_RESET_DISABLED: z
    .string()
    .optional()
    .transform((v) => /^(0|false|no)$/i.test((v ?? "").trim())),
  RATE_LIMIT_SESSION_DISABLED: z
    .string()
    .optional()
    .transform((v) => /^(0|false|no)$/i.test((v ?? "").trim())),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_RESET_WINDOW_MS: z.coerce.number().int().positive().default(86400000),
  RATE_LIMIT_RESET_MAX: z.coerce.number().int().positive().default(1),
  RATE_LIMIT_SESSION_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_SESSION_MAX: z.coerce.number().int().positive().default(300),
  // --- Grafana Cloud observability (all optional: unset = metrics push off,
  // --- /metrics endpoint still serves; app never depends on these) ---
  // Prometheus remote-write URL, e.g. https://prometheus-prod-55-...grafana.net/api/prom/push
  GRAFANA_METRICS_PUSH_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().url().optional()),
  // Numeric instance ID (username for basic auth on remote write).
  GRAFANA_METRICS_INSTANCE_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // Grafana Cloud API token (password for basic auth). Supplied by the operator.
  GRAFANA_API_TOKEN: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  // Alert email contact (used by the provisioning script; informational here).
  // Dedicated logs database (Postgres). When set, error breadcrumbs are
  // written HERE instead of the application database — keeps log volume and
  // retention off the production DB. The logs DB holds only error_log.
  LOG_DATABASE_URL: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  GRAFANA_ALERT_EMAIL: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  // --- Observability kill switches (all default to enabled) ---
  // Master switch: no metric collection at all; /metrics serves an empty
  // registry; remote write never starts; no business-gauge COUNT queries.
  METRICS_DISABLED: flagsSchema,
  // Skip the HTTP family: mawzun_http_requests_total,
  // mawzun_http_request_duration_seconds, mawzun_http_errors_total.
  METRICS_HTTP_DISABLED: flagsSchema,
  // Skip the auth-event counter: mawzun_auth_events_total.
  METRICS_AUTH_DISABLED: flagsSchema,
  // Skip business gauges (mawzun_companies_active / mawzun_users_active /
  // mawzun_sync_errors_pending) AND the COUNT(*) queries behind them.
  METRICS_BUSINESS_DISABLED: flagsSchema,
  // Collect metrics + serve /metrics, but never remote-write to Grafana.
  METRICS_PUSH_DISABLED: flagsSchema,
  // Push cadence in ms (default 15000 = 15s; minimum 5000).
  METRICS_PUSH_INTERVAL_MS: z.coerce.number().int().min(5000).default(15_000),
  // Error breadcrumbs: when true, captureError() is a no-op (no error_log
  // writes, no http_errors_total increments from the breadcrumb path).
  LOG_BREADCRUMBS_DISABLED: flagsSchema,
  BODY_PARSER_LIMIT: z.string().default("2mb"),
  PASSWORD_RESET_TOKEN_TTL_MS: z.coerce.number().int().positive().default(86400000),
  PASSWORD_RESET_APP_ORIGIN: z.string().url().default("https://app.mawzun.org"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10485760),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const formatted = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${formatted}`);
}

// Single-URL deployments (Heroku): the one connection serves both privilege
// levels. The runtime resolves this once at boot — after Heroku rotates
// credentials, restart the dyno to pick up the new URL.
if (!parsed.data.DIRECT_DATABASE_URL && parsed.data.NODE_ENV === "development") {
  // Locally the two-URL setup is the norm; a missing DIRECT here is usually
  // an accident (lost .env line), not a deliberate single-role deployment.
  console.warn(
    "[env] DIRECT_DATABASE_URL is not set — falling back to DATABASE_URL. " +
      "Login, seeding and platform admin still work only if that role owns the tables."
  );
}
const resolved = {
  ...parsed.data,
  DIRECT_DATABASE_URL: parsed.data.DIRECT_DATABASE_URL ?? parsed.data.DATABASE_URL,
};

export const env = resolved;
