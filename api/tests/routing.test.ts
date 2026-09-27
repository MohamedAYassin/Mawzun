import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { createApiRouter } from "../src/routes/index.js";
import { authenticate } from "../src/middleware/authenticate.js";
import { api, startServer, stopServer } from "./helpers/server.js";
import { db, dbAdmin } from "../src/config/database.js";
import { stopMetricsPush } from "../src/observability/metrics.js";

// The authentication boundary.
//
// `createApiRouter` mounts `authenticate` once, after `/auth` and before
// everything else. That single placement is the policy: a route added later is
// authenticated because of where it is mounted, not because its author
// remembered. Domain and resource routers therefore declare only permissions.
//
// These tests exist because the alternative failure mode is quiet. A router
// that re-declares `authenticate` still works — it just does the user lookup
// twice per request. A router added *above* the boundary, on the other hand, is
// silently public, and nothing short of asking the running server will reveal
// it. So this file does both: it inspects the router tree, and it asks.

interface Layer {
  name?: string;
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
  handle?: unknown;
  stack?: Layer[];
}

function isSubRouter(layer: Layer): boolean {
  return Boolean(layer.handle && Array.isArray((layer.handle as { stack?: Layer[] }).stack));
}

/** Depth-first walk collecting every layer that is the `authenticate` handler. */
function collectGuardLayers(container: Layer, trail: string, found: string[]): void {
  for (const [index, layer] of (container.stack ?? []).entries()) {
    const here = `${trail}[${index}:${layer.name ?? "route"}]`;

    if (layer.handle === authenticate) found.push(here);

    if (layer.route) {
      for (const [i, inner] of layer.route.stack.entries()) {
        if (inner.handle === authenticate) found.push(`${here}.${layer.route.path}#${i}`);
      }
      continue;
    }

    if (isSubRouter(layer)) {
      collectGuardLayers(layer.handle as Layer, here, found);
    }
  }
}

/** Every leaf route in the tree, with whether the guard is in front of it. */
interface Leaf {
  path: string;
  methods: string[];
  guarded: boolean;
}

function collectLeaves(container: Layer, trail: string, guardedIn: boolean, out: Leaf[]): void {
  // Middleware registered with `use` applies to this router and everything
  // mounted after it, so the flag has to carry forward across siblings.
  let guarded = guardedIn;

  for (const layer of container.stack ?? []) {
    if (layer.handle === authenticate) guarded = true;

    if (layer.route) {
      let routeGuarded = guarded;
      for (const inner of layer.route.stack) {
        if (inner.handle === authenticate) routeGuarded = true;
      }
      out.push({
        path: `${trail}${layer.route.path}`,
        methods: Object.keys(layer.route.methods),
        guarded: routeGuarded,
      });
      continue;
    }

    if (isSubRouter(layer)) {
      // Express 5 does not expose the mount path on the layer, so the trail is
      // only good enough to tell nesting depth in a failure message.
      collectLeaves(layer.handle as Layer, trail === "" ? "" : `${trail}/`, guarded, out);
    }
  }
}

describe("the authentication boundary is declared once", () => {
  const stack = (createApiRouter() as unknown as Layer).stack ?? [];

  test("the top-level mount order is the policy", () => {
    // /auth (public) -> authenticate -> /platform -> requireCompanyContext ->
    // the company-scoped domains. Anything inserted above index 1 is public.
    assert.ok(isSubRouter(stack[0]), "The first mount must be the /auth router");
    assert.equal(stack[1].handle, authenticate, "The guard must come second");
    assert.ok(isSubRouter(stack[2]), "The /platform router must come after the guard");
    assert.ok(
      !isSubRouter(stack[3]) && stack[3].handle !== authenticate,
      "The company-context guard must come fourth"
    );
    assert.ok(
      stack.slice(4).every(isSubRouter),
      "Everything after the guards must be a domain router"
    );
  });

  test("no domain or resource router re-declares authenticate", () => {
    const found: string[] = [];
    for (const [index, layer] of stack.entries()) {
      // Index 1 is the boundary itself; index 0 is /auth, whose three
      // session-bound endpoints legitimately declare it.
      if (index <= 1) continue;
      collectGuardLayers(layer as Layer, `api[${index}]`, found);
    }

    assert.deepEqual(
      found,
      [],
      `authenticate must be mounted once, at the boundary. Also found: ${found.join(", ")}`
    );
  });

  test("every route outside /auth sits behind the guard", () => {
    const leaves: Leaf[] = [];
    collectLeaves(createApiRouter() as unknown as Layer, "", false, leaves);

    assert.ok(leaves.length > 100, `the walk should find plenty of routes, saw ${leaves.length}`);

    const unguarded = leaves
      .filter((leaf) => !leaf.guarded)
      .map((leaf) => `${leaf.methods.join(",")} ${leaf.path}`);

    // Exactly the session-starting routes plus the public password-reset
    // flow (the check/submit pair and the token consumer), which must be
    // reachable without a session by definition.
    assert.deepEqual(
      unguarded,
      [
        "post /signup",
        "post /login",
        "post /refresh",
        "post /forgot-password/check",
        "post /forgot-password",
        "post /reset-password",
      ],
      `Only the session-starting routes may be unguarded. Saw: ${unguarded.join("; ")}`
    );
  });

  test("the platform router gates itself before its routes", () => {
    // The platform surface sits before the company-context guard on purpose —
    // platform staff have no company — so it carries its own authorisation.
    const platform = (stack[2].handle as Layer).stack ?? [];
    const firstRoute = platform.findIndex((layer) => layer.route);
    const guards = platform.slice(0, firstRoute).filter((layer) => !layer.route);

    assert.ok(firstRoute > 0, "The platform router must register its guard before its routes");
    assert.ok(guards.length > 0, "The platform router must be guarded by requirePlatformAdmin");
  });
});

