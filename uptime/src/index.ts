// Mawzun status monitor — uptime page on Workers + D1.
//
// Cron (every 5 min by default) hits every service in the CHECKS list, stores
// one row per check in D1, trims history past 90 days, and sends Telegram
// alerts on down/recovered transitions. GET / serves the status page,
// GET /api/status serves the same data as JSON.
//
// The service list, brand name and links are configuration, not code:
// see src/checks.ts for the defaults and README.md + .dev.vars.example for
// every environment variable.
//
// One-off setup (needs Cloudflare login):
//   npx wrangler d1 create mawzun-status   → paste database_id into wrangler.jsonc
//   npx wrangler deploy
//   npx wrangler domains add status.your-domain.org
// Local: npm run dev (local D1, no auth). Trigger a check round manually:
//   curl -X POST http://localhost:8793/run -H "x-admin-key: $ADMIN_KEY"

import { Check, brand, parseChecks } from "./checks";
import { page, type Incident, type ServiceStatus } from "./render";
import { sanitizeUserText } from "./sanitize";

export interface Env {
  DB: D1Database;
  /** JSON array of checks — replaces the built-in defaults when set. */
  CHECKS?: string;
  /** Shortcut: when set, overrides the "webhook" check url with <url>/healthz. */
  SHOPIFY_WEBHOOK_URL?: string;
  /** Branding shown on the page (defaults: "Mawzun", https://mawzun.org). */
  SITE_NAME?: string;
  SITE_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ADMIN_KEY?: string;
}

