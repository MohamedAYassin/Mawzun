import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { db, dbAdmin } from "../src/config/database.js";
import { api, startServer, stopServer } from "./helpers/server.js";
import { stopMetricsPush } from "../src/observability/metrics.js";
import { Permissions } from "../src/constants/permissions.js";

// Session management: listing live sessions and ending them.
//
// The security properties are the point of this file, not the happy path:
//
//   * a member must see only their OWN sessions unless they hold ManageUsers,
//     because a session row carries the device and IP address;
//   * a caller who guesses another user's session id must be refused, so
//     authorisation cannot depend on the client having listed first;
//   * another company's sessions must be unreachable, enforced by RLS;
//   * platform-admin sessions must never appear in a company screen.
//
// Every test signs in for real (via /auth/login) so the rows under test are
// produced by the same code path that produces production sessions.

const OWNER_PASSWORD = "SessionsOwner1234";
const MEMBER_PASSWORD = "SessionsMember1234";

interface Tokens {
  accessToken: string;
  refreshToken: string;
}
interface AuthResult {
  tokens: Tokens;
}

interface SessionItem {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
  user: { id: string; fullName: string; email: string };
}
interface SessionList {
  sessions: SessionItem[];
  scope: "own" | "company";
}

const tag = randomUUID().slice(0, 8);
const ownerEmail = `sessions-owner-${tag}@test.local`;
const memberEmail = `sessions-member-${tag}@test.local`;

let companyId = "";
let ownerId = "";
let memberId = "";
let ownerToken = "";
let memberToken = "";
/** Second company, to prove isolation rather than assume it. */
let otherCompanyId = "";
let otherOwnerEmail = "";
let otherOwnerToken = "";
let otherOwnerId = "";

async function login(email: string, password: string): Promise<string> {
  const res = await api<AuthResult>({
    path: "/api/v1/auth/login",
    method: "POST",
    body: { email, password },
  });
  assert.equal(res.status, 200, `login for ${email} failed: ${JSON.stringify(res.body)}`);
  return res.body.data!.tokens.accessToken;
}

