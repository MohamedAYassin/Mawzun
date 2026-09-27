import { randomUUID } from "node:crypto";
import { dbAdmin } from "../../src/config/database.js";
import { provisionCompany } from "../../src/modules/company/company.defaults.js";
import { hashPassword } from "../../src/utils/password.js";
import { newSecurityStamp } from "../../src/utils/tokens.js";

// Fixtures are real database rows on purpose. Row-level security lives in
// PostgreSQL, not in the application, so the only honest way to prove
// isolation is to run against a real server with the restricted role. A
// mocked client would test the mock.

/**
 * Every fixture created by a run is tagged so teardown can remove exactly
 * what it created and never touch hand-made development rows.
 */
const RUN_TAG = `t${Date.now().toString(36)}`;

export interface FixtureCompany {
  companyId: string;
  name: string;
  slug: string;
  /** The single owner — protected by invariant, not by convention. */
  ownerId: string;
  ownerEmail: string;
  memberId: string;
  memberEmail: string;
  /** A role that belongs to this company and no other. */
  roleId: string;
  productId: string;
}

const createdCompanyIds: string[] = [];
const createdUserIds: string[] = [];

export const TEST_PASSWORD = "TestPassw0rd!";

/**
 * Creates a complete company: owner, one ordinary member, one custom role and
 * one product.
 *
 * Ownership is established the same way signup does it — user first, then the
 * company pointing `ownerId` at that user, then the user attached to the
 * company — because the circular reference makes any other order impossible.
 */
export async function createCompany(label: string): Promise<FixtureCompany> {
  const tag = `${RUN_TAG}-${label}`;
  const companyId = randomUUID();
  const ownerId = randomUUID();
  const memberId = randomUUID();

  const passwordHash = await hashPassword(TEST_PASSWORD);

  let roleId = "";
  let productId = "";

  await dbAdmin.$transaction(async (tx) => {
    await tx.user.createMany({
      data: [
        {
          id: ownerId,
          email: `owner-${tag}@test.local`,
          passwordHash,
          fullName: `Owner ${label}`,
          status: "ACTIVE",
          securityStamp: newSecurityStamp(),
        },
        {
          id: memberId,
          email: `member-${tag}@test.local`,
          passwordHash,
          fullName: `Member ${label}`,
          status: "ACTIVE",
          securityStamp: newSecurityStamp(),
        },
      ],
    });

    await tx.company.create({
      data: {
        id: companyId,
        name: `Test Co ${tag}`,
        slug: `test-co-${tag}`,
        status: "ACTIVE",
        ownerId,
      },
    });

    await tx.user.updateMany({
      where: { id: { in: [ownerId, memberId] } },
      data: { companyId },
    });

    await provisionCompany(tx, {
      companyId,
      ownerUserId: ownerId,
      companyName: `Test Co ${tag}`,
    });

    const role = await tx.role.create({
      data: {
        companyId,
        name: `Custom ${label}`,
        description: "A company-owned role used to prove roles cannot cross companies.",
        kind: "CUSTOM",
        isSystem: false,
      },
      select: { id: true },
    });

    await tx.userRole.create({ data: { userId: memberId, roleId: role.id } });

    // `companyId` is a relation scalar, so Prisma exposes it through
    // `company.connect` rather than as a writable field.
    const product = await tx.product.create({
      data: {
        company: { connect: { id: companyId } },
        name: `Product ${label}`,
        skuCode: `SKU-${tag}`,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        actorId: ownerId,
        action: "fixture.created",
        entity: "Company",
        entityId: companyId,
      },
    });

    createdCompanyIds.push(companyId);
    createdUserIds.push(ownerId, memberId);

    roleId = role.id;
    productId = product.id;
  });

  return {
    companyId,
    name: `Test Co ${tag}`,
    slug: `test-co-${tag}`,
    ownerId,
    ownerEmail: `owner-${tag}@test.local`,
    memberId,
    memberEmail: `member-${tag}@test.local`,
    roleId,
    productId,
  };
}

/**
 * Removes everything this run created.
 *
 * Companies are deleted first: the owner relation is `Restrict`, so the company
 * row has to go before its users can, and deleting the company cascades to the
 * rest of its data.
 */
export async function cleanupFixtures(): Promise<void> {
  if (createdCompanyIds.length > 0) {
    await dbAdmin.auditLog.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await dbAdmin.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    createdCompanyIds.length = 0;
  }
  if (createdUserIds.length > 0) {
    await dbAdmin.user.deleteMany({ where: { id: { in: createdUserIds } } });
    createdUserIds.length = 0;
  }
}

/** Untagged probe rows left behind by earlier manual debugging. */
export async function cleanupProbeRows(): Promise<void> {
  await dbAdmin.user.deleteMany({ where: { email: { contains: "probe-" } } });
  await dbAdmin.company.deleteMany({ where: { slug: { in: ["alpha-co", "beta-co"] } } });
}
