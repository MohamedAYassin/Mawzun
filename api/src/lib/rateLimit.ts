// Redis-backed rate limiting (Layerbase Cloud in production).
//
// Layerbase serves every database on one shared port and routes by TLS SNI
// hostname, so the client must send servername — see tlsOptionsFor() below.
//
// One atomic Lua sliding-window call per checked request: trim timestamps
// older than the window, count, append now. Atomicity is what makes the count
// correct across dynos — the old in-memory limiter counted per process.
//
// Failure contract: Redis down, unreachable, or unconfigured (no REDIS_URL)
// → fail OPEN (request passes, error logged). A cache must never take login
// down. Individual limiters additionally honour their *_DISABLED kill switch.

import type { NextFunction, Request, Response } from "express";
import { Redis } from "ioredis";

import { env } from "../config/env.js";

const REDIS_TIMEOUT_MS = env.REDIS_TIMEOUT_MS;

/** One pooled connection. */
interface PoolSlot {
  client: Redis;
  /** Commands handed to this connection that have not settled yet. Lets the
   *  pool pick the least-busy socket instead of round-robining blindly. */
  inFlight: number;
}

let pool: PoolSlot[] | null = null;
let warnedNoUrl = false;
/** Last transport-level error from any connection (connect refused, TLS, AUTH…). */
let lastRedisError = "none yet";

/**
 * TLS options for the connection URL.
 *
 * Layerbase Cloud serves EVERY database through one shared port and picks the
 * tenant from the TLS SNI hostname in the handshake — not from the port. Node
 * only sends SNI when `servername` is set explicitly, and a bare `rediss://`
 * URL leaves it undefined, so the router cannot tell which database you want
 * and drops the connection mid-handshake. ioredis then retries until the
 * strategy gives up and reports "Connection is closed." on every later call.
 *
 * Setting servername makes the handshake routable.
 */
export function tlsOptionsFor(url: string): { servername: string } | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "rediss:" ? { servername: parsed.hostname } : undefined;
  } catch {
    return undefined;
  }
}

