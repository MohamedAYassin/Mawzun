import { dbAdmin, type AdminTx, type Db } from "../../config/database.js";
import type { ListCompaniesInput, UpdateCompanyInput } from "./company.schemas.js";

// Two repositories on purpose.
//
//   companyRepository  — reads and writes the caller's own company. Runs on the
//                        scoped transaction client, so row-level security is in
//                        force and a company can only ever see itself.
//   platformCompanyRepo — the back-office view across companies. It can only be
//                        reached through requirePlatformAdmin(), and it uses the
//                        privileged client because there is no company to scope
//                        to.

export const companyRepository = {
  /**
   * The caller's own company.
   *
   * NOTE ON SHAPE: this deliberately avoids loading several relations at once.
   * Prisma fetches each relation with its own statement and issues them
   * CONCURRENTLY, which on a transaction client means two statements racing on
   * one connection — pg warns about it today and rejects it on pg 9. Loading
   * the scalar row plus one relation per query keeps every statement sequential
   * and costs nothing extra, because the round-trips are the same.
   */
  async findById(tx: Db, id: string) {
    const company = await tx.company.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        legalName: true,
        taxNumber: true,
        commercialNo: true,
        email: true,
        phoneNumber: true,
        website: true,
        addressLine: true,
        city: true,
        region: true,
        countryCode: true,
        postalCode: true,
        currencyCode: true,
        timeZone: true,
        locale: true,
        fiscalYearStartMonth: true,
        status: true,
        activatedAt: true,
        createdAt: true,
      },
    });
    const owner = await tx.company.findUniqueOrThrow({
      where: { id },
      select: { owner: { select: { id: true, fullName: true, email: true } } },
    });
    const settings = await tx.company.findUniqueOrThrow({
      where: { id },
      select: { settings: true },
    });
    const counts = await tx.company.findUniqueOrThrow({
      where: { id },
      select: { _count: { select: { users: true, products: true, orders: true } } },
    });
    return { ...company, owner: owner.owner, settings: settings.settings, _count: counts._count };
  },

  update(tx: Db, id: string, data: UpdateCompanyInput) {
    return tx.company.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        slug: true,
        legalName: true,
        taxNumber: true,
        commercialNo: true,
        email: true,
        phoneNumber: true,
        website: true,
        addressLine: true,
        city: true,
        region: true,
        countryCode: true,
        postalCode: true,
        currencyCode: true,
        timeZone: true,
        locale: true,
        fiscalYearStartMonth: true,
        status: true,
      },
    });
  },
};

export const platformCompanyRepository = {
  /** The back-office company list. This is the "company is listed" surface. */
  list(input: ListCompaniesInput) {
    const where = {
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
      ...(input.search
        ? { name: { contains: input.search, mode: "insensitive" as const } }
        : {}),
    };

    return dbAdmin.$transaction([
      dbAdmin.company.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          owner: { select: { id: true, fullName: true, email: true, lastLoginAt: true } },
          _count: { select: { users: true, products: true, orders: true } },
        },
      }),
      dbAdmin.company.count({ where }),
    ]);
  },

};

/** Rows a status change needs before it can be applied or explained. */
export const platformCompanyAdmin = {
  findForStatusChange(tx: AdminTx, id: string) {
    return tx.company.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, status: true },
    });
  },

  /**
   * Ends every live session for a company's members.
   *
   * Suspending a company while its staff hold valid access tokens would leave
   * the API reachable until each token expired. Revoking the sessions makes the
   * change take effect now; the status check in `authenticate` remains, because
   * a token signed before the change is still cryptographically valid.
   */
  async revokeSessions(tx: AdminTx, companyId: string): Promise<number> {
    const members = await tx.user.findMany({
      where: { companyId },
      select: { id: true },
    });

    if (members.length === 0) return 0;

    const { count } = await tx.session.updateMany({
      where: { userId: { in: members.map((member) => member.id) }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return count;
  },
};
