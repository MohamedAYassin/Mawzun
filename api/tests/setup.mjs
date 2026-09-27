// Hermetic test environment: NO network dependencies.
//
// ─────────────────────────────────────────────────────────────────────────────
// RULE: WE DO NOT TEST REDIS HERE.
//
// There is no local Redis. REDIS_URL points at a HOSTED third-party instance
// that this machine does not own and must not depend on. A test that touches it
// is not a test — it is a remote call that happens to have assertions after it.
//
// So the suite does not test Redis at all, and the block below makes that
// ENFORCED rather than a convention: REDIS_URL is emptied, and any attempt to
// open a socket to a cache fails the run with a readable message instead of
// silently reaching out to someone else's server.
//
// Why this matters, concretely — all three happened:
//   * Tests "passed" only because the hosted cache was down and every limiter
//     failed open. When it came back, limits enforced and 5 tests saw 429
//     instead of the status under test.
//   * Every rate-limit check paid ~142 ms of real network latency, turning a
//     21-second suite into a 6m40s one.
//   * Files share one remote cache and one client IP, so they starved each
//     other's budget and the results depended on run order.
//
// REDIS_URL="" makes every limiter fail open, which is the documented
// behaviour for an unconfigured cache (see src/lib/rateLimit.ts). dotenv never
// overrides an already-present variable and env.ts maps "" to undefined, so
// this wins over .env.
// ─────────────────────────────────────────────────────────────────────────────

process.env.REDIS_URL = "";
process.env.NODE_ENV = "test";

// ─────────────────────────────────────────────────────────────────────────────
// Cap the database pool per test process.
//
// `tsx --test tests/*.test.ts` runs every test FILE in its own process, and
// node:test runs them CONCURRENTLY. With 10 files each opening the production
// pool (DB_POOL_MAX=10, split 7 app + 3 admin) that is up to 100 connections at
// once — right at a default Postgres `max_connections` of 100, and enough to
// starve a suite of its own connections.
//
// The symptom is not a failed assertion but a FLAKE: a suite's `before()` hook
// dies with "Transaction API error: Unable to start a transaction in the given
// time", and node:test then cancels every test under it ("test did not finish
// before its parent"), reporting `# pass 111 # cancelled 18` with `# fail 0`.
// That reads as a pass at a glance, which is exactly what makes it dangerous.
//
// Each test process needs only a handful of connections: the suites are
// sequential inside a file, and the parallel work is across processes. 4 keeps
// the whole run under ~40 connections with room to spare, and it is set HERE
// because this module is loaded via `--import` before any test file, and
// database.ts reads DB_POOL_MAX at module load.
process.env.DB_POOL_MAX ??= "4";

// Belt and braces: even if something re-sets REDIS_URL later, refuse the socket.
//
// net.Socket.prototype.connect is the single choke point every Redis client
// (ioredis, node-redis) goes through, so patching it here catches any client
// regardless of which one is added later.
//
// The port has to be dug out of several call shapes, because `connect` is
// overloaded and Node's own `net.connect()` wrapper passes its arguments
// through as an ARRAY:
//     connect(port, host?)                 -> args[0] is a number
//     connect(options)                     -> args[0] is the options object
//     net.connect(options)                 -> args[0] is [options, cb]
//     connect(path)                        -> a unix socket, no port
// A check that only handles the middle case silently does nothing, which is
// exactly how this guard failed the first time it was written.
const net = await import("node:net");

/** Finds a TCP port anywhere in a `connect(...)` argument list. */
function findPort(args) {
  const scan = (value, depth) => {
    if (depth > 3 || value == null) return undefined;
    if (typeof value === "number") return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = scan(item, depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (typeof value === "object") {
      const port = value.port;
      if (typeof port === "number") return port;
      if (typeof port === "string" && /^\d+$/.test(port)) return Number(port);
    }
    return undefined;
  };
  for (const arg of args) {
    const found = scan(arg, 0);
    if (found !== undefined) return found;
  }
  return undefined;
}

const REDIS_PORTS = new Set([6379, 6380]);

function refuseRedis(port) {
  throw new Error(
    `Tests must not connect to Redis (port ${port}). There is no local Redis and the ` +
      `hosted instance is not ours. Remove the Redis dependency from the test — ` +
      `see tests/setup.mjs.`
  );
}

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const port = findPort(args);
  if (port !== undefined && REDIS_PORTS.has(port)) refuseRedis(port);
  return originalConnect.apply(this, args);
};

// TLS needs no separate guard: `tls.connect()` builds a TLSSocket, and TLSSocket
// extends net.Socket — so it reaches the patched prototype method above. (A
// module-level `tls.connect = ...` assignment is not possible anyway: ESM module
// namespaces are frozen, so the property is read-only.)
//
// Verified by tests/redis-guard.test.ts, which opens both a plain and a TLS
// connection to 6379 and asserts both are refused.
