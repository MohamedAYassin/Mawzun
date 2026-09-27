import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { db, dbAdmin } from "../src/config/database.js";
import { withCompanyScope } from "../src/config/companyContext.js";
import { asRequest, makeContext, platformContext } from "./helpers/context.js";
import { cleanupFixtures, createCompany, type FixtureCompany } from "./helpers/fixtures.js";

// Proves the isolation boundary: a company can never read or write another
// company's rows, and a caller with no company sees nothing at all.
//
// These run against the restricted `db` client so row-level security is in
// force. If a future change drops a policy or forgets a `companyId` filter,
// these tests fail — the application layer alone would not catch it.

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

describe("cross-company isolation", () => {
  test("a company sees only its own products", async () => {
    const seen = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.product.findMany({ select: { id: true, name: true } })
    );

    assert.equal(seen.length, 1, "Alpha should see exactly its own product");
    assert.equal(seen[0].id, alpha.productId);
  });

  test("a company cannot read another company's product by id", async () => {
    const stolen = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.product.findFirst({ where: { id: beta.productId }, select: { id: true } })
    );

    assert.equal(stolen, null, "Beta's product must be invisible to Alpha");
  });

  test("a company sees only its own members", async () => {
    const members = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.user.findMany({ select: { id: true, email: true } })
    );

    const ids = members.map((m) => m.id).sort();
    assert.deepEqual(
      ids,
      [alpha.ownerId, alpha.memberId].sort(),
      "Alpha must not see Beta's owner or member"
    );
  });

  test("a company sees only its own roles", async () => {
    const roles = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.role.findMany({ where: { kind: "CUSTOM" }, select: { id: true } })
    );

    assert.deepEqual(
      roles.map((r) => r.id),
      [alpha.roleId],
      "Only Alpha's custom role should be visible"
    );
  });

  test("a company cannot attach another company's role to its own user", async () => {
    // The repository counts how many of the given role ids exist inside the
    // caller's company; a foreign role must count as zero.
    const visible = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.role.count({ where: { id: { in: [beta.roleId] }, companyId: alpha.companyId } })
    );

    assert.equal(visible, 0, "Beta's role must not be resolvable from Alpha's scope");
  });

  test("a company cannot write a row into another company", async () => {
    // The WITH CHECK clause is what rejects this. Without it a company could
    // insert rows it would then be unable to read.
    await assert.rejects(
      withCompanyScope(
        makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
        (tx) =>
          tx.product.create({
            data: {
              company: { connect: { id: beta.companyId } },
              name: "Smuggled",
              skuCode: "SMUGGLED-1",
            },
          })
      ),
      "Inserting a row tagged with another company's id must be rejected"
    );
  });

  test("a company cannot update another company's row", async () => {
    const before = await dbAdmin.product.findUniqueOrThrow({
      where: { id: beta.productId },
      select: { name: true },
    });

    const result = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) =>
        tx.product.updateMany({
          where: { id: beta.productId },
          data: { name: "Hijacked" },
        })
    );

    assert.equal(result.count, 0, "No row should match outside the caller's company");

    const after = await dbAdmin.product.findUniqueOrThrow({
      where: { id: beta.productId },
      select: { name: true },
    });
    assert.equal(after.name, before.name, "Beta's product must be untouched");
  });

  test("a company cannot delete another company's row", async () => {
    const result = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.product.deleteMany({ where: { id: beta.productId } })
    );

    assert.equal(result.count, 0, "No row should match outside the caller's company");

    const stillThere = await dbAdmin.product.findUnique({
      where: { id: beta.productId },
      select: { id: true },
    });
    assert.ok(stillThere, "Beta's product must survive Alpha's delete attempt");
  });

  test("a company sees only its own company row", async () => {
    const companies = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.company.findMany({ select: { id: true } })
    );

    assert.deepEqual(
      companies.map((c) => c.id),
      [alpha.companyId],
      "The companies table must expose only the caller's own row"
    );
  });

  test("a company sees only its own settings", async () => {
    const settings = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.companySettings.findMany({ select: { companyId: true } })
    );

    assert.deepEqual(
      settings.map((s) => s.companyId),
      [alpha.companyId]
    );
  });
});

