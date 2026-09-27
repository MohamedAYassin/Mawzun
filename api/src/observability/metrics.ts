// Prometheus metrics for the Mawzun API.
//
// Design goals:
// - Push model: Heroku dynos cannot be scraped, so a background loop remote-
//   writes the registry to Grafana Cloud Mimir on an interval. The write is
//   fire-and-forget: a metrics outage must never affect request handling
//   (GRACEFUL DEGRADATION = drop, not buffer — a bounded in-memory buffer
//   against a dead endpoint would grow unbounded on a dyno).
// - One registry, module-level singleton, imported by app.ts and the error
//   path so counters update in place.
// - Business gauges (companies/users active, sync backlog) are refreshed on
//   each push cycle by querying Postgres — cheap COUNT(*)s on small tables.
// - Every family is env-switchable (see METRICS_* in .env.example). All
//   switches default to ENABLED; the flag parser fails open so a typo cannot
//   silently blind observability. A disabled family is never REGISTERED, so
//   it is fully absent from /api/v1/metrics and remote write.
import client from "prom-client";
import { env } from "../config/env.js";
import { dbAdmin } from "../config/database.js";
import { encodeRemoteWrite, type RemoteWriteSeries } from "./remoteWrite.js";

export const registry = new client.Registry();

registry.setDefaultLabels({ service: "mawzun-backend", env: env.NODE_ENV });

if (!env.METRICS_DISABLED) client.collectDefaultMetrics({ register: registry });

// Family switches (master switch forces everything off).
const httpMetricsOn = !env.METRICS_DISABLED && !env.METRICS_HTTP_DISABLED;
const authMetricsOn = !env.METRICS_DISABLED && !env.METRICS_AUTH_DISABLED;
const businessMetricsOn = !env.METRICS_DISABLED && !env.METRICS_BUSINESS_DISABLED;

// --- HTTP metrics (registered only when enabled) -----------------------------

const httpRequestsTotal = httpMetricsOn
  ? new client.Counter({
      name: "mawzun_http_requests_total",
      help: "Total HTTP requests by route template, method and status code.",
      labelNames: ["route", "method", "status"] as const,
      registers: [registry],
    })
  : null;

const httpRequestDuration = httpMetricsOn
  ? new client.Histogram({
      name: "mawzun_http_request_duration_seconds",
      help: "Request duration in seconds by route template and method.",
      labelNames: ["route", "method"] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    })
  : null;

const httpErrorsTotal = httpMetricsOn
  ? new client.Counter({
      name: "mawzun_http_errors_total",
      help: "Total 4xx/5xx responses by route template and status class.",
      labelNames: ["route", "method", "class"] as const,
      registers: [registry],
    })
  : null;

/** Records one HTTP request (no-op when the HTTP family is disabled). */
export function observeHttp(opts: {
  route: string;
  method: string;
  status: number;
  durationSeconds: number;
}): void {
  if (!httpRequestsTotal || !httpRequestDuration) return;
  httpRequestsTotal.inc({ route: opts.route, method: opts.method, status: String(opts.status) });
  httpRequestDuration.observe({ route: opts.route, method: opts.method }, opts.durationSeconds);
  const cls = `${Math.floor(opts.status / 100)}xx`;
  if ((cls === "4xx" || cls === "5xx") && httpErrorsTotal) {
    httpErrorsTotal.inc({ route: opts.route, method: opts.method, class: cls });
  }
}

// --- Auth events (registered only when enabled) ------------------------------

const authEventsTotal = authMetricsOn
  ? new client.Counter({
      name: "mawzun_auth_events_total",
      help: "Authentication events by type (login, refresh, logout, signup, impersonation, login_failed).",
      labelNames: ["type"] as const,
      registers: [registry],
    })
  : null;

/** Records one auth event (no-op when the auth family is disabled). */
export function observeAuthEvent(type: string): void {
  authEventsTotal?.inc({ type });
}

// --- Business gauges (registered only when enabled) ---------------------------

const companiesActiveGauge = businessMetricsOn
  ? new client.Gauge({ name: "mawzun_companies_active", help: "Active (non-deleted) companies.", registers: [registry] })
  : null;
const usersActiveGauge = businessMetricsOn
  ? new client.Gauge({ name: "mawzun_users_active", help: "Active (non-deleted) users.", registers: [registry] })
  : null;
