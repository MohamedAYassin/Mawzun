// Verifies the rate limiter's sliding-window logic WITHOUT connecting to Redis.
//
// Redis is a hosted third-party instance this machine does not own, so the
// limiter cannot be exercised against the real thing. What CAN be checked is
// whether the logic is correct, and that is what this does:
//
//   1. The Lua script is read out of src/lib/rateLimit.ts at run time — not
//      copied here — so the thing under test cannot drift from the thing that
//      ships.
//   2. It runs in fengari (a pure-JS Lua VM) against a mock `redis.call` that
//      implements only the five commands the script uses, with real sorted-set
//      semantics.
//   3. The pure helpers (subnetIp, authLimitKey, tlsOptionsFor) are imported
//      from the built module and checked directly.
//
// So this proves the window arithmetic, the allow/deny boundary, the reset
// time, and the key derivation — everything except the socket.
//
// Needs the `fengari` devDependency (a pure-JS Lua VM). If it is missing, run
// `npm install` in Backend/ first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let fengari;
try {
  fengari = (await import("fengari")).default;
} catch {
  console.error("FAIL: fengari is not installed. Run `npm install` in Backend/ first.");
  process.exit(1);
}

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

const here = path.dirname(fileURLToPath(import.meta.url));

// ── pull the REAL script out of the TypeScript source ───────────────────────
const source = fs.readFileSync(path.join(here, "src/lib/rateLimit.ts"), "utf8");
const match = source.match(/const WINDOW_LUA = `([\s\S]*?)`;/);
if (!match) {
  console.error("FAIL: could not find WINDOW_LUA in src/lib/rateLimit.ts");
  process.exit(1);
}
const WINDOW_LUA = match[1];
console.log(`loaded WINDOW_LUA from source (${WINDOW_LUA.split("\n").length} lines)\n`);

// ── a mock Redis with real sorted-set semantics ─────────────────────────────
function makeRedis() {
  /** key -> Map(member -> score) */
  const zsets = new Map();
  const get = (k) => zsets.get(k) ?? new Map();

  return {
    zsets,
    call(cmd, ...args) {
      const c = cmd.toUpperCase();
      if (c === "ZREMRANGEBYSCORE") {
        const [key, min, max] = args;
        const z = get(key);
        let removed = 0;
        for (const [m, s] of [...z]) {
          if (s >= Number(min) && s <= Number(max)) { z.delete(m); removed++; }
        }
        zsets.set(key, z);
        return removed;
      }
      if (c === "ZCARD") return get(args[0]).size;
      if (c === "ZRANGE") {
        const [key, start, stop, withScores] = args;
        const entries = [...get(key)].sort((a, b) => a[1] - b[1]);
        const slice = entries.slice(Number(start), Number(stop) + 1);
        return withScores ? slice.flatMap(([m, s]) => [m, String(s)]) : slice.map(([m]) => m);
      }
      if (c === "ZADD") {
        const [key, score, member] = args;
        const z = get(key);
        const isNew = !z.has(member);
        z.set(member, Number(score));
        zsets.set(key, z);
        return isNew ? 1 : 0;
      }
      if (c === "PEXPIRE") return 1;
      throw new Error(`mock redis: unhandled command ${cmd}`);
    },
  };
}

// ── run WINDOW_LUA once, returning [allowed, count, resetAt] ────────────────
function runScript(redis, key, now, windowMs, max, member) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  // redis.call
  lua.lua_newtable(L);
  lua.lua_pushjsfunction(L, (L2) => {
    const n = lua.lua_gettop(L2);
    const args = [];
    for (let i = 1; i <= n; i++) {
      if (lua.lua_isnumber(L2, i)) args.push(lua.lua_tonumber(L2, i));
      else args.push(lua.lua_tojsstring(L2, i));
    }
    const result = redis.call(String(args[0]), ...args.slice(1));
    if (Array.isArray(result)) {
      lua.lua_createtable(L2, result.length, 0);
      result.forEach((v, i) => {
        lua.lua_pushstring(L2, to_luastring(String(v)));
        lua.lua_rawseti(L2, -2, i + 1);
      });
    } else {
      lua.lua_pushnumber(L2, result);
    }
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("call"));
  lua.lua_setglobal(L, to_luastring("redis"));

  // KEYS / ARGV
  lua.lua_createtable(L, 1, 0);
  lua.lua_pushstring(L, to_luastring(key));
  lua.lua_rawseti(L, -2, 1);
  lua.lua_setglobal(L, to_luastring("KEYS"));

  lua.lua_createtable(L, 4, 0);
  [String(now), String(windowMs), String(max), member].forEach((v, i) => {
    lua.lua_pushstring(L, to_luastring(v));
    lua.lua_rawseti(L, -2, i + 1);
  });
  lua.lua_setglobal(L, to_luastring("ARGV"));

  if (lauxlib.luaL_dostring(L, to_luastring(WINDOW_LUA)) !== lua.LUA_OK) {
    const err = to_jsstring(lua.lua_tostring(L, -1));
    throw new Error(`lua error: ${err}`);
  }
  // The chunk returns a 3-element array; read it off the stack.
  const out = [];
  for (let i = 1; i <= 3; i++) {
    lua.lua_rawgeti(L, -1, i);
    out.push(lua.lua_tonumber(L, -1));
    lua.lua_pop(L, 1);
  }
  lua.lua_close(L);
  return out; // [allowed, count, resetAt]
}

