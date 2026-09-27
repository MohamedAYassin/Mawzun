// Per-API-key rate limiting over the Layerbase Redis REST endpoint.
//
// Workers cannot open TCP sockets, so this talks to the SAME Redis database the
// backend uses (Redis protocol there, REST here) with plain fetch. Layerbase's
// REST endpoint is Upstash-compatible, so it is the same sliding-window Lua
// script and the same fail-open contract: no config, disabled flag, timeout, or
// upstream error → pass.
//
// The command travels as a JSON array in the BODY, which is the form Layerbase
// documents (`-d '["GET","mykey"]'`) and Upstash accepts too. The alternative
// `/eval/<script>/...` path form would URL-encode the whole multi-line Lua
// script into the request path — fragile, and not what Layerbase documents.

const WINDOW_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= max then
  return {0, count}
end
redis.call('ZADD', KEYS[1], now, member)
redis.call('PEXPIRE', KEYS[1], window)
return {1, count + 1}
`;

export interface AiLimitConfig {
  baseUrl?: string;
  token?: string;
  disabled?: boolean;
  max: number;
  windowMs: number;
  timeoutMs?: number;
}

/**
 * An unconfigured limiter looks exactly like a working one from the outside:
 * every request passes. That is how a missing secret goes unnoticed, so warn
 * once per isolate instead of failing silently.
 */
let warnedUnconfigured = false;

export async function checkAiLimit(key: string, cfg: AiLimitConfig): Promise<boolean> {
  if (cfg.disabled) return true;
  if (!cfg.baseUrl || !cfg.token) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn(
        "ai ratelimit unconfigured — passing open. Set UPSTASH_REDIS_REST_URL and " +
          "UPSTASH_REDIS_REST_TOKEN (Layerbase: the Connect dialog's REST URL + REST Token).",
      );
    }
    return true;
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 10000);
    try {
      const res = await fetch(cfg.baseUrl.replace(/\/$/, ""), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          "EVAL",
          WINDOW_LUA,
          "1",
          key,
          String(Date.now()),
          String(cfg.windowMs),
          String(cfg.max),
          `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ]),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // The body says which problem it is: 401 a rotated or revoked token,
        // 404 a wrong REST URL, 400 a command the endpoint refused.
        const detail = await res.text().catch(() => "");
        console.error(`ai ratelimit upstream ${res.status} ${detail.slice(0, 200)}`);
        return true;
      }
      const data = (await res.json()) as { result?: [number, number]; error?: string };
      if (data.error) {
        console.error("ai ratelimit upstream error:", data.error.slice(0, 200));
        return true;
      }
      return !data.result || data.result[0] === 1;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("ai ratelimit failed open:", String(err).slice(0, 120));
    return true;
  }
}
