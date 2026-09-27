import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { db, dbAdmin } from "../src/config/database.js";
import { cleanupFixtures, createCompany, type FixtureCompany } from "./helpers/fixtures.js";

// The owner invariant, enforced where a service cannot be bypassed: the
// database itself.
//
// `Company.ownerId ... onDelete: Restrict` only ever stopped one thing — a hard
// DELETE. Everything else that leaves a company without a usable super admin
// (suspending the owner, soft-deleting them, detaching them from the company,
// moving them to another one) was stopped only by the service layer, and a
// service is a convention. A migration, a back-office script or a psql session
// ignores conventions.
//
// These tests talk to PostgreSQL directly and deliberately bypass the services,
// because that is the point: the rule has to hold for any writer.

let alpha: FixtureCompany;
let beta: FixtureCompany;

before(async () => {
  alpha = await createCompany("alpha");
  beta = await createCompany("beta");
});

after(async () => {
  await cleanupFixtures();
  await db.$disconnect();
  await dbAdmin.$disconnect();
});

/**
 * Runs `fn` and returns the error it threw, failing the test if it did not.
 *
 * Every case here is about a write that must be refused, so "it succeeded" has
 * to be a test failure rather than a silent pass.
 */
async function expectRejection(fn: () => Promise<unknown>): Promise<Error> {
  let error: Error | undefined;
  try {
    await fn();
  } catch (err) {
    error = err as Error;
  }
  assert.ok(error, "The database must refuse this write, but it succeeded");
  return error;
}

/** The row as PostgreSQL currently holds it. */
function rawUser(id: string) {
  return dbAdmin.$queryRaw<
    { status: string; deletedAt: Date | null; companyId: string | null }[]
  >`SELECT "status", "deletedAt", "companyId" FROM "users" WHERE "id" = ${id}`;
}

/**
 * A bare company built with raw SQL, in the same order signup uses it.
 *
 * The Prisma fixture helper is deliberately not used here: these tests are
 * about what the database does when nobody is holding its hand, so the company
 * is created the way a migration script or a psql session would create it.
 *
 * Deleting the company cascades to both users, so teardown is one statement.
 */
async function createRawCompany(label: string) {
  const tag = `raw-${Date.now().toString(36)}-${label}`;
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const companyId = randomUUID();

  await dbAdmin.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO "users" ("id","email","fullName","status","isPlatformAdmin","securityStamp","updatedAt")
      VALUES (${ownerId}, ${`o-${tag}@test.local`}, 'Owner', 'ACTIVE', false, 'stamp', now())`;
    await tx.$executeRaw`
      INSERT INTO "users" ("id","email","fullName","status","isPlatformAdmin","securityStamp","updatedAt")
      VALUES (${memberId}, ${`m-${tag}@test.local`}, 'Member', 'ACTIVE', false, 'stamp', now())`;
    await tx.$executeRaw`
      INSERT INTO "companies" ("id","name","slug","status","ownerId","currencyCode","timeZone","locale","fiscalYearStartMonth","updatedAt")
      VALUES (${companyId}, ${`Raw ${tag}`}, ${tag}, 'ACTIVE', ${ownerId}, 'EGP', 'Africa/Cairo', 'ar', 1, now())`;
    await tx.$executeRaw`UPDATE "users" SET "companyId" = ${companyId}, "updatedAt" = now() WHERE "id" IN (${ownerId}, ${memberId})`;
  });

  return { companyId, ownerId, memberId };
}

describe("the owner cannot be taken out of service", () => {
  test("suspending the owner is refused at commit", async () => {
    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "users" SET "status" = 'SUSPENDED', "updatedAt" = now() WHERE "id" = ${alpha.ownerId}`
    );

    assert.match(error.message, /COMPANY_OWNER_PROTECTED/);

    const [row] = await rawUser(alpha.ownerId);
    assert.equal(row.status, "ACTIVE", "The refused update must not leave a partial change");
  });

  test("inviting the owner (demoting to INVITED) is refused too", async () => {
    // Suspension is the obvious attack; INVITED is the quiet one. Both take the
    // owner out of service, so both must be caught.
    await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "users" SET "status" = 'INVITED', "updatedAt" = now() WHERE "id" = ${alpha.ownerId}`
    );
  });

  test("soft-deleting the owner is refused", async () => {
    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "users" SET "deletedAt" = now(), "updatedAt" = now() WHERE "id" = ${alpha.ownerId}`
    );

    assert.match(error.message, /COMPANY_OWNER_PROTECTED/);

    const [row] = await rawUser(alpha.ownerId);
    assert.equal(row.deletedAt, null, "The owner must still be present");
  });

  test("re-affirming ACTIVE on the owner is still allowed", async () => {
    // The rule is "the owner may not be taken out of service", not "the owner
    // row is frozen". A no-op re-affirmation must not be caught by it.
    await dbAdmin.$executeRaw`UPDATE "users" SET "status" = 'ACTIVE', "jobTitle" = 'المالك', "updatedAt" = now() WHERE "id" = ${alpha.ownerId}`;
  });
});

