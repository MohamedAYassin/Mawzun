// Counts the SQL statements `authenticate` issues, for an owner vs a member.
//
// The claim being checked: an owner no longer pays for the roles→permissions
// join, because their permissions come from getAllPermissions() regardless.
// A count is the only honest way to show that — the response is identical
// either way, so behaviour alone cannot prove the query is gone.
process.env.REDIS_URL = "";

import pg from "pg";

const statements = [];
const origQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) {
  const text = typeof args[0] === "string" ? args[0] : args[0]?.text ?? "";
  if (text) statements.push(text.replace(/\s+/g, " ").trim());
  return origQuery.apply(this, args);
};

const { dbAdmin } = await import("./dist/config/database.js");
const { signAccessToken } = await import("./dist/utils/jwt.js");
const app = (await import("./dist/app.js")).default;

// An owner (company.ownerId === user.id) and a plain member.
const ownerCompany = await dbAdmin.company.findFirstOrThrow({
  where: { deletedAt: null },
  select: { id: true, ownerId: true },
});

async function tokenFor(userId, companyId) {
  const u = await dbAdmin.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, securityStamp: true, companyId: true, isPlatformAdmin: true },
  });
  const { token } = signAccessToken({
    sub: u.id,
    sid: "00000000-0000-4000-8000-000000000000",
    email: u.email,
    securityStamp: u.securityStamp ?? "",
    companyId: companyId ?? u.companyId,
    isPlatformAdmin: u.isPlatformAdmin,
  });
  return token;
}

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const B = `http://127.0.0.1:${server.address().port}`;

// Warm up so pool/connection setup is not counted.
await fetch(`${B}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${await tokenFor(ownerCompany.ownerId, ownerCompany.id)}` } });

// --- owner ---
statements.length = 0;
const ownerToken = await tokenFor(ownerCompany.ownerId, ownerCompany.id);
await fetch(`${B}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${ownerToken}` } });
const ownerStatements = [...statements];
const ownerRolesQuery = ownerStatements.filter((s) => s.includes("role_permissions")).length;

console.log("OWNER — /auth/me");
console.log(`  statements: ${ownerStatements.length}`);
console.log(`  queries touching role_permissions: ${ownerRolesQuery}`);
for (const s of ownerStatements) console.log(`    · ${s.slice(0, 100)}`);

// --- a non-owner member, if one exists ---
const member = await dbAdmin.user.findFirst({
  where: {
    deletedAt: null,
    isPlatformAdmin: false,
    companyId: { not: null },
    roles: { some: {} },
  },
  select: { id: true, companyId: true },
});

if (member) {
  statements.length = 0;
  const memberToken = await tokenFor(member.id, ownerCompany.id);
  await fetch(`${B}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${memberToken}` } });
  const memberStatements = [...statements];
  const memberRolesQuery = memberStatements.filter((s) => s.includes("role_permissions")).length;
  console.log(`\nMEMBER — /auth/me`);
  console.log(`  statements: ${memberStatements.length}`);
  console.log(`  queries touching role_permissions: ${memberRolesQuery}`);
} else {
  console.log("\nMEMBER — none in this company; owner path only.");
}

server.close();
process.exit(0);
