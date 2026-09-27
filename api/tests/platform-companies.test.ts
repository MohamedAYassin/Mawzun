import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { db, dbAdmin } from "../src/config/database.js";
import { createCompany, cleanupFixtures, type FixtureCompany } from "./helpers/fixtures.js";
import { api, startServer, stopServer } from "./helpers/server.js";
import { createPlatformAdmin, deleteUser, tokenFor } from "./helpers/principal.js";

// The platform back-office: the one surface that legitimately sees across
// companies.
//
// Everything else in the API derives the company from the authenticated session
// and refuses to look outside it. This surface is the exception, so it carries
// its own guard and is tested more harshly than the rest: who may call it, what
// a status change actually does, whether it is recorded, and whether it takes
// effect on the people it affects.

let alpha: FixtureCompany;
let beta: FixtureCompany;
let platform: { id: string; email: string };
let platformToken = "";
let ownerToken = "";

before(async () => {
  await startServer();
  alpha = await createCompany("alpha");
  beta = await createCompany("beta");
  platform = await createPlatformAdmin("dir");
  platformToken = await tokenFor(platform.id);
  ownerToken = await tokenFor(alpha.ownerId);
});

after(async () => {
  await stopServer();
  await deleteUser(platform.id);
  await cleanupFixtures();
  await db.$disconnect();
  await dbAdmin.$disconnect();
});

