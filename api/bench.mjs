// Backend latency benchmark.
//
// Runs against the BUILT artifact (dist/) so the numbers describe what ships,
// not what tsx transpiles on the fly.
//
// For every route it reports min / p50 / p95 / p99 / max over N iterations,
// plus the response size. It also reports process-level health: event-loop lag
// (stalls that make EVERY request slow), and the open-handle count before vs
// after the run (anything that grows is a leak that will keep the process alive).
//
// Usage:  node bench.mjs [iterations] [routeFilter]

import { performance } from "node:perf_hooks";
import http from "node:http";
import "dotenv/config";

const ITERATIONS = Number(process.argv[2] ?? 30);
const FILTER = process.argv[3] ?? "";

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const { dbAdmin } = await import("./dist/config/database.js");
const { signAccessToken } = await import("./dist/utils/jwt.js");
const app = (await import("./dist/app.js")).default;

// Pick a real seeded user with the MOST permissions, so authenticated routes
// execute their real handlers and queries instead of short-circuiting on 403.
// A 403 proves the guard works but measures no business logic.
const user = await dbAdmin.user.findFirstOrThrow({
  where: {
    companyId: { not: null },
    deletedAt: null,
    status: "ACTIVE",
    isPlatformAdmin: false,
  },
  select: {
    id: true,
    email: true,
    securityStamp: true,
    companyId: true,
    isPlatformAdmin: true,
    roles: { select: { role: { select: { permissions: { select: { permissionKey: true } } } } } },
  },
  orderBy: { roles: { _count: "desc" } },
});

const { token } = signAccessToken({
  sub: user.id,
  sid: "00000000-0000-4000-8000-000000000000", // sid is not consulted on the access path
  email: user.email,
  securityStamp: user.securityStamp ?? "",
  companyId: user.companyId,
  isPlatformAdmin: user.isPlatformAdmin,
});

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const BASE_PORT = server.address().port;
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });

// ---------------------------------------------------------------------------
// Event-loop lag monitor: a slow loop makes every request slow at once.
// ---------------------------------------------------------------------------
const LAG_SAMPLE_MS = 20;
let lagPeak = 0;
let lagTotal = 0;
let lagSamples = 0;
let last = performance.now();
const lagTimer = setInterval(() => {
  const now = performance.now();
  const drift = now - last - LAG_SAMPLE_MS;
  if (drift > 0) {
    lagTotal += drift;
    lagSamples++;
    if (drift > lagPeak) lagPeak = drift;
  }
  last = now;
}, LAG_SAMPLE_MS);
lagTimer.unref();

// ---------------------------------------------------------------------------
// Routes. `body` present => the request is sent as JSON.
// Auth routes are excluded from latency assertions: signup/login write rows and
// hash passwords, so they are not comparable to reads.
// ---------------------------------------------------------------------------
const ROUTES = [
  { method: "GET", path: "/", auth: false, note: "root liveness" },
  { method: "GET", path: "/api/v1/metrics", auth: false, note: "prometheus scrape" },
  { method: "GET", path: "/api/v1/company", auth: true, note: "company profile" },
  { method: "GET", path: "/api/v1/users", auth: true, note: "user list" },
  { method: "GET", path: "/api/v1/users/check-permission", auth: true, note: "permission check" },
  { method: "GET", path: "/api/v1/roles", auth: true, note: "role list" },
  { method: "GET", path: "/api/v1/roles/permissions", auth: true, note: "permission catalogue" },
  { method: "GET", path: "/api/v1/settings", auth: true, note: "settings" },
  { method: "GET", path: "/api/v1/auth/me", auth: true, note: "session principal" },
  { method: "GET", path: "/api/v1/catalog/products", auth: true, note: "catalog: products" },
  { method: "GET", path: "/api/v1/catalog/brands", auth: true, note: "catalog: brands" },
  { method: "GET", path: "/api/v1/inventory/stock", auth: true, note: "inventory: stock" },
  { method: "GET", path: "/api/v1/inventory/warehouses", auth: true, note: "inventory: warehouses" },
  { method: "GET", path: "/api/v1/sales/orders", auth: true, note: "sales: orders" },
  { method: "GET", path: "/api/v1/sales/customers", auth: true, note: "sales: customers" },
  { method: "GET", path: "/api/v1/purchasing/purchase-orders", auth: true, note: "purchasing: POs" },
  { method: "GET", path: "/api/v1/purchasing/vendors", auth: true, note: "purchasing: vendors" },
  { method: "GET", path: "/api/v1/production/batches", auth: true, note: "production: batches" },
  { method: "GET", path: "/api/v1/inventory/stock/levels", auth: true, note: "inventory: stock levels" },
  { method: "GET", path: "/api/v1/reports/overview/products", auth: true, note: "reports: dashboard card" },
  { method: "GET", path: "/api/v1/reports/orders/totals", auth: true, note: "reports: order totals" },
  { method: "GET", path: "/api/v1/reports/orders/top-products", auth: true, note: "reports: top products" },
  { method: "GET", path: "/api/v1/system/api-keys", auth: true, note: "system: api keys" },
  { method: "GET", path: "/api/v1/system/stores", auth: true, note: "system: stores" },
  // Negative paths: how fast is a rejection? A slow 401 is a DoS vector.
  { method: "GET", path: "/api/v1/users", auth: false, note: "unauthenticated 401" },
  { method: "GET", path: "/api/v1/does-not-exist", auth: true, note: "404 (routing miss)" },
];

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