describe("the running server agrees with the router tree", () => {
  before(() => startServer());
  after(async () => {
    await stopServer();
    // stopMetricsPush() BEFORE disconnecting: its first gauge refresh is a
    // fire-and-forget dbAdmin query fired at import. If it lands after
    // $disconnect() the pool is re-opened and the process never drains.
    stopMetricsPush();
    await db.$disconnect();
    await dbAdmin.$disconnect();
  });

  async function status(method: "GET" | "POST", path: string): Promise<number> {
    const response = await api({ path, method, body: method === "GET" ? undefined : {} });
    return response.status;
  }

  // One path per mounted domain. If a domain were mounted above the guard, the
  // request would reach its handler and come back 200, 404 or 422 — anything
  // other than 401.
  const guardedPaths = [
    "/api/v1/company",
    "/api/v1/users",
    "/api/v1/roles",
    "/api/v1/settings",
    "/api/v1/catalog/products",
    "/api/v1/catalog/brands",
    "/api/v1/catalog/categories",
    "/api/v1/catalog/uoms",
    "/api/v1/catalog/tax-rates",
    "/api/v1/catalog/attributes",
    "/api/v1/inventory/warehouses",
    "/api/v1/inventory/stock",
    "/api/v1/inventory/operations",
    "/api/v1/sales/orders",
    "/api/v1/sales/customers",
    "/api/v1/purchasing/vendors",
    "/api/v1/production/batches",
    "/api/v1/shipping/carriers",
    "/api/v1/finance/wallet",
    "/api/v1/system/notifications",
    "/api/v1/system/stores",
    "/api/v1/reports/overview",
    "/api/v1/platform/companies",
  ];

  test("an unauthenticated request to every domain is refused with 401", async () => {
    const failures: string[] = [];

    for (const path of guardedPaths) {
      const code = await status("GET", path);
      if (code !== 401) failures.push(`GET ${path} -> ${code}`);
    }

    assert.deepEqual(failures, [], `These should have been refused: ${failures.join("; ")}`);
  });

  test("unauthenticated writes are refused too", async () => {
    for (const path of ["/api/v1/catalog/brands", "/api/v1/users", "/api/v1/sales/orders"]) {
      assert.equal(await status("POST", path), 401, `POST ${path} must be refused`);
    }
  });

  test("the public auth routes are reachable without a session", async () => {
    // Mounted before the guard because they are how a session starts. A bare
    // POST must fail on its own merits — never on the global guard's "you must
    // be logged in first".
    for (const path of ["/api/v1/auth/signup", "/api/v1/auth/login"]) {
      const code = await status("POST", path);
      assert.ok([400, 422, 409, 500].includes(code), `${path} returned ${code}`);
    }

    // Refresh cannot share the loop above: with no cookie and no body token
    // there is no credential at all, which is 401. That 401 comes from the
    // controller, not the guard — a distinction `notEqual(401)` would erase.
    // The message is what proves which layer answered: the guard's 401s all say
    // something else ("توكن المصادقة مفقود." and friends).
    const refresh = await api({ path: "/api/v1/auth/refresh", method: "POST" });
    assert.equal(refresh.status, 401, `refresh returned ${refresh.status}`);
    assert.equal(refresh.body.code, "UNAUTHORIZED");
    assert.equal(
      refresh.body.message,
      "توكن التحديث مطلوب.",
      "the 401 must come from the refresh handler, not the global guard",
    );
  });

  test("session-bound auth routes still require a token", async () => {
    for (const path of ["/api/v1/auth/me", "/api/v1/auth/logout", "/api/v1/auth/change-password"]) {
      const code = await status(path === "/api/v1/auth/me" ? "GET" : "POST", path);
      assert.equal(code, 401, `${path} must require a session`);
    }
  });

  test("a malformed token is refused, not ignored", async () => {
    const response = await api({ path: "/api/v1/users", token: "not-a-real-token" });
    assert.equal(response.status, 401);
  });
});