before(async () => {
  await startServer();

  const signup = await api<AuthResult>({
    path: "/api/v1/auth/signup",
    method: "POST",
    body: { companyName: `Sessions Co ${tag}`, fullName: "Owner", email: ownerEmail, password: OWNER_PASSWORD },
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.body));
  companyId = signup.body.data!.principal.user.companyId!;
  ownerId = signup.body.data!.principal.user.id;
  ownerToken = signup.body.data!.tokens.accessToken;

  // A second, non-owner member who holds only view permissions.
  const created = await api<{ id: string }>({
    path: "/api/v1/users",
    method: "POST",
    token: ownerToken,
    body: { fullName: "Member", email: memberEmail, password: MEMBER_PASSWORD },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  memberId = created.body.data!.id;

  memberToken = await login(memberEmail, MEMBER_PASSWORD);

  // A different company entirely.
  const other = await api<AuthResult>({
    path: "/api/v1/auth/signup",
    method: "POST",
    body: {
      companyName: `Sessions Other ${tag}`,
      fullName: "Other Owner",
      email: otherOwnerEmail = `sessions-other-${tag}@test.local`,
      password: OWNER_PASSWORD,
    },
  });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  otherCompanyId = other.body.data!.principal.user.companyId!;
  otherOwnerId = other.body.data!.principal.user.id;
  otherOwnerToken = other.body.data!.tokens.accessToken;
});

after(async () => {
  await stopServer();
  stopMetricsPush();
  // Sessions cascade from users; companies own the users.
  for (const id of [companyId, otherCompanyId].filter(Boolean)) {
    await dbAdmin.company.deleteMany({ where: { id } });
  }
  await db.$disconnect();
  await dbAdmin.$disconnect();
});

describe("session management", () => {
  test("the list returns the caller's own live session and marks it current", async () => {
    const res = await api<SessionList>({ path: "/api/v1/system/sessions", token: ownerToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const list = res.body.data!;

    // The owner holds every permission, so they get the company scope.
    assert.equal(list.scope, "company");
    const mine = list.sessions.filter((s) => s.user.id === ownerId);
    assert.ok(mine.length >= 1, "the caller's own session must be listed");
    assert.equal(
      mine.filter((s) => s.isCurrent).length,
      1,
      "exactly one row is the session making the request"
    );
  });

  test("a member without ManageUsers sees only their own sessions", async () => {
    const res = await api<SessionList>({ path: "/api/v1/system/sessions", token: memberToken });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const list = res.body.data!;

    assert.equal(list.scope, "own", "a plain member must not get the company scope");
    assert.ok(list.sessions.length >= 1, "their own session must be visible");
    assert.ok(
      list.sessions.every((s) => s.user.id === memberId),
      "a member must never receive another user's session row"
    );
  });

  test("the company scope includes other members for an owner", async () => {
    // The member is signed in above, so their session exists right now.
    const res = await api<SessionList>({ path: "/api/v1/system/sessions", token: ownerToken });
    const list = res.body.data!;
    assert.ok(
      list.sessions.some((s) => s.user.id === memberId),
      "the owner's company scope must include the member's live session"
    );
  });

  test("revoked and expired sessions are not listed", async () => {
    const before = await api<SessionList>({ path: "/api/v1/system/sessions", token: memberToken });
    const current = before.body.data!.sessions.find((s) => s.isCurrent)!;

    // Expire it directly: the list must drop it even though no code ran.
    await dbAdmin.session.update({ where: { id: current.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const after = await api<SessionList>({ path: "/api/v1/system/sessions", token: memberToken });
    assert.ok(
      !after.body.data!.sessions.some((s) => s.id === current.id),
      "an expired session must not be listed"
    );

    // Restore, because later tests reuse this token.
    await dbAdmin.session.update({ where: { id: current.id }, data: { expiresAt: new Date(Date.now() + 3600_000) } });
  });

  test("a member cannot end a colleague's session by guessing its id", async () => {
    const ownerList = await api<SessionList>({ path: "/api/v1/system/sessions", token: ownerToken });
    const ownerSession = ownerList.body.data!.sessions.find((s) => s.user.id === ownerId)!;

    const res = await api({
      path: `/api/v1/system/sessions/${ownerSession.id}`,
      method: "DELETE",
      token: memberToken,
    });
    assert.equal(res.status, 403, "a non-admin must be refused, not silently allowed");

    // And it is still live — a refusal that still revoked would be worse.
    const check = await dbAdmin.session.findUnique({ where: { id: ownerSession.id }, select: { revokedAt: true } });
    assert.equal(check?.revokedAt, null, "the refused request must not have revoked anything");
  });

  test("another company's session is not found, not forbidden", async () => {
    const otherList = await api<SessionList>({ path: "/api/v1/system/sessions", token: otherOwnerToken });
    const otherSession = otherList.body.data!.sessions[0]!;

    // 404 rather than 403: RLS hides the row, so the endpoint cannot even tell
    // that it exists. Returning 403 would confirm an id belongs to someone.
    const res = await api({
      path: `/api/v1/system/sessions/${otherSession.id}`,
      method: "DELETE",
      token: ownerToken,
    });
    assert.equal(res.status, 404, "a foreign session must be invisible");

    const check = await dbAdmin.session.findUnique({ where: { id: otherSession.id }, select: { revokedAt: true } });
    assert.equal(check?.revokedAt, null, "the foreign session must be untouched");
  });

  test("neither company's list leaks the other's sessions", async () => {
    const mine = await api<SessionList>({ path: "/api/v1/system/sessions", token: ownerToken });
    const theirs = await api<SessionList>({ path: "/api/v1/system/sessions", token: otherOwnerToken });

    const mineUsers = new Set(mine.body.data!.sessions.map((s) => s.user.id));
    const theirUsers = new Set(theirs.body.data!.sessions.map((s) => s.user.id));

    assert.ok(!mineUsers.has(otherOwnerId), "our list must not contain the other company's owner");
    assert.ok(!theirUsers.has(ownerId), "their list must not contain our owner");
    assert.ok(!theirUsers.has(memberId), "their list must not contain our member");
  });

  test("ending your own session revokes it", async () => {
    // A throwaway sign-in, so ending it cannot disturb the shared tokens.
    const throwawayLogin = await api<AuthResult>({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email: memberEmail, password: MEMBER_PASSWORD },
    });
    const throwaway = throwawayLogin.body.data!.tokens.accessToken;
    const throwawayRefresh = throwawayLogin.body.data!.tokens.refreshToken;

    const list = await api<SessionList>({ path: "/api/v1/system/sessions", token: throwaway });
    const current = list.body.data!.sessions.find((s) => s.isCurrent)!;

    const res = await api({
      path: `/api/v1/system/sessions/${current.id}`,
      method: "DELETE",
      token: throwaway,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data!.revoked, true);
    assert.equal(res.body.data!.wasCurrent, true, "the response must flag that it was the caller's own");

    const row = await dbAdmin.session.findUnique({ where: { id: current.id }, select: { revokedAt: true } });
    assert.ok(row?.revokedAt, "the row must be revoked in the database");

    // The credential is dead: a revoked session's refresh token must not be
    // able to mint a new one. This is the same assertion the existing logout
    // test makes, and it is what "ended" actually means here.
    //
    // The already-issued ACCESS token keeps working until it expires (60 min
    // by default) — `authenticate` validates the JWT's security stamp, not the
    // session row, so access tokens are not checked per request by design.
    // Asserting 401 on the access token would be asserting a guarantee this
    // system does not make.
    const reuse = await api({
      path: "/api/v1/auth/refresh",
      method: "POST",
      body: { refreshToken: throwawayRefresh },
    });
    assert.equal(reuse.status, 401, "a revoked session's refresh token must not mint a new session");
  });

  test("an owner ending a member's session writes an audit entry", async () => {
    const throwaway = await login(memberEmail, MEMBER_PASSWORD);
    const list = await api<SessionList>({ path: "/api/v1/system/sessions", token: throwaway });
    const victim = list.body.data!.sessions.find((s) => s.isCurrent)!;

    const res = await api({
      path: `/api/v1/system/sessions/${victim.id}`,
      method: "DELETE",
      token: ownerToken,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const entry = await dbAdmin.auditLog.findFirst({
      where: { action: "session.revoked", entityId: victim.id },
      select: { id: true, actorId: true },
    });
    assert.ok(entry, "revoking someone else's session must be audited");
    assert.equal(entry!.actorId, ownerId, "the audit row must name the acting admin");
  });

  test("ending an already-ended session succeeds and reports it", async () => {
    const throwaway = await login(memberEmail, MEMBER_PASSWORD);
    const list = await api<SessionList>({ path: "/api/v1/system/sessions", token: throwaway });
    const current = list.body.data!.sessions.find((s) => s.isCurrent)!;

    const first = await api({ path: `/api/v1/system/sessions/${current.id}`, method: "DELETE", token: throwaway });
    assert.equal(first.status, 200);
    assert.equal(first.body.data!.revoked, true);

    // Second attempt from the owner (the token is dead, so use a live one).
    // Idempotent by design: two admins clicking at once must not see a failure.
    const second = await api({ path: `/api/v1/system/sessions/${current.id}`, method: "DELETE", token: ownerToken });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.data!.revoked, false);
    assert.equal(second.body.data!.alreadyRevoked, true);
  });

  test("an impersonation session is never listed", async () => {
    // Platform staff impersonating a member mint a session with
    // `impersonatedBy` set. Those are admin sessions and must not appear on a
    // company screen — verified by creating a real one and looking for it.
    const throwawayLogin = await api<AuthResult>({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email: memberEmail, password: MEMBER_PASSWORD },
    });
    const impersonatedId = randomUUID();
    await dbAdmin.session.create({
      data: {
        id: impersonatedId,
        userId: memberId,
        refreshToken: `impersonation-${tag}-${randomUUID()}`,
        expiresAt: new Date(Date.now() + 3600_000),
        userAgent: "IMPERSONATION by admin@mawzun.org",
        impersonatedBy: "admin@mawzun.org",
      },
    });

    // Both scopes must hide it: the member's own list AND the owner's company
    // list. It is not "someone else's session" — it is not shown at all.
    for (const [who, token] of [["member", memberToken], ["owner", ownerToken]] as const) {
      const res = await api<SessionList>({ path: "/api/v1/system/sessions", token });
      assert.ok(
        !res.body.data!.sessions.some((s) => s.id === impersonatedId),
        `an impersonation session must not be listed to the ${who}`
      );
    }

    // It is live and real, so the assertions above are meaningful.
    const live = await dbAdmin.session.findUnique({
      where: { id: impersonatedId },
      select: { revokedAt: true, impersonatedBy: true },
    });
    assert.equal(live?.revokedAt, null, "the impersonation session must actually be live");
    assert.equal(live?.impersonatedBy, "admin@mawzun.org");

    await dbAdmin.session.deleteMany({ where: { id: impersonatedId } });
  });

  test("a platform admin's session never appears in a company list", async () => {
    // Mint a platform admin and give them a live session.
    const adminEmail = `sessions-admin-${tag}@test.local`;
    const adminId = randomUUID();
    const { hashPassword } = await import("../src/utils/password.js");
    await dbAdmin.user.create({
      data: {
        id: adminId,
        email: adminEmail,
        passwordHash: await hashPassword(OWNER_PASSWORD),
        fullName: "Platform Admin",
        status: "ACTIVE",
        isPlatformAdmin: true,
        companyId: null,
        securityStamp: randomUUID(),
      },
    });

    const adminToken = await login(adminEmail, OWNER_PASSWORD);
    // Prove the admin really has a live session, so this test would fail if the
    // exclusion broke. Without this the assertion below could pass simply
    // because no session existed.
    const adminOwn = await api<SessionList>({ path: "/api/v1/system/sessions", token: adminToken });
    assert.equal(adminOwn.status, 403, "a platform admin has no company, so the company routes refuse them");

    const adminSessionCount = await dbAdmin.session.count({
      where: { userId: adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    assert.ok(adminSessionCount > 0, "the admin must actually hold a live session for this test to mean anything");

    const res = await api<SessionList>({ path: "/api/v1/system/sessions", token: ownerToken });
    assert.ok(
      !res.body.data!.sessions.some((s) => s.user.id === adminId),
      "a platform admin must never be listed on a company screen"
    );

    // Cleanup: the admin belongs to no company, so nothing cascades to it.
    await dbAdmin.user.deleteMany({ where: { id: adminId } });
  });

  test("the route requires a session", async () => {
    const res = await api({ path: "/api/v1/system/sessions" });
    assert.equal(res.status, 401);
  });

  test("ManageUsers is the permission that widens the scope", async () => {
    // Grant the member ManageUsers through a custom role and confirm the scope
    // actually changes — the rule must be the permission, not the owner flag.
    const role = await api<{ id: string }>({
      path: "/api/v1/roles",
      method: "POST",
      token: ownerToken,
      body: { name: `Sessions Role ${tag}`, permissionKeys: [Permissions.ManageUsers] },
    });
    assert.equal(role.status, 201, JSON.stringify(role.body));

    const assigned = await api({
      path: `/api/v1/users/${memberId}`,
      method: "PATCH",
      token: ownerToken,
      body: { roleIds: [role.body.data!.id] },
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.body));

    // Permissions are resolved per request, so the SAME token now sees more.
    const res = await api<SessionList>({ path: "/api/v1/system/sessions", token: memberToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.data!.scope, "company", "ManageUsers must widen the scope");

    await dbAdmin.role.deleteMany({ where: { id: role.body.data!.id } });
  });
});