const syncErrorsPendingGauge = businessMetricsOn
  ? new client.Gauge({ name: "mawzun_sync_errors_pending", help: "Unresolved sync errors awaiting triage.", registers: [registry] })
  : null;

async function refreshBusinessGauges(): Promise<void> {
  if (!companiesActiveGauge || !usersActiveGauge || !syncErrorsPendingGauge) return;
  try {
    const rows = await dbAdmin.$queryRawUnsafe<[{ companies: bigint; users: bigint; sync_errors: bigint }]>(
      `SELECT
         (SELECT COUNT(*) FROM companies WHERE "deletedAt" IS NULL AND status = 'ACTIVE') AS companies,
         (SELECT COUNT(*) FROM users WHERE "deletedAt" IS NULL AND status = 'ACTIVE') AS users,
         (SELECT COUNT(*) FROM sync_errors WHERE "resolvedAt" IS NULL) AS sync_errors`
    );
    const r = rows[0];
    companiesActiveGauge.set(Number(r.companies));
    usersActiveGauge.set(Number(r.users));
    syncErrorsPendingGauge.set(Number(r.sync_errors));
  } catch {
    // Gauges keep their last value; the next cycle retries. Never throw from
    // metrics — the API must not care whether observability is up.
  }
}

// --- Remote write ------------------------------------------------------------

const METRICS_USERNAME = process.env.GRAFANA_METRICS_INSTANCE_ID ?? "";
const METRICS_PASSWORD = process.env.GRAFANA_API_TOKEN ?? "";
const METRICS_PUSH_URL = process.env.GRAFANA_METRICS_PUSH_URL ?? "";

const PUSH_INTERVAL_MS = env.METRICS_PUSH_INTERVAL_MS;

let pushTimer: ReturnType<typeof setInterval> | null = null;

async function pushOnce(): Promise<"ok" | "skip" | "fail"> {
  if (env.METRICS_DISABLED || env.METRICS_PUSH_DISABLED) return "skip";
  if (!METRICS_PUSH_URL || !METRICS_USERNAME || !METRICS_PASSWORD) return "skip";
  const payload = await registry.metrics();
  // Convert the text exposition into remote-write series (one sample per
  // metric line, timestamped now). Counter/histogram/gauge lines all carry
  // their current value; push timestamp must be in ms.
  const now = Date.now();
  const series: RemoteWriteSeries[] = [];
  for (const line of payload.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s+(\S+)$/);
    if (!m) continue;
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    const labels: Record<string, string> = {};
    const nameMatch = m[1].match(/^([^\{]+)(?:\{(.*)\})?$/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    if (nameMatch[2]) {
      for (const labelMatch of nameMatch[2].matchAll(/(\w+)="([^"]*)"/g)) {
        labels[labelMatch[1]] = labelMatch[2];
      }
    }
    series.push({ labels: { __name__: name, ...labels }, value, timestampMs: now });
  }
  if (series.length === 0) return "skip";
  try {
    const res = await fetch(METRICS_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-protobuf",
        "Content-Encoding": "snappy",
        "X-Prometheus-Remote-Write-Version": "0.1.0",
        Authorization: `Basic ${Buffer.from(`${METRICS_USERNAME}:${METRICS_PASSWORD}`).toString("base64")}`,
      },
      body: Buffer.from(encodeRemoteWrite(series)) as unknown as NonNullable<Parameters<typeof fetch>[1]>["body"],
      signal: AbortSignal.timeout(8000),
    });
    return res.ok ? "ok" : "fail";
  } catch {
    return "fail"; // endpoint unreachable → drop this cycle (documented degradation)
  }
}

/**
 * Starts the remote-write loop and the business-gauge refresh. Idempotent:
 * calling twice (tests, hot reload) never stacks intervals. With the master
 * switch on, this is a no-op (nothing is collected, nothing is pushed).
 */
export function startMetricsPush(): void {
  if (pushTimer || env.METRICS_DISABLED) return;
  void refreshBusinessGauges();
  pushTimer = setInterval(() => {
    void refreshBusinessGauges().then(pushOnce);
  }, PUSH_INTERVAL_MS);
  pushTimer.unref?.();
}

export function stopMetricsPush(): void {
  if (pushTimer) clearInterval(pushTimer);
  pushTimer = null;
}
