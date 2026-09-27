import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { db, dbAdmin } from "../src/config/database.js";
import { api, startServer, stopServer } from "./helpers/server.js";
import { stopMetricsPush } from "../src/observability/metrics.js";

// The session lifecycle: signup, login, refresh rotation, logout and password
// change.
//
// The frontend stores an access token and a refresh token and relies on this
// contract to keep a user signed in. Rotation is the part that is easy to get
// subtly wrong — a refresh token that stays valid after being exchanged is a
// credential that can be replayed — so each rule here is stated as its own
// test rather than folded into one long happy path.

interface Tokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

interface Principal {
  user: {
    id: string;
    email: string;
    fullName: string;
    isPlatformAdmin: boolean;
    isCompanyOwner: boolean;
    companyId: string | null;
  };
  company: { id: string; name: string; slug: string; status: string } | null;
  permissions: string[];
}

interface AuthResult {
  tokens: Tokens;
  principal: Principal;
}

const PASSWORD = "SessionTest1234";
let email = "";
let companyName = "";
let createdCompanyId = "";
let createdUserId = "";

before(async () => {
  await startServer();
  const tag = randomUUID().slice(0, 8);
  email = `session-${tag}@test.local`;
  companyName = `Session Co ${tag}`;
});

after(async () => {
  await stopServer();
  // Before disconnecting: the first metrics gauge refresh is a fire-and-forget
  // dbAdmin query fired at import. If it lands after $disconnect() the pool is
  // re-opened and the process never drains (killed with SIGTERM).
  stopMetricsPush();
  if (createdCompanyId) {
    await dbAdmin.company.deleteMany({ where: { id: createdCompanyId } });
  }
  if (createdUserId) {
    await dbAdmin.user.deleteMany({ where: { id: createdUserId } });
  }
  await db.$disconnect();
  await dbAdmin.$disconnect();
});