describe("who may reach the platform directory", () => {
  test("an unauthenticated caller is refused", async () => {
    const response = await api({ path: "/api/v1/platform/companies" });
    assert.equal(response.status, 401);
  });

  test("a company owner is refused", async () => {
    // The owner holds every permission in the catalogue, so this is not a
    // permission check — it is the `requirePlatformAdmin` guard. Without it the
    // owner would see every company on the installation.
    const response = await api({ path: "/api/v1/platform/companies", token: ownerToken });
    assert.equal(response.status, 403, `body: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code, "FORBIDDEN");
  });

  test("a company owner cannot change a status either", async () => {
    const response = await api({
      path: `/api/v1/platform/companies/${beta.companyId}/status`,
      method: "PATCH",
      token: ownerToken,
      body: { status: "SUSPENDED", reason: "because" },
    });
    assert.equal(response.status, 403);
  });

  test("a platform administrator is admitted", async () => {
    const response = await api<{ items: unknown[]; total: number }>({
      path: "/api/v1/platform/companies",
      token: platformToken,
    });

    assert.equal(response.status, 200, `body: ${JSON.stringify(response.body)}`);
    assert.ok(response.body.data, "The directory must return a page");
    assert.ok(response.body.data.total >= 2, `Expected at least the two fixtures, got ${response.body.data.total}`);
  });

  test("the listing is paginated and searchable", async () => {
    const page = await api<{ items: { id: string }[]; total: number; page: number }>({
      path: `/api/v1/platform/companies?pageSize=1&search=${encodeURIComponent(alpha.name)}`,
      token: platformToken,
    });

    assert.equal(page.status, 200);
    assert.equal(page.body.data?.total, 1, "Searching by the fixture's unique name matches one company");
    assert.equal(page.body.data?.items[0].id, alpha.companyId);
    assert.equal(page.body.data?.page, 1);
  });

  test("the listing can be filtered by status", async () => {
    const response = await api<{ items: { id: string; status: string }[] }>({
      path: "/api/v1/platform/companies?status=SUSPENDED",
      token: platformToken,
    });

    assert.equal(response.status, 200);
    assert.ok(
      response.body.data?.items.every((item) => item.status === "SUSPENDED"),
      "A status filter must not leak other statuses"
    );
  });
});

describe("changing a company's status", () => {
  test("suspending requires a reason", async () => {
    const response = await api({
      path: `/api/v1/platform/companies/${alpha.companyId}/status`,
      method: "PATCH",
      token: platformToken,
      body: { status: "SUSPENDED" },
    });

    assert.equal(response.status, 422, `body: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code, "VALIDATION_ERROR");
  });

  test("closing requires a reason too", async () => {
    const response = await api({
      path: `/api/v1/platform/companies/${alpha.companyId}/status`,
      method: "PATCH",
      token: platformToken,
      body: { status: "CLOSED" },
    });

    assert.equal(response.status, 422);
  });

  test("an unknown company is a 404, not a silent success", async () => {
    const response = await api({
      path: "/api/v1/platform/companies/does-not-exist/status",
      method: "PATCH",
      token: platformToken,
      body: { status: "SUSPENDED", reason: "test" },
    });

    assert.equal(response.status, 404);
  });

  test("an invalid status is rejected", async () => {
    const response = await api({
      path: `/api/v1/platform/companies/${alpha.companyId}/status`,
      method: "PATCH",
      token: platformToken,
      body: { status: "NOT_A_STATUS", reason: "test" },
    });

    assert.equal(response.status, 422);
  });

  test("suspending stores the status, the timestamp and the reason", async () => {
    const response = await api<{
      id: string;
      status: string;
      suspendedAt: string | null;
      suspensionReason: string | null;
    }>({
      path: `/api/v1/platform/companies/${alpha.companyId}/status`,
      method: "PATCH",
      token: platformToken,
      body: { status: "SUSPENDED", reason: "فاتورة غير مدفوعة" },
    });

    assert.equal(response.status, 200, `body: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.data?.status, "SUSPENDED");
    assert.ok(response.body.data?.suspendedAt, "Suspension must be timestamped");
    assert.equal(response.body.data?.suspensionReason, "فاتورة غير مدفوعة");
  });

  test("the change is written to the audit trail", async () => {
    const entries = await dbAdmin.auditLog.findMany({
      where: { entity: "Company", entityId: alpha.companyId, action: "company.statusChanged" },
      orderBy: { createdAt: "desc" },
    });

    assert.ok(entries.length > 0, "A status change must be auditable");

    const latest = entries[0];
    assert.equal(latest.companyId, alpha.companyId, "The entry belongs to the company that was changed");
    assert.equal(latest.actorId, platform.id, "The entry names the platform administrator who made the change");

    const changes = latest.changes as { from?: string; to?: string; reason?: string } | null;
    assert.equal(changes?.to, "SUSPENDED");
    assert.equal(changes?.reason, "فاتورة غير مدفوعة");
  });

  test("a suspended company cannot use the API", async () => {
    // The reason suspension is worth doing at all. The owner's token is still
    // cryptographically valid — nothing about it changed — so this has to come
    // from the company status check in `authenticate`.
    const me = await api({ path: "/api/v1/auth/me", token: ownerToken });
    assert.equal(me.status, 403, `body: ${JSON.stringify(me.body)}`);

    const users = await api({ path: "/api/v1/users", token: ownerToken });
    assert.equal(users.status, 403);
  });

  test("suspending revokes the company's live sessions", async () => {
    const live = await dbAdmin.session.count({
      where: { user: { companyId: alpha.companyId }, revokedAt: null },
    });
    assert.equal(live, 0, "No session for a suspended company may stay usable");
  });

  test("reactivating restores access", async () => {
    const response = await api<{ status: string; suspendedAt: string | null; suspensionReason: string | null }>({
      path: `/api/v1/platform/companies/${alpha.companyId}/status`,
      method: "PATCH",
      token: platformToken,
      body: { status: "ACTIVE" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data?.status, "ACTIVE");
    assert.equal(response.body.data?.suspendedAt, null, "Reactivating clears the suspension timestamp");
    assert.equal(response.body.data?.suspensionReason, null, "And the reason, so it cannot be quoted later");

    const me = await api({ path: "/api/v1/auth/me", token: ownerToken });
    assert.equal(me.status, 200, "The owner can use the API again");
  });

  test("reactivating needs no reason", async () => {
    // The reason rule is about taking a company out of service, not about
    // putting it back.
    const response = await api({
      path: `/api/v1/platform/companies/${beta.companyId}/status`,
      method: "PATCH",
      token: platformToken,
      body: { status: "ACTIVE" },
    });

    assert.equal(response.status, 200);
  });

  test("a company user still cannot reach another company's data", async () => {
    // Suspension status is platform business; it must not weaken isolation.
    const response = await api({
      path: `/api/v1/users/${beta.memberId}`,
      token: ownerToken,
    });
    assert.equal(response.status, 404, "Beta's member must stay invisible to Alpha");
  });
});