/** Builds one connection with the shared options and lifecycle logging. */
function buildClient(url: string): Redis {
  const tls = tlsOptionsFor(url);
  const c = new Redis(url, {
    maxRetriesPerRequest: 1,
    ...(tls ? { tls } : {}),
    // Reconnect with backoff so a transient blip (cold boot, DNS, rotation)
    // heals without a dyno restart. Never return null: a client that gives up
    // stays dead and fails every subsequent check. Backoff is capped at 2s,
    // so a sustained outage is one cheap attempt every 2s, not a storm —
    // per-request checks still fail open via the timeout.
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  c.on("error", (err: Error) => {
    lastRedisError = `${err?.message ?? err} (status=${c.status})`;
    console.error("[ratelimit] redis error:", lastRedisError);
  });
  // ioredis never emits "error" when the TLS handshake itself fails: the
  // secureConnect handler that binds the error listener is never reached, so
  // the failure is silent and the transport error above stays "none yet".
  // Record the lifecycle so a dead client is visible in the logs.
  c.on("end", () => {
    if (lastRedisError === "none yet") {
      lastRedisError = "client ended before the TLS handshake completed";
    }
    console.error(`[ratelimit] redis client ended — last=${lastRedisError}`);
  });
  return c;
}

/**
 * The connection pool.
 *
 * Built ONCE on first use and reused for the life of the process — there is no
 * per-request client anywhere in this module, and no code path that opens a
 * connection on demand. A process that never rate-limits anything never opens
 * a socket.
 *
 * Size is `REDIS_POOL_MAX` (default 2, hard ceiling 10 — see env.ts for why the
 * ceiling exists and what the pool does and does not buy).
 */
function redisPool(): PoolSlot[] | null {
  const url = env.REDIS_URL;
  if (!url) {
    if (!warnedNoUrl) {
      warnedNoUrl = true;
      console.warn("[ratelimit] REDIS_URL is not set — all limiters are passing open.");
    }
    return null;
  }
  if (!pool) {
    const size = env.REDIS_POOL_MAX;
    pool = Array.from({ length: size }, () => ({ client: buildClient(url), inFlight: 0 }));
    console.info(`[ratelimit] redis pool: ${size} connection(s), reused for the process lifetime`);
  }
  // Replace any connection that exhausted its retries and is now permanently
  // dead — every command on it would reject with "Connection is closed."
  for (const slot of pool) {
    if (slot.client.status === "end") {
      slot.client = buildClient(url);
      slot.inFlight = 0;
    }
  }
  return pool;
}

/** The least-busy pooled connection, or null when Redis is unconfigured. */
function acquire(): PoolSlot | null {
  const p = redisPool();
  if (!p) return null;
  let best = p[0];
  for (const slot of p) {
    if (slot.inFlight < best.inFlight) best = slot;
  }
  return best;
}

const WINDOW_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= max then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, count, oldest[2] and (tonumber(oldest[2]) + window) or (now + window)}
end
redis.call('ZADD', KEYS[1], now, member)
redis.call('PEXPIRE', KEYS[1], window)
return {1, count + 1, now + window}
`;

export interface LimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const OPEN: LimitDecision = { allowed: true, remaining: 0, resetAt: 0 };

function withTimeout<T>(p: Promise<T>): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), REDIS_TIMEOUT_MS)),
  ]);
}

/** One sliding-window check. Never throws — failures resolve fail-open. */
export async function checkLimit(key: string, max: number, windowMs: number): Promise<LimitDecision> {
  const slot = acquire();
  if (!slot) return OPEN;
  slot.inFlight++;
  try {
    const member = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const res = (await withTimeout(
      slot.client.eval(WINDOW_LUA, 1, key, String(Date.now()), String(windowMs), String(max), member) as Promise<unknown>
    )) as [number, number, number] | null;
    if (!res) {
      console.error(`[ratelimit] timeout on ${key} — passing open. last=${lastRedisError}`);
      return OPEN;
    }
    const [allowed, count, resetAt] = res;
    return { allowed: allowed === 1, remaining: Math.max(0, max - count), resetAt };
  } catch (err) {
    console.error(`[ratelimit] check failed on ${key} — passing open: ${(err as Error)?.message ?? err} | last=${lastRedisError}`);
    return OPEN;
  } finally {
    slot.inFlight--;
  }
}

/** Forget a key (successful login wipes its brute-force count). Never throws. */
export async function clearLimit(key: string): Promise<void> {
  const slot = acquire();
  if (!slot) return;
  slot.inFlight++;
  try {
    await withTimeout(slot.client.del(key));
  } catch (err) {
    console.error(`[ratelimit] clear failed on ${key}: ${(err as Error)?.message ?? err} | last=${lastRedisError}`);
  } finally {
    slot.inFlight--;
  }
}

/**
 * Closes every pooled connection. Tests call this in teardown; without it the
 * ioredis sockets stay open forever (their `retryStrategy` never returns null,
 * by design, so they keep reconnecting) and the process never exits.
 *
 * Safe to call when no pool was ever built. A later call rebuilds it.
 */
export async function closeRateLimitRedis(): Promise<void> {
  const p = pool;
  pool = null;
  if (!p) return;
  await Promise.all(
    p.map(async ({ client: c }) => {
      try {
        // `quit` waits for a reply; a wedged socket never answers, so fall back
        // to the synchronous teardown after a short grace period.
        await Promise.race([
          c.quit().catch(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 500)),
        ]);
      } catch {
        // ignore — teardown must not throw
      }
      try {
        c.disconnect();
      } catch {
        // already closed
      }
    })
  );
}

/** First 4 hextets of IPv6 (/64 neighbours share fate); IPv4 unchanged. */
export function subnetIp(ip: string): string {
  if (!ip.includes(":")) return ip;
  return ip.split(":").slice(0, 4).join(":") + "::/64";
}

/** Brute-force key: one targeted attack must not lock out an office on one IP. */
export function authLimitKey(ip: string | undefined, email: string | undefined): string {
  return `rl:auth:${subnetIp(ip ?? "unknown")}:${(email ?? "").toLowerCase()}`;
}

/** Options for the `rateLimiter` Express middleware factory. */
export interface LimiterOptions {
  disabled: boolean;
  max: number;
  windowMs: number;
  /** Same 429 envelope the old limiter returned. */
  message: string;
  key: (req: Request) => string;
}

/** Express middleware. Disabled, unconfigured, or Redis-down → next(). */
export function rateLimiter(opts: LimiterOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (opts.disabled) return next();
    const decision = await checkLimit(opts.key(req), opts.max, opts.windowMs);
    res.setHeader("RateLimit-Limit", opts.max);
    res.setHeader("RateLimit-Remaining", decision.remaining);
    if (decision.resetAt) {
      res.setHeader("RateLimit-Reset", Math.max(0, Math.ceil((decision.resetAt - Date.now()) / 1000)));
    }
    if (!decision.allowed) {
      res.status(429).json({ success: false, message: opts.message, data: null, code: "RATE_LIMITED" });
      return;
    }
    next();
  };
}