// Attribute the pg "client already executing a query" warning to a route.
// It fires from PgTransaction.performIO when two statements race on one
// transaction client — the Promise.all([tx.findMany, tx.count]) pattern.
let currentRoute = "?";
const origEmitWarning = process.emitWarning;
process.emitWarning = function (msg, ...rest) {
  if (String(msg).includes("already executing a query")) {
    console.log(`\n!! CONCURRENT QUERY WARNING during ${currentRoute}`);
  }
  return origEmitWarning.call(process, msg, ...rest);
};

async function timed(route) {
  const headers = { ...(route.auth ? { Authorization: `Bearer ${token}` } : {}) };
  if (route.body) headers["Content-Type"] = "application/json";

  // node:http with a keep-alive agent, NOT fetch().
  //
  // fetch()/undici opens a fresh connection per request in this environment and
  // adds ~13 ms of pure client-side overhead, which completely swamps the
  // server-side cost being measured (a bare http.createServer shows the same
  // 15 ms via fetch but 0.4 ms via keep-alive). Measuring the backend requires
  // a client that reuses its socket.
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = http.request(
      {
        host: "127.0.0.1",
        port: BASE_PORT,
        path: route.path,
        method: route.method,
        headers,
        agent,
      },
      (res) => {
        let bytes = 0;
        res.on("data", (c) => (bytes += c.length));
        res.on("end", () => resolve({ ms: performance.now() - t0, status: res.statusCode, bytes }));
      }
    );
    req.on("error", reject);
    if (route.body) req.write(JSON.stringify(route.body));
    req.end();
  });
}

const results = [];
const selected = ROUTES.filter((r) => r.path.includes(FILTER));

// Warm-up: the first hit pays connection setup and any lazy init. Including it
// would misreport the steady-state cost, which is what a user actually feels.
for (const r of selected) {
  currentRoute = r.path + " (warm-up)";
  await timed(r);
}

for (const route of selected) {
  const samples = [];
  let status = 0;
  let bytes = 0;
  for (let i = 0; i < ITERATIONS; i++) {
    currentRoute = route.path;
    const { ms, status: s, bytes: b } = await timed(route);
    samples.push(ms);
    status = s;
    bytes = b;
  }
  samples.sort((a, b) => a - b);
  results.push({
    route: `${route.method} ${route.path}`,
    note: route.note,
    status,
    bytes,
    min: samples[0],
    p50: pct(samples, 50),
    p95: pct(samples, 95),
    p99: pct(samples, 99),
    max: samples[samples.length - 1],
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const f = (n) => n.toFixed(2).padStart(8);
console.log(`\n=== LATENCY (n=${ITERATIONS} after warm-up, ms) ===`);
console.log(
  "route".padEnd(44) + "status".padStart(7) + "bytes".padStart(9) +
  "min".padStart(9) + "p50".padStart(9) + "p95".padStart(9) + "p99".padStart(9) + "max".padStart(9)
);
for (const r of results.sort((a, b) => b.p95 - a.p95)) {
  console.log(
    r.route.padEnd(44) + String(r.status).padStart(7) + String(r.bytes).padStart(9) +
    f(r.min) + f(r.p50) + f(r.p95) + f(r.p99) + f(r.max)
  );
}

console.log(`\n=== EVENT LOOP LAG ===`);
console.log(`  samples: ${lagSamples}   mean drift: ${(lagSamples ? lagTotal / lagSamples : 0).toFixed(2)} ms   peak stall: ${lagPeak.toFixed(2)} ms`);

// ---------------------------------------------------------------------------
// Teardown + leak check
// ---------------------------------------------------------------------------
await new Promise((r) => server.close(r));

// Let pending fire-and-forget work settle, then see what is STILL alive. Anything
// left here is what keeps a process from exiting and holds a connection slot.
await new Promise((r) => setTimeout(r, 1500));

const describe = (h) => {
  const n = h.constructor?.name;
  if (n === "Socket") {
    const remote = h.remoteAddress ? `${h.remoteAddress}:${h.remotePort}` : null;
    return `Socket ${remote ?? "(no remote — pipe/stdio)"}`;
  }
  if (n === "Server") return `Server (listening=${h.listening})`;
  if (n === "Timeout") return `Timeout (${h._idleTimeout}ms)`;
  return n;
};

const before = process._getActiveHandles().map(describe);
console.log(`\n=== HANDLES STILL OPEN AFTER SERVER CLOSE (${before.length}) ===`);
console.log(before.map((h) => "  " + h).join("\n") || "  none");

const { closeLogsPool } = await import("./dist/observability/errorCapture.js");
const { closeRateLimitRedis } = await import("./dist/lib/rateLimit.js");
const { stopMetricsPush } = await import("./dist/observability/metrics.js");
const { db } = await import("./dist/config/database.js");
stopMetricsPush();
await closeLogsPool();
await closeRateLimitRedis();
// BOTH Prisma clients. Disconnecting only dbAdmin leaves `db` — the client that
// served every request — holding its pool, which reads as a leak that is not there.
await db.$disconnect();
await dbAdmin.$disconnect();

await new Promise((r) => setTimeout(r, 1200));
const after = process._getActiveHandles().map(describe);
console.log(`\n=== HANDLES AFTER FULL TEARDOWN (${after.length}) ===`);
console.log(after.map((h) => "  " + h).join("\n") || "  none");
console.log(
  after.length === 0 || after.every((h) => h.includes("pipe/stdio"))
    ? "\nRESULT: clean — process would exit on its own"
    : "\nRESULT: LEAK — these would keep the process alive forever"
);

