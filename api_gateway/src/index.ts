// Mawzun AI API worker.
//
// GET /                — API index + docs link
// GET /healthz         — liveness
// /v1/*                — agent endpoints (Authorization: Bearer <mawzun api key>)
//                        reads + writes; every mutation is company-scoped by key.
//
// The Postgres URL is NOT preset: it is resolved from the Heroku backend's
// internal endpoint on first use (and re-resolved after credential rotation
// failures). Every request gets its own SQL client (workerd forbids sharing
// sockets across request contexts); it is closed in a finally block.

import { makeSql, makeHyperdriveSql, verifyApiKey } from "./auth";
import { makeDbUrlResolver, type DbUrlResolver } from "./dbUrlResolver";
import { routes } from "./routes";
import { checkAiLimit } from "./ratelimit.js";
import { bodyForLog } from "./redact";

interface Env {
  HEROKU_API_TOKEN: string;
  HEROKU_APP_NAME: string;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_SSL?: string;
  DB_URL_TTL_MS?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  // Neutral aliases for the same two values. The database is Layerbase; these
  // exist so a fresh setup does not have to spell "UPSTASH" to reach it.
  // UPSTASH_* wins when both are present.
  REDIS_REST_URL?: string;
  REDIS_REST_TOKEN?: string;
  AI_RATE_LIMIT_DISABLED?: string;
  AI_RATE_LIMIT_MAX?: string;
  AI_RATE_LIMIT_WINDOW_MS?: string;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

// Isolate-level cache of the URL string only (no I/O object) — safe to share
// across requests; the SQL client itself stays per-request.
const resolverCache = new Map<string, DbUrlResolver>();
function getResolver(env: Env): DbUrlResolver {
  let r = resolverCache.get(env.HEROKU_APP_NAME);
  if (!r) {
    r = makeDbUrlResolver(env);
    resolverCache.set(env.HEROKU_APP_NAME, r);
  }
  return r;
}

// Postgres authentication/rotation failures worth one retry with a fresh URL.
function isCredentialError(err: unknown): boolean {
  const msg = String(err);
  return /28P01|28000|password authentication failed|credential/i.test(msg);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (url.pathname === "/healthz") {
      return new Response("ok", { headers: { ...cors, "Content-Type": "text/plain" } });
    }

    if (url.pathname === "/" || url.pathname === "") {
      // Derived from the live route table, not a hand-kept list. The literal
      // that used to sit here advertised 18 endpoints while the worker served
      // ~119 — a list that describes a different API than the one running is
      // worse than no list, because it is believed.
      //
      // Deduped by path and carrying the verbs: five routes share one path, and
      // listing the path five times (the first cut of this) reads as a bug in
      // the API rather than a description of it.
      const byPath = new Map<string, string[]>();
      for (const r of routes) {
        const path = `/${r.segments.join("/")}`;
        const verbs = byPath.get(path) ?? [];
        verbs.push(r.method);
        byPath.set(path, verbs);
      }
      const endpoints = [...byPath.entries()]
        .map(([path, verbs]) => ({ path, methods: [...new Set(verbs)].sort() }))
        .sort((a, b) => a.path.localeCompare(b.path));
      return json(
        {
          name: "Mawzun AI API",
          version: "v1",
          docs: "https://docs.mawzun.org",
          endpointCount: endpoints.length,
          endpoints,
          auth: "Authorization: Bearer <api key>",
        },
        200
      );
    }

    if (!url.pathname.startsWith("/v1/")) {
      return json({ error: "not found — see https://docs.mawzun.org" }, 404);
    }

    const auth = request.headers.get("Authorization") ?? "";
    const presented = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!presented) {
      return json({ error: "مفتاح API مفقود. أرسل Authorization: Bearer <key>" }, 401);
    }

