import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { api, startServer, stopServer } from "./helpers/server.js";
import { stopMetricsPush } from "../src/observability/metrics.js";
import { createCompany, cleanupFixtures, type FixtureCompany } from "./helpers/fixtures.js";
import { tokenFor } from "./helpers/principal.js";
import { env } from "../src/config/env.js";

// The page-size ceiling.
//
// PAGINATION_MAX_PAGE_SIZE became a setting so an operator can bound how much
// work one request may ask for. The risk in that change is that the setting is
// read but not actually enforced — the value would appear in the config, look
// correct, and change nothing. These tests pin the enforcement, not the number.

let alpha: FixtureCompany;
let ownerToken = "";

before(async () => {
  alpha = await createCompany("pag");
  ownerToken = await tokenFor(alpha.ownerId);
  await startServer();
});

after(async () => {
  await stopServer();
  await cleanupFixtures();
  stopMetricsPush();
});

describe("pagination ceiling", () => {
  test("the configured ceiling is a positive integer", () => {
    assert.ok(Number.isInteger(env.PAGINATION_MAX_PAGE_SIZE));
    assert.ok(env.PAGINATION_MAX_PAGE_SIZE > 0);
  });

  test("a pageSize above the ceiling is rejected, not truncated", async () => {
    // Rejected rather than silently reduced: a client that asks for 500 and
    // receives 25 has no way to tell, and would page as if it had all 500.
    const res = await api({
      path: `/api/v1/catalog/products?pageSize=${env.PAGINATION_MAX_PAGE_SIZE + 1}`,
      token: ownerToken,
    });
    assert.equal(res.status, 422, "an over-large page must be refused");
  });

  test("a pageSize at the ceiling is accepted", async () => {
    const res = await api({
      path: `/api/v1/catalog/products?pageSize=${env.PAGINATION_MAX_PAGE_SIZE}`,
      token: ownerToken,
    });
    assert.equal(res.status, 200);
  });

  test("a pageSize below the ceiling is accepted", async () => {
    const res = await api({ path: "/api/v1/catalog/products?pageSize=1", token: ownerToken });
    assert.equal(res.status, 200);
  });

  test("zero and negative page sizes are rejected", async () => {
    for (const bad of [0, -1]) {
      const res = await api({ path: `/api/v1/catalog/products?pageSize=${bad}`, token: ownerToken });
      assert.equal(res.status, 422, `pageSize=${bad} must be refused`);
    }
  });

  test("the same ceiling applies to every list endpoint", async () => {
    // Four list schemas each carried their own hardcoded maximum before this
    // became a setting. Wiring one and missing the others would leave the
    // ceiling inconsistent between screens, which is the bug this catches.
    const over = env.PAGINATION_MAX_PAGE_SIZE + 1;
    const paths = ["/api/v1/catalog/products", "/api/v1/users", "/api/v1/roles"];
    for (const path of paths) {
      const res = await api({ path: `${path}?pageSize=${over}`, token: ownerToken });
      assert.equal(res.status, 422, `${path} must enforce the ceiling`);
    }
  });
});