describe("signup starts a session and a company", () => {
  let result: AuthResult;

  test("registering returns tokens and a principal", async () => {
    const response = await api<AuthResult>({
      path: "/api/v1/auth/signup",
      method: "POST",
      body: { companyName, fullName: "Session Owner", email, password: PASSWORD },
    });

    assert.equal(response.status, 201, `body: ${JSON.stringify(response.body)}`);

    result = response.body.data!;
    createdUserId = result.principal.user.id;
    createdCompanyId = result.principal.company!.id;

    assert.ok(result.tokens.accessToken, "Signup must hand back an access token");
    assert.ok(result.tokens.refreshToken, "Signup must hand back a refresh token");
  });

  test("the registrant is their company's single owner", () => {
    assert.equal(result.principal.user.isCompanyOwner, true);
    assert.equal(result.principal.user.isPlatformAdmin, false);
    assert.equal(result.principal.user.companyId, createdCompanyId);
    assert.equal(result.principal.company?.status, "ACTIVE");
    assert.ok(
      result.principal.permissions.length > 0,
      "An owner holds every permission without being granted any role"
    );
  });

  test("the company was provisioned with its roles and settings", async () => {
    const roles = await dbAdmin.role.count({ where: { companyId: createdCompanyId } });
    assert.ok(roles >= 3, `Expected the seeded owner/admin/staff roles, saw ${roles}`);

    const settings = await dbAdmin.companySettings.findUnique({
      where: { companyId: createdCompanyId },
    });
    assert.ok(settings, "A company must always have a settings row");
  });

  test("the owner's access token works immediately", async () => {
    const response = await api<Principal>({
      path: "/api/v1/auth/me",
      token: result.tokens.accessToken,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.data?.user.email, email);
  });
});

describe("a rejected field explains itself", () => {
  // A single bad field is the common case, and its message IS the reason the
  // request was refused. Reporting the generic "البيانات المدخلة غير صالحة."
  // makes the user guess which field is wrong — which is exactly what happened
  // for a weak password on signup, where the schema's Arabic rule existed but
  // never reached the screen.

  test("a weak password reports the rule, not a generic message", async () => {
    const response = await api({
      path: "/api/v1/auth/signup",
      method: "POST",
      body: {
        companyName: "Too Weak Co",
        fullName: "Weak Password",
        email: `weak-${randomUUID().slice(0, 8)}@test.local`,
        // 6 characters: below the schema's minimum of 8.
        password: "abc123",
      },
    });

    assert.equal(response.status, 422, `body: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code, "VALIDATION_ERROR");
    assert.equal(
      response.body.message,
      "كلمة المرور يجب ألا تقل عن ٨ أحرف.",
      "the password rule must reach the client, not a generic message"
    );
    // The field is still named, so a form can attach the error to its input
    // instead of showing it above the whole form.
    assert.deepEqual(response.body.details, [
      { field: "password", message: "كلمة المرور يجب ألا تقل عن ٨ أحرف." },
    ]);
  });

  test("several bad fields fall back to the general message", async () => {
    const response = await api({
      path: "/api/v1/auth/signup",
      method: "POST",
      body: { companyName: "x", fullName: "y", email: "not-an-email", password: "abc" },
    });

    assert.equal(response.status, 422, `body: ${JSON.stringify(response.body)}`);
    assert.equal(
      response.body.message,
      "البيانات المدخلة غير صالحة.",
      "with several failures at once there is no single reason to report"
    );
    assert.ok(
      Array.isArray(response.body.details) && (response.body.details as unknown[]).length > 1,
      "every failed field must still be listed in details"
    );
  });
});

describe("login and refresh rotation", () => {
  let accessToken = "";
  let refreshToken = "";

  test("logging in returns a fresh pair", async () => {
    const response = await api<AuthResult>({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email, password: PASSWORD },
    });

    assert.equal(response.status, 200, `body: ${JSON.stringify(response.body)}`);
    accessToken = response.body.data!.tokens.accessToken;
    refreshToken = response.body.data!.tokens.refreshToken;
    assert.ok(accessToken && refreshToken);
  });

  test("a wrong password is refused", async () => {
    const response = await api({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email, password: "wrong-password" },
    });

    assert.equal(response.status, 401);
  });

  test("rotating returns a new pair and a new access token", async () => {
    const response = await api<AuthResult>({
      path: "/api/v1/auth/refresh",
      method: "POST",
      body: { refreshToken },
    });

    assert.equal(response.status, 200, `body: ${JSON.stringify(response.body)}`);
    const rotated = response.body.data!;

    assert.notEqual(rotated.tokens.refreshToken, refreshToken, "Rotation must issue a new refresh token");
    assert.notEqual(rotated.tokens.accessToken, accessToken);

    const me = await api({ path: "/api/v1/auth/me", token: rotated.tokens.accessToken });
    assert.equal(me.status, 200, "The rotated access token must work");

    accessToken = rotated.tokens.accessToken;
    refreshToken = rotated.tokens.refreshToken;
  });

  test("the exchanged refresh token cannot be used twice", async () => {
    const previous = refreshToken;

    const first = await api<AuthResult>({
      path: "/api/v1/auth/refresh",
      method: "POST",
      body: { refreshToken: previous },
    });
    assert.equal(first.status, 200, "The first exchange succeeds");

    // Replay: a stolen token being used after its owner already rotated it.
    const replay = await api({
      path: "/api/v1/auth/refresh",
      method: "POST",
      body: { refreshToken: previous },
    });
    assert.equal(replay.status, 401, "A replayed refresh token must be refused");

    refreshToken = first.body.data!.tokens.refreshToken;
    accessToken = first.body.data!.tokens.accessToken;
  });

  test("a replay revokes the whole session family", async () => {
    // Having detected a replay, every session for that user is revoked — the
    // legitimate token included. Losing one session is cheaper than leaving a
    // thief's session alive.
    const afterReplay = await api({
      path: "/api/v1/auth/refresh",
      method: "POST",
      body: { refreshToken },
    });
    assert.equal(afterReplay.status, 401, "The legitimate token is revoked too");

    const live = await dbAdmin.session.count({ where: { userId: createdUserId, revokedAt: null } });
    assert.equal(live, 0, "No session may survive a detected replay");

    // The access token is stateless, so it keeps working until it expires; what
    // matters is that no new session can be minted from it.
    const me = await api({ path: "/api/v1/auth/me", token: accessToken });
    assert.equal(me.status, 200);
  });

  test("an unknown refresh token is refused", async () => {
    const response = await api({
      path: "/api/v1/auth/refresh",
      method: "POST",
      body: { refreshToken: randomUUID() },
    });
    assert.equal(response.status, 401);
  });
});

describe("logout", () => {
  test("logging out revokes the session", async () => {
    const login = await api<AuthResult>({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email, password: PASSWORD },
    });
    assert.equal(login.status, 200);

    const { accessToken, refreshToken } = login.body.data!.tokens;

    const logout = await api({
      path: "/api/v1/auth/logout",
      method: "POST",
      token: accessToken,
      body: { refreshToken },
    });
    // 204: `route()` sends an empty body for a null result, which is what an
    // action with nothing to return should do.
    assert.equal(logout.status, 204, `body: ${JSON.stringify(logout.body)}`);

    const reuse = await api({
      path: "/api/v1/auth/refresh",
      method: "POST",
      body: { refreshToken },
    });
    assert.equal(reuse.status, 401, "A logged-out refresh token must not mint a new session");
  });

  test("logout without a token ends every session for the user", async () => {
    const login = await api<AuthResult>({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email, password: PASSWORD },
    });
    const accessToken = login.body.data!.tokens.accessToken;

    const response = await api({ path: "/api/v1/auth/logout", method: "POST", token: accessToken, body: {} });
    assert.equal(response.status, 204, "Logging out without a token ends every session");

    const live = await dbAdmin.session.count({ where: { userId: createdUserId, revokedAt: null } });
    assert.equal(live, 0);
  });

  test("logging out requires a session", async () => {
    const response = await api({ path: "/api/v1/auth/logout", method: "POST", body: {} });
    assert.equal(response.status, 401);
  });
});

describe("changing the password", () => {
  const NEW_PASSWORD = "ChangedPass5678";

  test("an invalid current password is refused", async () => {
    const login = await api<AuthResult>({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email, password: PASSWORD },
    });
    const accessToken = login.body.data!.tokens.accessToken;

    const response = await api({
      path: "/api/v1/auth/change-password",
      method: "POST",
      token: accessToken,
      body: { currentPassword: "not-my-password", newPassword: NEW_PASSWORD },
    });

    assert.equal(response.status, 401);
  });

  test("changing it rotates the session and invalidates the old token", async () => {
    const login = await api<AuthResult>({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email, password: PASSWORD },
    });
    const oldAccessToken = login.body.data!.tokens.accessToken;

    const response = await api<AuthResult>({
      path: "/api/v1/auth/change-password",
      method: "POST",
      token: oldAccessToken,
      body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    });

    assert.equal(response.status, 200, `body: ${JSON.stringify(response.body)}`);
    assert.ok(response.body.data!.tokens.accessToken, "A fresh pair comes back for the current session");

    const stale = await api({ path: "/api/v1/auth/me", token: oldAccessToken });
    assert.equal(stale.status, 401, "The old access token must stop working everywhere");

    const fresh = await api({ path: "/api/v1/auth/me", token: response.body.data!.tokens.accessToken });
    assert.equal(fresh.status, 200, "The new token works");
  });

  test("the new password is the one that logs in", async () => {
    const old = await api({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email, password: PASSWORD },
    });
    assert.equal(old.status, 401, "The previous password must no longer work");

    const next = await api({
      path: "/api/v1/auth/login",
      method: "POST",
      body: { email, password: NEW_PASSWORD },
    });
    assert.equal(next.status, 200);
  });
});