    const resolver = getResolver(env);
    // Hyperdrive binding wins when present (production: pooled, no per-query
    // socket storm). Otherwise resolve the URL live from Heroku (local dev).
    let sql;
    if (env.HYPERDRIVE) {
      sql = makeHyperdriveSql(env.HYPERDRIVE);
    } else {
      let dbUrl: string;
      try {
        dbUrl = await resolver.get();
      } catch (err) {
        console.error("db-url resolve failed", err);
        const msg = String(err);
        // Surface the failure class (status only, never credentials) so a 503 is
        // diagnosable from the outside: 401 = HEROKU_API_TOKEN rejected;
        // 404 = wrong HEROKU_APP_NAME; anything else = Heroku API unreachable.
        const m = msg.match(/heroku config-vars (\d{3})/);
        const reason = m
          ? m[1] === "401"
            ? "auth"
            : m[1] === "404"
              ? "origin"
              : `upstream-${m[1]}`
          : "unreachable";
        return json({ error: "تعذر الاتصال بقاعدة البيانات. حاول مجدداً.", reason }, 503);
      }
      sql = makeSql(dbUrl, env);
    }
    try {
      const verifyWithRotationRetry = async () => {
        try {
          return await verifyApiKey(sql, presented);
        } catch (err) {
          if (!isCredentialError(err)) throw err;
          // Heroku rotated credentials — fetch the fresh URL and retry once.
          resolver.invalidate();
          let freshUrl: string;
          try {
            freshUrl = await resolver.get();
          } catch {
            throw err; // resolve failed too: report the original DB error below
          }
          const fresh = makeSql(freshUrl, env);
          try {
            return await verifyApiKey(fresh, presented);
          } finally {
            fresh.end({ timeout: 1 }).catch(() => {});
          }
        }
      };
      let key;
      try {
        key = await verifyWithRotationRetry();
      } catch (err) {
        console.error("verify error", url.pathname, err);
        return json({ error: "خطأ داخلي في الخدمة." }, 500);
      }
      if (!key) {
        return json({ error: "مفتاح API غير صالح أو ملغى." }, 401);
      }

      // Per-key throttle (Redis-backed, fail-open). Each key gets its own
      // window; a per-key override set on the API-keys screen wins over the
      // worker env defaults, null = default.
      // Kill switch: AI_RATE_LIMIT_DISABLED=0/false/no. Unset = on.
      const aiDisabled = /^(0|false|no)$/i.test((env.AI_RATE_LIMIT_DISABLED ?? "").trim());
      const envMax = Math.max(1, parseInt(env.AI_RATE_LIMIT_MAX ?? "600", 10) || 600);
      const envWindow = Math.max(1000, parseInt(env.AI_RATE_LIMIT_WINDOW_MS ?? "60000", 10) || 60000);
      const aiAllowed = await checkAiLimit(`rl:ai:${key.keyId}`, {
        baseUrl: env.UPSTASH_REDIS_REST_URL ?? env.REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN ?? env.REDIS_REST_TOKEN,
        disabled: aiDisabled,
        max: key.rateLimitMax ?? envMax,
        windowMs: key.rateLimitWindowMs ?? envWindow,
      });
      if (!aiAllowed) {
        return json({ error: "طلبات كثيرة جداً. انتظر دقيقة وحاول مجدداً.", code: "RATE_LIMITED" }, 429);
      }

      // Route match: /v1/orders/:id etc. POST/PATCH/DELETE carry a JSON body.
      const segs = url.pathname.split("/").filter(Boolean);
      let body: unknown = null;
      if (request.method !== "GET") {
        const text = await request.text();
        if (text.trim()) {
          try {
            body = JSON.parse(text);
          } catch {
            return json({ error: "invalid JSON body" }, 400);
          }
        }
      }
      const ctx = { body, env: env as unknown as Record<string, unknown> };
      for (const route of routes) {
        if (route.method !== request.method || route.segments.length !== segs.length) continue;
        const params: Record<string, string> = {};
        let ok = true;
        for (let i = 0; i < segs.length; i++) {
          const pat = route.segments[i];
          if (pat.startsWith(":")) params[pat.slice(1)] = decodeURIComponent(segs[i]);
          else if (pat !== segs[i]) { ok = false; break; }
        }
        if (!ok) continue;
        try {
          const res = await route.handler(sql, key.companyId, params, url, ctx);
          res.headers.set("Access-Control-Allow-Origin", "*");
          return res;
        } catch (err) {
          if (isCredentialError(err)) {
            // Rotation mid-request: retry the handler once on a fresh connection.
            resolver.invalidate();
            let freshUrl: string;
            try {
              freshUrl = await resolver.get();
            } catch {
              throw err; // resolve failed too: report the original DB error below
            }
            const fresh = makeSql(freshUrl, env);
            try {
              const res = await route.handler(fresh, key.companyId, params, url, ctx);
              res.headers.set("Access-Control-Allow-Origin", "*");
              return res;
            } finally {
              fresh.end({ timeout: 1 }).catch(() => {});
            }
          }
          // Client context on every server error. Without this the log line was
          // just a path, which cannot answer "which caller, from where, with
          // what payload" — the three things needed to tell one agent's bad
          // request from a broken deploy.
          //
          // The API KEY IS NEVER LOGGED. Only the company it resolves to
          // (`key.companyId`), which is an id the operator already holds and
          // which is what actually identifies the caller for support.
          //
          // Cloudflare stores these lines (observability is enabled in
          // wrangler.jsonc). They are not written to the error_log breadcrumb
          // table: that table is the Backend's trail, and a Worker writing into
          // it would need the privileged role for no benefit here.
          console.error("handler error", {
            route: url.pathname,
            method: request.method,
            companyId: key.companyId,
            ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? null,
            userAgent: request.headers.get("user-agent") ?? null,
            // The body is the payload that failed, redacted. This is a
            // machine-facing write API, so "which payload was rejected" is the
            // whole question — but it is also where an agent might put a
            // secret, so credentials are stripped first.
            body: bodyForLog(ctx.body),
            // The query string is NOT logged: it can carry ids and, for some
            // clients, tokens. `route` already says which endpoint failed.
            error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          });
          return json({ error: "خطأ داخلي في الخدمة." }, 500);
        }
      }
      return json({ error: "endpoint not found — see https://docs.mawzun.org" }, 404);
    } finally {
      sql.end({ timeout: 1 }).catch(() => {});
    }
  },
};

// json with extra handling is defined locally to include CORS on errors.
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: status < 400, data }), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