describe("the owner cannot be detached or moved", () => {
  test("clearing the owner's companyId is refused", async () => {
    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "users" SET "companyId" = NULL, "updatedAt" = now() WHERE "id" = ${alpha.ownerId}`
    );

    // Two invariants are broken at once — the owner is detached from the
    // company they own, and an ordinary user is left with no company. Which
    // trigger reports first is not part of the contract; that one of them does
    // is.
    assert.match(
      error.message,
      /COMPANY_OWNER_PROTECTED|COMPANY_MEMBERSHIP_REQUIRED/,
      `unexpected refusal: ${error.message}`
    );

    const [row] = await rawUser(alpha.ownerId);
    assert.equal(row.companyId, alpha.companyId, "The owner must still belong to their company");
  });

  test("moving the owner to another company is refused", async () => {
    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "users" SET "companyId" = ${beta.companyId}, "updatedAt" = now() WHERE "id" = ${alpha.ownerId}`
    );

    assert.match(error.message, /COMPANY_OWNER_PROTECTED/);

    const [row] = await rawUser(alpha.ownerId);
    assert.equal(row.companyId, alpha.companyId);
  });

  test("handing a company to a user who belongs elsewhere is refused", async () => {
    // Ownership transfer is not exposed, but it is one UPDATE away. The check
    // runs from the company's side too, so pointing a company at somebody who
    // is not one of its members cannot work.
    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "companies" SET "ownerId" = ${beta.memberId}, "updatedAt" = now() WHERE "id" = ${alpha.companyId}`
    );

    assert.match(error.message, /COMPANY_OWNER_PROTECTED/);

    const company = await dbAdmin.company.findUniqueOrThrow({
      where: { id: alpha.companyId },
      select: { ownerId: true },
    });
    assert.equal(company.ownerId, alpha.ownerId, "Ownership must be unchanged");
  });

  test("handing a company to a suspended member is refused", async () => {
    // This member *is* inside the company, so the membership half of the rule
    // passes; only their status should stop the transfer.
    await dbAdmin.$executeRaw`UPDATE "users" SET "status" = 'SUSPENDED', "updatedAt" = now() WHERE "id" = ${alpha.memberId}`;

    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "companies" SET "ownerId" = ${alpha.memberId}, "updatedAt" = now() WHERE "id" = ${alpha.companyId}`
    );

    assert.match(error.message, /COMPANY_OWNER_PROTECTED/);
  });
});

