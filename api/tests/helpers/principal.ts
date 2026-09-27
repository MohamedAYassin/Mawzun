import { randomUUID } from "node:crypto";

import { dbAdmin } from "../../src/config/database.js";
import { signAccessToken } from "../../src/utils/jwt.js";
import { newSecurityStamp } from "../../src/utils/tokens.js";

// Mints credentials for tests that need to be somebody in particular.
//
// Going through /auth/login would exercise the login path on every test that
// merely needs a session, and a platform administrator has no company to log
// into anyway. Signing the token directly keeps each test about the thing it
// claims to be about, while still producing a token the real `authenticate`
// middleware accepts.

/**
 * Creates a platform administrator: a real user row belonging to no company.
 *
 * Inserted with raw SQL rather than through the API because there is no
 * endpoint that can create one — platform staff are provisioned out of band, by
 * definition.
 */
export async function createPlatformAdmin(label = "platform"): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `${label}-${Date.now().toString(36)}@test.local`;

  await dbAdmin.$executeRaw`
    INSERT INTO "users" ("id","email","fullName","status","isPlatformAdmin","securityStamp","updatedAt")
    VALUES (${id}, ${email}, 'Platform Admin', 'ACTIVE', true, ${newSecurityStamp()}, now())`;

  return { id, email };
}

/**
 * A valid access token for an existing user.
 *
 * `sid` is invented: sessions are only consulted when a refresh token is
 * presented, and nothing in the access-token path looks the session up.
 */
export async function tokenFor(userId: string): Promise<string> {
  const user = await dbAdmin.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, securityStamp: true, companyId: true, isPlatformAdmin: true },
  });

  return signAccessToken({
    sub: user.id,
    sid: randomUUID(),
    email: user.email,
    securityStamp: user.securityStamp ?? "",
    companyId: user.companyId,
    isPlatformAdmin: user.isPlatformAdmin,
  }).token;
}

export async function deleteUser(id: string): Promise<void> {
  await dbAdmin.user.delete({ where: { id } }).catch(() => undefined);
}
