import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";

import { stopMetricsPush } from "../src/observability/metrics.js";

// Asserts the Redis guard, and NOTHING about Redis itself.
//
// This suite does not test Redis. There is no local Redis, and the real
// REDIS_URL points at a hosted instance that is not ours to test against. What
// is tested here is our OWN safety rail from tests/setup.mjs: that a test which
// tries to reach a cache is stopped, and that the application still serves
// requests while no cache is configured.
//
// Two properties, both about us rather than about Redis:
//   1. A socket to 6379/6380 is refused, whatever call shape it uses.
//   2. A rate-limited request still succeeds when no cache is configured,
//      because the limiter is documented to fail open.

const REDIS_PORT = 6379;
const REDIS_TLS_PORT = 6380;

/** Every shape a client might use to open a Redis socket. */
const redisCallShapes: Array<[string, () => unknown]> = [
  ["net.connect({ port })", () => net.connect({ host: "127.0.0.1", port: REDIS_PORT })],
  ["net.connect(port)", () => net.connect(REDIS_PORT)],
  ["net.connect(port, host)", () => net.connect(REDIS_PORT, "127.0.0.1")],
  ["new net.Socket().connect({ port })", () => new net.Socket().connect({ host: "127.0.0.1", port: REDIS_PORT })],
  ["new net.Socket().connect(6380)", () => new net.Socket().connect(REDIS_TLS_PORT)],
  ["tls.connect({ port })", () => tls.connect({ host: "127.0.0.1", port: REDIS_PORT })],
  ["tls.connect(port)", () => tls.connect(REDIS_PORT)],
  ["net.connect({ port: '6379' })", () => net.connect({ host: "127.0.0.1", port: "6379" })],
];

describe("Redis guard — a test cannot reach a cache", () => {
  for (const [name, open] of redisCallShapes) {
    test(`refuses ${name}`, () => {
      assert.throws(open, /must not connect to Redis/, `${name} should be refused by tests/setup.mjs`);
    });
  }

  test("a non-Redis port is not affected", async () => {
    // 5432 is PostgreSQL, which the suite legitimately needs. If the guard were
    // too broad, every database test would fail — so this pins the boundary.
    const socket = net.connect({ host: "127.0.0.1", port: 5432 });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
    } finally {
      socket.destroy();
    }
  });

  test("REDIS_URL is empty, so limiters fail open", () => {
    // The guard above stops a client being *created*; this asserts the other
    // half — that no configured URL could have created one in the first place.
    assert.equal(process.env.REDIS_URL, "");
  });
});

describe("Redis guard — a rate-limited request still works with no cache", () => {
  // /auth/login sits behind authLimiter. With REDIS_URL empty the limiter must
  // fail open: the request reaches the handler and gets a real answer. If a
  // future change made the limiter fail CLOSED, every login would 429 during a
  // cache outage — a total outage caused by a cache nobody owns.
  //
  // The assertion is deliberately on the OUTCOME, not on Redis: a wrong
  // password must produce 401 from the handler, which can only happen if the
  // request was not blocked at the limiter.
  test("login is not blocked when no cache is configured", async () => {
    const { api, startServer, stopServer } = await import("./helpers/server.js");
    await startServer();
    try {
      const response = await api({
        path: "/api/v1/auth/login",
        method: "POST",
        body: { email: "nobody@example.invalid", password: "not-a-real-password" },
      });

      assert.notEqual(response.status, 429, "a missing cache must not rate-limit every caller");
      assert.notEqual(response.status, 503, "a missing cache must not take the endpoint down");
      // 401 = reached the handler, checked the credentials, rejected them.
      assert.equal(response.status, 401);
    } finally {
      await stopServer();
    }
  });

  // Booting the app starts the metrics push loop. It is `unref()`'d, but the
  // interval is created on import, so the process can still linger — every
  // other suite that starts a server stops it explicitly for this reason.
  after(() => {
    stopMetricsPush();
  });
});