describe("fail-closed behaviour", () => {
  test("an empty company context sees nothing", async () => {
    const seen = await withCompanyScope(
      makeContext({ companyId: null, userId: alpha.ownerId }),
      (tx) => tx.product.findMany({ select: { id: true } })
    );

    assert.equal(seen.length, 0, "With no company in scope, isolation must fail closed");
  });

  test("a null companyId filter cannot be used to reach company-less rows", async () => {
    // The regression this guards: services wrote `req.ctx.companyId!`, so a
    // platform caller produced `where: { companyId: null }`, which Prisma
    // compiles to `companyId IS NULL`. The rows it matched were not the
    // caller's — they were whatever happened to have no company.
    const leaked = await withCompanyScope(
      makeContext({ companyId: alpha.companyId, userId: alpha.ownerId, isCompanyOwner: true }),
      (tx) => tx.user.findMany({ where: { companyId: null }, select: { id: true } })
    );

    assert.equal(leaked.length, 0, "A company caller must not match company-less rows");
  });

  test("a company user without the owner flag still cannot cross companies", async () => {
    // The ordinary member holds only the permissions their role grants, which
    // is far fewer than the owner's. Isolation must not depend on permission
    // level — it comes from the company context, not the role.
    const seen = await withCompanyScope(
      makeContext({
        companyId: beta.companyId,
        userId: beta.memberId,
        isCompanyOwner: false,
        permissions: [],
      }),
      (tx) => tx.product.findMany({ select: { id: true } })
    );

    assert.deepEqual(
      seen.map((p) => p.id),
      [beta.productId],
      "A member with zero permissions still sees only their own company"
    );
  });
});

describe("platform callers", () => {
  test("a platform caller has no company, so company-scoped reads are empty", async () => {
    // Platform staff belong to no company. Their route is /platform/*, which
    // uses the privileged client; if they ever reach a company-scoped service
    // the result must be empty rather than a silent partial match.
    const seen = await withCompanyScope(platformContext(alpha.ownerId), (tx) =>
      tx.product.findMany({ select: { id: true } })
    );

    assert.equal(
      seen.length,
      0,
      "Products have no platform escape hatch, so a platform caller sees none"
    );
  });

  test("requireCompanyContext rejects a caller with no company", async () => {
    const { requireCompanyContext } = await import("../src/middleware/authorize.js");

    let status = 0;
    let message = "";
    const req = { ctx: platformContext(alpha.ownerId) };
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json() {
        return this;
      },
    };

    requireCompanyContext()(
      req as never,
      res as never,
      (err?: unknown) => {
        const e = err as { statusCode?: number; message?: string };
        status = e?.statusCode ?? 0;
        message = e?.message ?? "";
      }
    );

    assert.equal(status, 403, "A company-less caller must be refused with 403");
    assert.ok(message.length > 0, "The refusal must carry an explanation");
  });

  test("requirePermission still admits the company owner", async () => {
    const { requirePermission } = await import("../src/middleware/authorize.js");
    const { Permissions } = await import("../src/constants/permissions.js");

    let passed = false;
    requirePermission(Permissions.ManageUsers)(
      { ctx: makeContext({ companyId: alpha.companyId, userId: alpha.ownerId }) } as never,
      {} as never,
      () => {
        passed = true;
      }
    );

    assert.ok(passed, "The owner holds ManageUsers through the permission set");
  });

  test("requirePermission denies a member without that permission", async () => {
    const { requirePermission } = await import("../src/middleware/authorize.js");
    const { Permissions } = await import("../src/constants/permissions.js");

    let status = 0;
    requirePermission(Permissions.ManageUsers)(
      {
        ctx: makeContext({
          companyId: beta.companyId,
          userId: beta.memberId,
          permissions: [],
        }),
      } as never,
      {} as never,
      (err?: unknown) => {
        status = (err as { statusCode?: number })?.statusCode ?? 0;
      }
    );

    assert.equal(status, 403, "A member without ManageUsers must be refused");
  });

  test("asRequest produces a usable service request", async () => {
    const ctx = makeContext({
      companyId: alpha.companyId,
      userId: alpha.ownerId,
      isCompanyOwner: true,
    });
    const req = asRequest(ctx);
    assert.equal(req.ctx.companyId, alpha.companyId);
  });
});
