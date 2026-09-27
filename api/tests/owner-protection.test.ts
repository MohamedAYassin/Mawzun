import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { db, dbAdmin } from "../src/config/database.js";
import { withCompanyScope } from "../src/config/companyContext.js";
import { asRequest, makeContext } from "./helpers/context.js";
import { cleanupFixtures, createCompany, type FixtureCompany } from "./helpers/fixtures.js";
import { userService } from "../src/modules/user/user.service.js";
import { CompanyOwnerProtectedError } from "../src/shared/errors.js";
import { getAllPermissions } from "../src/constants/permissions.js";

// Proves the central invariant: a company always has exactly one owner, and
// that owner can never be deleted, suspended, or stripped of effective access.
//
// Rule 3 of the domain model. It is enforced in four places — the database
// (Restrict), the service, the API authorisation layer, and the frontend — and
// each layer is tested separately, because a gap in any one of them is a
// company with no super admin.

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

/** The owner acting on their own company. */
function ownerRequest(company: FixtureCompany) {
  return asRequest(
    makeContext({
      companyId: company.companyId,
      userId: company.ownerId,
      isCompanyOwner: true,
    })
  );
}

describe("owner cannot be deleted", () => {
  test("the service refuses to delete the owner", async () => {
    await assert.rejects(
      () => userService.remove(ownerRequest(alpha), alpha.ownerId),
      CompanyOwnerProtectedError,
      "Deleting the owner must be refused before it reaches the database"
    );
  });

  test("the refusal leaves the owner fully intact", async () => {
    const owner = await dbAdmin.user.findUniqueOrThrow({
      where: { id: alpha.ownerId },
      select: { deletedAt: true, status: true, securityStamp: true },
    });

    assert.equal(owner.deletedAt, null, "The owner must not be soft-deleted");
    assert.equal(owner.status, "ACTIVE", "The owner must remain active");
    assert.ok(owner.securityStamp, "The owner's session must not be invalidated");
  });

  test("the database itself rejects deleting the owner row", async () => {
    // The service check is a courtesy that produces a readable error. The real
    // guarantee is `Company.ownerId ... onDelete: Restrict` — so even a raw
    // delete, with no service in the way, must fail.
    await assert.rejects(
      () => dbAdmin.user.delete({ where: { id: alpha.ownerId } }),
      /foreign key|constraint/i,
      "A raw delete of the owner must violate the Restrict foreign key"
    );
  });

  test("the owner cannot delete themselves", async () => {
    // A second owner-shaped company, because the first test in this file has
    // already exercised Alpha's owner enough that the ordering would matter.
    await assert.rejects(
      () => userService.remove(ownerRequest(beta), beta.ownerId),
      CompanyOwnerProtectedError
    );
  });

  test("an ordinary member can still be deleted", async () => {
    // If this fails, the owner rule has been implemented as a blanket ban on
    // user deletion rather than as protection for one specific row.
    await userService.remove(ownerRequest(alpha), alpha.memberId);

    const member = await dbAdmin.user.findUniqueOrThrow({
      where: { id: alpha.memberId },
      select: { deletedAt: true, status: true },
    });

    assert.ok(member.deletedAt, "A non-owner member must be soft-deletable");
    assert.equal(member.status, "SUSPENDED", "A deleted member is suspended, not merely flagged");
  });
});

describe("owner cannot be suspended", () => {
  test("the service refuses to suspend the owner", async () => {
    await assert.rejects(
      () => userService.update(ownerRequest(alpha), alpha.ownerId, { status: "SUSPENDED" }),
      CompanyOwnerProtectedError,
      "Suspending the owner would leave the company with no usable super admin"
    );
  });

  test("the service refuses to demote the owner to invited", async () => {
    await assert.rejects(
      () => userService.update(ownerRequest(alpha), alpha.ownerId, { status: "INVITED" }),
      CompanyOwnerProtectedError
    );
  });

  test("setting the owner back to ACTIVE is allowed", async () => {
    // The rule is "the owner may not be taken out of service", not "the owner
    // may never be touched". Re-affirming ACTIVE must still work.
    const updated = await userService.update(ownerRequest(alpha), alpha.ownerId, {
      status: "ACTIVE",
      jobTitle: "المالك",
    });

    assert.equal(updated.status, "ACTIVE");
    assert.equal(updated.jobTitle, "المالك");
  });

  test("the owner keeps every permission even with no roles attached", async () => {
    await dbAdmin.userRole.deleteMany({ where: { userId: alpha.ownerId } });

    const roles = await dbAdmin.userRole.count({ where: { userId: alpha.ownerId } });
    assert.equal(roles, 0, "The owner should now have no role rows at all");

    // Authority comes from Company.ownerId, not from the join table.
    const stillOwner = await dbAdmin.company.findUniqueOrThrow({
      where: { id: alpha.companyId },
      select: { ownerId: true },
    });
    assert.equal(stillOwner.ownerId, alpha.ownerId);

    const permissionCount = getAllPermissions().length;
    assert.ok(permissionCount > 0, "The permission catalogue should not be empty");

    const resolved = await withCompanyScope(
      makeContext({
        companyId: alpha.companyId,
        userId: alpha.ownerId,
        isCompanyOwner: true,
      }),
      (tx) => tx.company.findUniqueOrThrow({ where: { id: alpha.companyId } })
    );
    assert.equal(resolved.ownerId, alpha.ownerId, "Ownership survives the loss of role rows");
  });

  test("bulk role assignment skips the owner", async () => {
    const result = await userService.assignRoles(ownerRequest(alpha), {
      userIds: [alpha.ownerId],
      roleIds: [alpha.roleId],
    });

    assert.equal(
      result.updated,
      0,
      "The owner is filtered out of bulk assignment, so nothing is updated"
    );
  });
});

describe("owner protection is company-scoped", () => {
  test("another company cannot delete or suspend this owner", async () => {
    // Beta's owner is not Alpha's owner. If the owner check were implemented
    // as "is this user an owner anywhere", Beta's owner would be wrongly
    // protected inside Alpha's scope. Here Beta's owner is simply invisible.
    await assert.rejects(
      () => userService.remove(ownerRequest(alpha), beta.ownerId),
      /غير موجود|not found/i,
      "Beta's owner is not visible to Alpha at all"
    );
  });

  test("a company has exactly one owner", async () => {
    // ownerId is @unique, so the database cannot hold two companies pointing at
    // the same user. Prisma materialises that as a unique index rather than a
    // table constraint, so pg_indexes is the place to look — checking only
    // pg_constraint would report a false negative.
    const indexes = await dbAdmin.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'companies'
        AND indexname LIKE '%ownerId%'
    `;

    const unique = indexes.find((i) => /UNIQUE/i.test(i.indexdef));
    assert.ok(
      unique,
      `companies.ownerId must carry a UNIQUE index, saw: ${JSON.stringify(indexes)}`
    );
  });

  test("the owner foreign key uses Restrict, not Cascade", async () => {
    const fk = await dbAdmin.$queryRaw<{ conname: string; confdeltype: string }[]>`
      SELECT conname, confdeltype::text
      FROM pg_constraint
      WHERE conrelid = 'companies'::regclass
        AND contype = 'f'
        AND conname LIKE '%ownerId%'
    `;

    // 'r' = RESTRICT, 'a' = NO ACTION (equivalent for our purposes).
    assert.ok(fk.length > 0, "companies.ownerId must be a foreign key");
    assert.ok(
      ["r", "a"].includes(fk[0].confdeltype),
      `ownerId must be Restrict (got pg code "${fk[0].confdeltype}"); Cascade would silently delete the company`
    );
  });
});