// ── assertions ──────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const W = 60_000;
const MAX = 3;
const KEY = "rl:auth:203.0.113.0::/64:user@example.com";

console.log("─".repeat(72));
console.log(`window=${W}ms  max=${MAX}  key=${KEY}`);
console.log("─".repeat(72));

const redis = makeRedis();
const T0 = 1_000_000;

console.log("\n1. requests under the limit are allowed, count increments");
for (let i = 1; i <= MAX; i++) {
  const [allowed, count] = runScript(redis, KEY, T0 + i, W, MAX, `m${i}`);
  check(`  request ${i} allowed`, allowed, 1);
  check(`  request ${i} count`, count, i);
}

console.log("\n2. the request that exceeds the limit is blocked");
const [blockedAllowed, blockedCount, resetAt] = runScript(redis, KEY, T0 + 10, W, MAX, "m4");
check("  blocked", blockedAllowed, 0);
check("  count still at max", blockedCount, MAX);
check("  resetAt = oldest + window", resetAt, T0 + 1 + W);

console.log("\n3. a blocked request does NOT consume budget (no lockout extension)");
const [, countAfterBlock] = runScript(redis, KEY, T0 + 20, W, MAX, "m5");
check("  count unchanged after another attempt", countAfterBlock, MAX);

console.log("\n4. the window slides: once the oldest expires, a slot frees");
// oldest entry was at T0+1; at T0+1+W it is trimmed (score <= now-window).
const [slidAllowed, slidCount] = runScript(redis, KEY, T0 + 1 + W, W, MAX, "m6");
check("  allowed again after the oldest ages out", slidAllowed, 1);
check("  count back under the max", slidCount, MAX);

console.log("\n5. a different key has its own budget (no cross-key bleed)");
const OTHER = "rl:auth:198.51.100.0::/64:other@example.com";
const [otherAllowed, otherCount] = runScript(redis, OTHER, T0 + 1 + W, W, MAX, "o1");
check("  other key allowed", otherAllowed, 1);
check("  other key count starts at 1", otherCount, 1);

console.log("\n6. all entries expiring resets the key completely");
const T_FAR = T0 + 10 * W;
const [farAllowed, farCount] = runScript(redis, KEY, T_FAR, W, MAX, "m7");
check("  allowed after everything expired", farAllowed, 1);
check("  count restarts at 1", farCount, 1);

console.log("\n7. max=1 boundary (the strictest configuration)");
const r2 = makeRedis();
const K1 = "rl:strict";
check("  first allowed", runScript(r2, K1, T0, W, 1, "a")[0], 1);
check("  second blocked", runScript(r2, K1, T0 + 1, W, 1, "b")[0], 0);

console.log("\n8. budget is per-window, not per-key-lifetime");
const r3 = makeRedis();
const K2 = "rl:renew";
let allowedCount = 0;
for (let w = 0; w < 5; w++) {
  const t = T0 + w * (W + 1); // each attempt in its own window
  if (runScript(r3, K2, t, W, 1, `x${w}`)[0] === 1) allowedCount++;
}
check("  5 separate windows all allow", allowedCount, 5);

// ── the pure helpers, from the built module ────────────────────────────────
console.log("\n9. pure helpers (imported from dist)");
const { subnetIp, authLimitKey, tlsOptionsFor } = await import("./dist/lib/rateLimit.js");

check("  IPv4 unchanged", subnetIp("203.0.113.7"), "203.0.113.7");
check("  IPv6 collapsed to /64", subnetIp("2001:db8:1:2:3:4:5:6"), "2001:db8:1:2::/64");
check("  two hosts in one /64 share a bucket",
  subnetIp("2001:db8:1:2:aaaa::1") === subnetIp("2001:db8:1:2:bbbb::9"), true);
check("  neighbours in a different /64 do not",
  subnetIp("2001:db8:1:2::1") === subnetIp("2001:db8:1:3::1"), false);

check("  key is lowercased",
  authLimitKey("203.0.113.7", "User@Example.COM"), "rl:auth:203.0.113.7:user@example.com");
check("  missing ip -> 'unknown'",
  authLimitKey(undefined, "a@b.c"), "rl:auth:unknown:a@b.c");
check("  a targeted attack does not lock out the whole office",
  authLimitKey("203.0.113.7", "victim@x.com") !== authLimitKey("203.0.113.7", "other@x.com"), true);

check("  rediss:// sets servername (Layerbase SNI routing)",
  tlsOptionsFor("rediss://cache.example.com:6379"), { servername: "cache.example.com" });
check("  redis:// has no TLS options",
  tlsOptionsFor("redis://localhost:6379"), undefined);
check("  a malformed URL does not throw", tlsOptionsFor("not a url"), undefined);

console.log("\n" + "─".repeat(72));
console.log(`${pass} pass, ${fail} fail`);
console.log("─".repeat(72));
process.exit(fail ? 1 : 0);