// CHECKS is the whole service list. SHOPIFY_WEBHOOK_URL stays as a one-var
// shortcut: it (re)points the "webhook" entry at <url>/healthz, adding the
// entry if the custom list dropped it.
function checks(env: Env): Check[] {
  const list = parseChecks(env.CHECKS);
  const hook = (env.SHOPIFY_WEBHOOK_URL ?? "").trim().replace(/\/$/, "");
  if (!hook) return list;
  const existing = list.find((c) => c.id === "webhook");
  if (existing) {
    existing.url = `${hook}/healthz`;
    existing.contains = "ok";
  } else {
    list.push({ id: "webhook", name: "Shopify sync", url: `${hook}/healthz`, contains: "ok" });
  }
  return list;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pings (
  id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  status INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_pings_id_ts ON pings (id, ts);
CREATE INDEX IF NOT EXISTS idx_pings_ts ON pings (ts);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'investigating',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
-- Daily rollups: one row per service per day. The page reads THESE
-- (90 tiny rows) instead of scanning every raw ping, so read cost is flat
-- forever no matter how much history accumulates.
CREATE TABLE IF NOT EXISTS rollups (
  id TEXT NOT NULL,
  date TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  sumMs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (id, date)
);`;

// Raw pings exist only to answer "what was the last ping". Everything
// historical (uptime, latency, the day bars) comes from rollups, so we
// trim raw pings aggressively — 48h is far more than any reader needs.
const RAW_RETENTION_MS = 48 * 60 * 60_000;

async function ensureSchema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
}

interface PingResult {
  id: string;
  ok: boolean;
  ms: number;
  status: number;
  error: string | null;
}

async function ping(c: Check): Promise<PingResult> {
  const start = Date.now();
  try {
    const res = await fetch(c.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "mawzun-status/1.0" },
    });
    const ms = Date.now() - start;
    const text = await res.text().catch(() => "");
    if (res.status !== 200) {
      return { id: c.id, ok: false, ms, status: res.status, error: `HTTP ${res.status}` };
    }
    if (c.contains && !text.includes(c.contains)) {
      return { id: c.id, ok: false, ms, status: res.status, error: "body mismatch" };
    }
    return { id: c.id, ok: true, ms, status: res.status, error: null };
  } catch (e) {
    const ms = Date.now() - start;
    const msg = e instanceof Error ? e.name : "fetch failed";
    return { id: c.id, ok: false, ms, status: 0, error: msg };
  }
}

async function telegram(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  }).catch(() => {});
}

async function runChecks(env: Env): Promise<PingResult[]> {
  await ensureSchema(env.DB);
  const list = checks(env).filter((c) => c.url);
  const results = await Promise.all(list.map(ping));
  const names = new Map(list.map((c) => [c.id, c.name]));

  const batch: D1PreparedStatement[] = [];
  for (const r of results) {
    const prev = await env.DB.prepare(
      "SELECT ok FROM pings WHERE id = ? ORDER BY ts DESC LIMIT 1"
    )
      .bind(r.id)
      .first<{ ok: number }>();
    const wasOk = prev ? prev.ok === 1 : true; // first-ever ping never alerts
    if (prev && wasOk && !r.ok) {
      await telegram(env, `🔴 ${names.get(r.id)} is DOWN — ${r.error ?? "no response"} (${r.ms}ms)\n${new Date().toISOString()}`);
    } else if (prev && !wasOk && r.ok) {
      await telegram(env, `✅ ${names.get(r.id)} recovered (${r.ms}ms)`);
    }
    batch.push(
      env.DB.prepare("INSERT INTO pings (id, ts, ok, ms, status, error) VALUES (?, ?, ?, ?, ?, ?)").bind(
        r.id,
        Date.now(),
        r.ok ? 1 : 0,
        r.ms,
        r.status,
        r.error
      )
    );
    // Today's rollup bucket: exactly one UPSERT per check, no read needed.
    // Each ping is counted once, at insert time — never re-scanned.
    batch.push(
      env.DB.prepare(
        `INSERT INTO rollups (id, date, n, ok, sumMs)
         VALUES (?, date('now'), 1, ?, ?)
         ON CONFLICT(id, date) DO UPDATE SET n = n + 1, ok = ok + excluded.ok, sumMs = sumMs + excluded.sumMs`
      ).bind(r.id, r.ok ? 1 : 0, r.ok ? r.ms : 0)
    );
  }
  await env.DB.batch(batch);
  await env.DB.prepare("DELETE FROM pings WHERE ts < ?").bind(Date.now() - RAW_RETENTION_MS).run();
  invalidateStatus(); // manual /run in the same isolate: drop stale cache immediately
  return results; 
}

async function getStatus(env: Env): Promise<{ services: ServiceStatus[]; incidents: Incident[]; checkedAt: string; overallUptime: number | null }> {
  await ensureSchema(env.DB);
  const list = checks(env);
  const services: ServiceStatus[] = [];
  let sumN = 0;
  let sumOk = 0;
  for (const c of list) {
    const disabled = !c.url;
    const last = await env.DB.prepare(
      "SELECT ok, ms, error, ts FROM pings WHERE id = ? ORDER BY ts DESC LIMIT 1"
    )
      .bind(c.id)
      .first<{ ok: number; ms: number; error: string | null; ts: number }>();
    // Flat-cost reads: one indexed row + ≤90 tiny rollup rows. Raw pings are
    // never scanned, so a page view costs the same on day 900 as day 1.
    const roll = await env.DB.prepare(
      "SELECT date, n, ok, sumMs FROM rollups WHERE id = ? ORDER BY date DESC LIMIT 90"
    )
      .bind(c.id)
      .all<{ date: string; n: number; ok: number; sumMs: number }>();
    const buckets = roll.results ?? [];
    const totalN = buckets.reduce((a, b) => a + b.n, 0);
    const totalOk = buckets.reduce((a, b) => a + b.ok, 0);
    const totalMs = buckets.reduce((a, b) => a + b.sumMs, 0);
    if (!disabled) {
      sumN += totalN;
      sumOk += totalOk;
    }
    services.push({
      id: c.id,
      name: c.name,
      url: c.url,
      disabled,
      up: disabled ? null : last ? last.ok === 1 : null,
      uptime90: totalN > 0 ? Math.round((totalOk / totalN) * 1000) / 10 : null,
      latencyMs: totalOk > 0 ? Math.round(totalMs / totalOk) : null,
      lastError: last?.error ?? null,
      days: buckets
        .slice()
        .reverse()
        .map((b) => ({ date: b.date, uptime: b.n > 0 ? Math.round((b.ok / b.n) * 1000) / 10 : null })),
    });
  }
  const inc = await env.DB.prepare(
    "SELECT id, title, body, status, createdAt, updatedAt FROM incidents ORDER BY CASE WHEN status = 'resolved' THEN 1 ELSE 0 END, createdAt DESC LIMIT 20"
  ).all<Incident>();
  return {
    services,
    incidents: inc.results ?? [],
    checkedAt: new Date().toISOString(),
    // Every check of every enabled service over the trailing 90 days, as one
    // number — the platform-wide uptime, not an average of averages.
    overallUptime: sumN > 0 ? Math.round((sumOk / sumN) * 1000) / 10 : null,
  };
}

// In-memory status cache: D1 is read at most once every 5 minutes per
// isolate; every request in between is served from memory with zero DB
// reads. One shared promise keeps parallel cold requests from stampeding
// the DB, and a cold/evicted isolate just re-reads once. Staleness is
// bounded by the check cadence (cron runs every 5 min too).
type StatusPayload = Awaited<ReturnType<typeof getStatus>>;
const STATUS_TTL_MS = 5 * 60_000;
let statusCache: { data: StatusPayload; at: number } | null = null;
let statusInflight: Promise<StatusPayload> | null = null;

async function getStatusCached(env: Env): Promise<StatusPayload> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.data;
  if (!statusInflight) {
    statusInflight = getStatus(env)
      .then((data) => {
        statusCache = { data, at: Date.now() };
        return data;
      })
      .finally(() => {
        statusInflight = null;
      });
  }
  return statusInflight;
}

function invalidateStatus(): void {
  statusCache = null;
}

// Baseline hardening on every response. No scripts exist on this page, so
// CSP forbids them outright; Google Fonts is the only cross-origin need.
const SEC_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

// Constant-time admin-key comparison: `===` short-circuits on the first
// differing byte, which network-timing analysis could (in principle) read.
// Hand-rolled XOR fold (no node:crypto type deps) — always walks the full
// buffer, so timing is independent of where the mismatch is.
function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function adminKeyOk(presented: string | null, expected: string | undefined): boolean {
  if (!presented || !expected) return false;
  return ctEqual(new TextEncoder().encode(presented), new TextEncoder().encode(expected));
}

async function handleAdminIncident(request: Request, env: Env, url: URL): Promise<Response> {
  if (!adminKeyOk(request.headers.get("x-admin-key"), env.ADMIN_KEY)) {
    return new Response("unauthorized", { status: 401 });
  }
  await ensureSchema(env.DB);

  const create = url.pathname === "/api/incidents";
  if (create) {
    const body = (await request.json().catch(() => null)) as { title?: unknown; body?: unknown } | null;
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    const text = typeof body?.body === "string" ? body.body.trim() : "";
    if (!title || title.length > 300) return Response.json({ error: "title (1–300 chars) is required" }, { status: 400 });
    if (text.length > 2000) return Response.json({ error: "body must be ≤2000 chars" }, { status: 400 });
    const now = Date.now();
    const created = await env.DB.prepare(
      "INSERT INTO incidents (title, body, status, createdAt, updatedAt) VALUES (?, ?, 'investigating', ?, ?) RETURNING id, title, body, status, createdAt, updatedAt"
    )
      // Strip all markup at write time (plain-text incidents by design); the
      // renderer still escapes on output as a second layer.
      .bind(sanitizeUserText(title), sanitizeUserText(text), now, now)
      .first<Incident>();
    return Response.json(created, { status: 201 });
  }

  // POST /api/incidents/:id/resolve
  const m = url.pathname.match(/^\/api\/incidents\/(\d+)\/resolve$/);
  if (!m) return new Response("Not found", { status: 404 });
  const updated = await env.DB.prepare(
    "UPDATE incidents SET status = 'resolved', updatedAt = ? WHERE id = ?"
  )
    .bind(Date.now(), Number(m[1]))
    .run();
  if (!updated.meta.changes) return Response.json({ error: "incident not found" }, { status: 404 });
  return Response.json({ ok: true });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/status") {
        return Response.json(await getStatusCached(env), { headers: SEC_HEADERS });
      }
      if (request.method === "POST" && (url.pathname === "/api/incidents" || /^\/api\/incidents\/\d+\/resolve$/.test(url.pathname))) {
        const res = await handleAdminIncident(request, env, url);
        invalidateStatus(); // a new/resolved incident must not sit hidden behind the cache
        return res;
      }
      if (url.pathname === "/run" && request.method === "POST") {
        if (!adminKeyOk(request.headers.get("x-admin-key"), env.ADMIN_KEY)) {
          return new Response("unauthorized", { status: 401 });
        }
        return Response.json(await runChecks(env), { headers: SEC_HEADERS });
      }
      if (url.pathname !== "/") return new Response("Not found", { status: 404 });
      const site = brand(env);
      return new Response(page(site, await getStatusCached(env)), {
        headers: { "content-type": "text/html; charset=utf-8", ...SEC_HEADERS },
      });
    } catch (e) {
      // A broken CHECKS value or DB fault must read as a clear error, not a
      // silent Cloudflare 1101 — this page is the thing you trust when
      // everything else is on fire.
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`status page error: ${msg}`, { status: 500 });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runChecks(env));
  },
};
