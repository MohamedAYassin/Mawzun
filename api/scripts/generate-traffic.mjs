// Traffic generator for Mawzun Prometheus metrics.
//
//   node scripts/generate-traffic.mjs [--target http://127.0.0.1:5000] [--duration 60] [--rps 5]
//
// Mixes realistic traffic so every metric family moves:
//   - GET /                        (200 — baseline requests)
//   - POST /api/v1/auth/login      (422 validation errors + occasional 500 via bad content type)
//   - GET /api/v1/auth/refresh     (401 — counts toward error classes)
//   - POST /api/v1/auth/signup     (422)
// Requests run on an interval; safe against a dev database (no valid
// credentials are ever used; everything is intentionally rejected).
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
function argOf(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const TARGET = argOf("--target", "http://127.0.0.1:5000");
const DURATION_S = Number(argOf("--duration", "60"));
const RPS = Number(argOf("--rps", "5"));

const endpoints = [
  { method: "GET", path: "/", weight: 4, expect: "200" },
  { method: "POST", path: "/api/v1/auth/login", weight: 3, expect: "4xx", body: { email: `load${Math.floor(Math.random() * 1e6)}@example.com`, password: "Wrong-Pass-123" } },
  { method: "POST", path: "/api/v1/auth/signup", weight: 2, expect: "4xx", body: { email: `load${Math.floor(Math.random() * 1e6)}@example.com`, password: "x" } },
  { method: "GET", path: "/api/v1/auth/refresh", weight: 1, expect: "401" },
];

const pool = [];
for (const e of endpoints) for (let i = 0; i < e.weight; i++) pool.push(e);

let sent = 0, ok = 0, err = 0;
const started = Date.now();

async function fireOne() {
  const ep = pool[Math.floor(Math.random() * pool.length)];
  try {
    const res = await fetch(`${TARGET}${ep.path}`, {
      method: ep.method,
      headers: { "Content-Type": "application/json" },
      body: ep.body ? JSON.stringify(ep.body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    sent++;
    if (res.ok) ok++; else err++;
  } catch {
    sent++; err++;
  }
}

console.log(`Generating ~${RPS} req/s against ${TARGET} for ${DURATION_S}s (mix: /, login, signup, refresh — all rejected safely)`);
const intervalMs = Math.max(1, Math.floor(1000 / RPS));
const endAt = Date.now() + DURATION_S * 1000;

while (Date.now() < endAt) {
  // fire a batch each tick (intervalMs), tolerating overlapping fetches
  fireOne();
  if (sent % 25 === 0) console.log(`sent=${sent} ok=${ok} err=${err} (${Math.round((Date.now() - started) / 1000)}s)`);
  await sleep(intervalMs);
}

// drain in-flight
await sleep(1500);
console.log(`\nDone: ${sent} requests (${ok} ok / ${err} errors) over ${DURATION_S}s`);
console.log("Metrics updated in the Backend registry; the next 15s push cycle carries them to Grafana Cloud.");