describe("ordinary members must belong to a company", () => {
  test("clearing a member's companyId is refused", async () => {
    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "users" SET "companyId" = NULL, "updatedAt" = now() WHERE "id" = ${beta.memberId}`
    );

    assert.match(error.message, /COMPANY_MEMBERSHIP_REQUIRED/);
  });

  test("inserting a company-less business user is refused", async () => {
    const id = randomUUID();
    const email = `orphan-${Date.now().toString(36)}@test.local`;

    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`
        INSERT INTO "users" ("id","email","fullName","status","isPlatformAdmin","securityStamp","updatedAt")
        VALUES (${id}, ${email}, 'Orphan', 'ACTIVE', false, 'stamp', now())`
    );

    assert.match(error.message, /COMPANY_MEMBERSHIP_REQUIRED/);

    const left = await dbAdmin.user.count({ where: { id } });
    assert.equal(left, 0, "The refused insert must not leave a row behind");
  });

  test("a member can still be soft-deleted", async () => {
    // If this failed, the invariant would have been implemented as a blanket
    // ban on touching users rather than as protection for specific rows.
    await dbAdmin.$executeRaw`UPDATE "users" SET "deletedAt" = now(), "status" = 'SUSPENDED', "updatedAt" = now() WHERE "id" = ${beta.memberId}`;

    const [row] = await rawUser(beta.memberId);
    assert.ok(row.deletedAt, "A non-owner member remains soft-deletable");
  });
});

describe("platform staff stay separate", () => {
  test("a platform administrator may not be given a company", async () => {
    const id = randomUUID();
    const email = `platform-${Date.now().toString(36)}@test.local`;

    // `companyId IS NULL` is how "platform staff" is expressed. If it also
    // means "an ordinary user whose company was never set", the null-company
    // shape that mis-scoped queries produce becomes reachable.
    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`
        INSERT INTO "users" ("id","email","fullName","status","isPlatformAdmin","securityStamp","companyId","updatedAt")
        VALUES (${id}, ${email}, 'Platform', 'ACTIVE', true, 'stamp', ${alpha.companyId}, now())`
    );

    assert.match(error.message, /PLATFORM_ADMIN_SEPARATE/);
  });

  test("a company-less platform administrator is accepted", async () => {
    const id = randomUUID();
    const email = `platform-ok-${Date.now().toString(36)}@test.local`;

    await dbAdmin.$executeRaw`
      INSERT INTO "users" ("id","email","fullName","status","isPlatformAdmin","securityStamp","updatedAt")
      VALUES (${id}, ${email}, 'Platform', 'ACTIVE', true, 'stamp', now())`;

    const created = await dbAdmin.user.findUniqueOrThrow({
      where: { id },
      select: { companyId: true, isPlatformAdmin: true },
    });
    assert.equal(created.companyId, null);
    assert.equal(created.isPlatformAdmin, true);

    await dbAdmin.user.delete({ where: { id } });
  });

  test("attaching an existing company user to the platform is refused", async () => {
    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "users" SET "isPlatformAdmin" = true, "updatedAt" = now() WHERE "id" = ${alpha.ownerId}`
    );

    assert.match(error.message, /PLATFORM_ADMIN_SEPARATE/);
  });
});

