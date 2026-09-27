// Mawzun cleanup worker.
//
// Deletes rows that have outlived their retention window: revoked/expired
// sessions, spent password-reset tokens, read notifications, resolved sync
// errors, and old audit logs. See src/sweeps.ts for why each boundary is where
// it is — the interesting decisions are all about what NOT to delete.
//
// Routes:
//   GET  /healthz   — liveness
//   POST /run       — run the sweeps now (guarded by x-admin-key)
//
// Cron: nightly at 02:17 UTC (see wrangler.jsonc). The manual route exists
// because a retention change should be verifiable immediately rather than
// waiting for the next night.
//
// The Postgres URL is NOT preset: production uses the Hyperdrive binding;
// local dev resolves it live from Heroku's Platform API.

import { makeSql, makeHyperdriveSql, assertCanSeeAllCompanies, type Sql, type SweepResult } from "./db";
import { runAllSweeps, type RetentionConfig } from "./sweeps";
import { makeDbUrlResolver, type DbUrlResolver } from "./dbUrlResolver";

export interface Env {
  HEROKU_API_TOKEN: string;
  HEROKU_APP_NAME: string;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_SSL?: string;
  DB_URL_TTL_MS?: string;
  ADMIN_KEY?: string;

  SESSION_RETENTION_DAYS?: string;
  PASSWORD_RESET_RETENTION_DAYS?: string;
  NOTIFICATION_RETENTION_DAYS?: string;
  SYNC_ERROR_RETENTION_DAYS?: string;
  AUDIT_LOG_RETENTION_DAYS?: string;
}

// Isolate-level cache of the URL string only (no I/O object) — safe to share
// across requests; the SQL client itself stays per-invocation.
const resolverCache = new Map<string, DbUrlResolver>();
function getResolver(env: Env): DbUrlResolver {
  let r = resolverCache.get(env.HEROKU_APP_NAME);
  if (!r) {
    r = makeDbUrlResolver(env);
    resolverCache.set(env.HEROKU_APP_NAME, r);
  }
  return r;
}

function isCredentialError(err: unknown): boolean {
  const msg = String(err);
  return /28P01|28000|password authentication failed|credential/i.test(msg);
}

/** Retention windows, parsed once per invocation. */
function retentionConfig(env: Env): RetentionConfig {
  const num = (v: string | undefined, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    SESSION_RETENTION_DAYS: num(env.SESSION_RETENTION_DAYS, 45),
    PASSWORD_RESET_RETENTION_DAYS: num(env.PASSWORD_RESET_RETENTION_DAYS, 1),
    NOTIFICATION_RETENTION_DAYS: num(env.NOTIFICATION_RETENTION_DAYS, 14),
    SYNC_ERROR_RETENTION_DAYS: num(env.SYNC_ERROR_RETENTION_DAYS, 90),
    AUDIT_LOG_RETENTION_DAYS: num(env.AUDIT_LOG_RETENTION_DAYS, 365),
  };
}

/** Constant-time admin-key comparison, mirroring uptime/. */
function adminKeyOk(presented: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  if (presented === null) return false;
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "GET" && url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    if (req.method === "POST" && url.pathname === "/run") {
      if (!adminKeyOk(req.headers.get("x-admin-key"), env.ADMIN_KEY)) {
        return new Response("unauthorized", { status: 401 });
      }
      return runSweeps(env);
    }

    return new Response("Not found", { status: 404 });
  },

  // Cron trigger: run every sweep (see wrangler.jsonc crons).
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const res = await runSweeps(env);
    // The cron has no caller to read the body, so the result goes to the
    // invocation log — which is the only place a nightly run can be audited.
    console.log("cleanup run", await res.text());
  },
};

async function runSweeps(env: Env): Promise<Response> {
  let sql: Sql | null = null;
  const startedAt = Date.now();

  try {
    if (env.HYPERDRIVE) {
      sql = makeHyperdriveSql(env.HYPERDRIVE);
    } else {
      sql = makeSql(await getResolver(env).get(), env);
    }

    // Fail loudly instead of reporting a clean run that deleted nothing.
    await assertCanSeeAllCompanies(sql);

    const cfg = retentionConfig(env);
    const results = await runAllSweeps(sql, cfg);
    const total = results.reduce((n, r) => n + r.deleted, 0);
    const errors = results.filter((r) => r.error);

    const body = {
      ok: errors.length === 0,
      deleted: total,
      durationMs: Date.now() - startedAt,
      retention: cfg,
      sweeps: results.map((r: SweepResult) => ({
        label: r.label,
        deleted: r.deleted,
        ...(r.skipped ? { skipped: "retention set to 0 — disabled" } : {}),
        ...(r.error ? { error: r.error } : {}),
      })),
    };
    return Response.json(body, { status: errors.length === 0 ? 200 : 500 });
  } catch (err) {
    // A rotated credential is the one failure worth retrying immediately: the
    // resolver caches the URL, so the stale copy is dropped and one fresh
    // attempt is made. Same behaviour as the other Workers.
    if (sql && isCredentialError(err)) {
      try {
        await sql.end({ timeout: 1 }).catch(() => {});
        const fresh = makeSql(await getResolver(env).get(), env);
        sql = fresh;
        await assertCanSeeAllCompanies(fresh);
        const cfg = retentionConfig(env);
        const results = await runAllSweeps(fresh, cfg);
        const total = results.reduce((n, r) => n + r.deleted, 0);
        return Response.json({ ok: true, deleted: total, retriedAfterCredentialError: true, sweeps: results });
      } catch (retryErr) {
        return Response.json({ ok: false, error: String(retryErr) }, { status: 500 });
      }
    }
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    if (sql) await sql.end({ timeout: 1 }).catch(() => {});
  }
}