describe("deferral is what makes signup possible", () => {
  let scratch: { companyId: string; ownerId: string; memberId: string };

  before(async () => {
    scratch = await createRawCompany("defer");
  });

  after(async () => {
    // Deleting the company cascades to its users, so this is the whole teardown.
    await dbAdmin.company.delete({ where: { id: scratch.companyId } });
  });

  test("a user may be created before the company that will own them", async () => {
    // The circular reference at signup: the user exists first with no company,
    // the company then points ownerId at that user, and only afterwards is the
    // user attached. A company-less business user is illegal *to commit* but
    // has to be legal in the middle of the transaction — which is exactly what
    // DEFERRABLE INITIALLY DEFERRED buys us. The fixture helper builds its
    // companies this way, so reaching this test at all proves it.
    const company = await dbAdmin.company.findUniqueOrThrow({
      where: { id: scratch.companyId },
      select: { ownerId: true },
    });
    assert.equal(company.ownerId, scratch.ownerId, "The circular creation must survive to commit");

    const [owner] = await rawUser(scratch.ownerId);
    assert.equal(owner.companyId, scratch.companyId);
    assert.equal(owner.status, "ACTIVE");
  });

  test("an owner may be suspended and reinstated inside one transaction", async () => {
    // Two statements, each of which would be illegal on its own: the first
    // leaves a suspended owner, the second repairs it before anything is
    // committed. An immediate check would reject the first statement.
    await dbAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "users" SET "status" = 'SUSPENDED', "updatedAt" = now() WHERE "id" = ${scratch.ownerId}`;
      await tx.$executeRaw`UPDATE "users" SET "status" = 'ACTIVE', "updatedAt" = now() WHERE "id" = ${scratch.ownerId}`;
    });

    const [owner] = await rawUser(scratch.ownerId);
    assert.equal(owner.status, "ACTIVE", "Only the committed state is judged");
  });

  test("ownership can be transferred, but only to a state that is legal at commit", async () => {
    // The member is suspended for the length of the transaction and reinstated
    // before it ends. The company's new owner is therefore active and inside
    // the company by the time anything is judged.
    await dbAdmin.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "users" SET "status" = 'SUSPENDED', "updatedAt" = now() WHERE "id" = ${scratch.memberId}`;
      await tx.$executeRaw`UPDATE "companies" SET "ownerId" = ${scratch.memberId}, "updatedAt" = now() WHERE "id" = ${scratch.companyId}`;
      await tx.$executeRaw`UPDATE "users" SET "status" = 'ACTIVE', "updatedAt" = now() WHERE "id" = ${scratch.memberId}`;
    });

    const company = await dbAdmin.company.findUniqueOrThrow({
      where: { id: scratch.companyId },
      select: { ownerId: true },
    });
    assert.equal(company.ownerId, scratch.memberId, "The transfer commits");

    // Hand it back, so the remaining tests see the original owner.
    await dbAdmin.$executeRaw`UPDATE "companies" SET "ownerId" = ${scratch.ownerId}, "updatedAt" = now() WHERE "id" = ${scratch.companyId}`;
  });

  test("transferring to a member who stays suspended is refused", async () => {
    // The same three statements minus the repair. Now the member really is
    // suspended at commit, so the company would be handed to someone who cannot
    // log in.
    await dbAdmin.$executeRaw`UPDATE "users" SET "status" = 'SUSPENDED', "updatedAt" = now() WHERE "id" = ${scratch.memberId}`;

    const error = await expectRejection(() =>
      dbAdmin.$executeRaw`UPDATE "companies" SET "ownerId" = ${scratch.memberId}, "updatedAt" = now() WHERE "id" = ${scratch.companyId}`
    );

    assert.match(error.message, /COMPANY_OWNER_PROTECTED/);

    await dbAdmin.$executeRaw`UPDATE "users" SET "status" = 'ACTIVE', "updatedAt" = now() WHERE "id" = ${scratch.memberId}`;
  });
});

describe("the invariant is real database state", () => {
  test("all three constraint triggers exist and are deferred", async () => {
    const triggers = await dbAdmin.$queryRaw<{ tgname: string; tgdeferrable: boolean; tginitdeferred: boolean }[]>`
      SELECT tgname, tgdeferrable, tginitdeferred
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid IN ('users'::regclass, 'companies'::regclass)
      ORDER BY tgname`;

    const byName = new Map(triggers.map((t) => [t.tgname, t]));
    assert.ok(byName.has("users_owner_usable"), "The owner-usable trigger must exist");
    assert.ok(byName.has("users_membership"), "The membership trigger must exist");
    assert.ok(byName.has("companies_owner_usable"), "The company-side owner trigger must exist");

    for (const trigger of triggers) {
      assert.equal(trigger.tgdeferrable, true, `${trigger.tgname} must be deferrable`);
      assert.equal(trigger.tginitdeferred, true, `${trigger.tgname} must be deferred by default`);
    }
  });

  test("the check functions bypass row-level security", async () => {
    // Row-level security is FORCEd on both tables, and a deferred trigger runs
    // while the transaction-local company setting is on its way out. Reading
    // through a SECURITY DEFINER is what keeps the verdict independent of the
    // connection and of the caller.
    const functions = await dbAdmin.$queryRaw<{ proname: string; prosecdef: boolean }[]>`
      SELECT proname, prosecdef
      FROM pg_proc
      WHERE proname LIKE 'mawzun_assert_%'`;

    assert.equal(functions.length, 3, "All three invariant functions must be installed");
    for (const fn of functions) {
      assert.equal(fn.prosecdef, true, `${fn.proname} must be SECURITY DEFINER`);
    }
  });
});
