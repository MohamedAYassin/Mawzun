import type { Db } from "../../config/database.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import type { ListUsersInput } from "./user.schemas.js";

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  phoneNumber: true,
  avatarUrl: true,
  jobTitle: true,
  status: true,
  isPlatformAdmin: true,
  createdAt: true,
  lastLoginAt: true,
  roles: {
    select: { role: { select: { id: true, name: true, kind: true, isSystem: true } } },
  },
} as const;

export const userRepository = {
  async list(tx: Db, companyId: string, input: ListUsersInput) {
    const where = {
      companyId,
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
      ...(input.roleId ? { roles: { some: { roleId: input.roleId } } } : {}),
      ...searchFilter(["fullName", "email", "phoneNumber"], input.search),
    };

    // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
    const items = await tx.user.findMany({
      where,
      orderBy: orderBy(input, ["fullName", "email", "createdAt", "lastLoginAt"], "createdAt"),
      ...pageSlice(input),
      select: USER_SELECT,
    });
    const total = await tx.user.count({ where });

    return [items, total] as const;
  },

  detail(tx: Db, companyId: string, id: string) {
    return tx.user.findFirst({
      where: { id, companyId, deletedAt: null },
      select: USER_SELECT,
    });
  },

  findByEmail(tx: Db, email: string) {
    return tx.user.findFirst({ where: { email }, select: { id: true } });
  },

  /** The company's owner row — needed to enforce that they cannot be removed. */
  ownerOf(tx: Db, companyId: string) {
    return tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { ownerId: true },
    });
  },

  create(
    tx: Db,
    companyId: string,
    data: {
      email: string;
      passwordHash: string;
      fullName: string;
      phoneNumber?: string | null;
      jobTitle?: string | null;
      securityStamp: string;
      roleIds: string[];
    }
  ) {
    return tx.user.create({
      data: {
        companyId,
        email: data.email,
        passwordHash: data.passwordHash,
        fullName: data.fullName,
        phoneNumber: data.phoneNumber ?? null,
        jobTitle: data.jobTitle ?? null,
        securityStamp: data.securityStamp,
        status: "ACTIVE",
        roles: { create: data.roleIds.map((roleId) => ({ roleId })) },
      },
      select: USER_SELECT,
    });
  },

  update(
    tx: Db,
    _companyId: string,
    id: string,
    data: {
      fullName?: string;
      phoneNumber?: string | null;
      jobTitle?: string | null;
      avatarUrl?: string | null;
      status?: "INVITED" | "ACTIVE" | "SUSPENDED";
      roleIds?: string[];
    }
  ) {
    return tx.user.update({
      where: { id },
      data: {
        fullName: data.fullName,
        phoneNumber: data.phoneNumber,
        jobTitle: data.jobTitle,
        avatarUrl: data.avatarUrl,
        status: data.status,
        roles:
          data.roleIds === undefined
            ? undefined
            : {
                deleteMany: {},
                create: data.roleIds.map((roleId) => ({ roleId })),
              },
      },
      select: USER_SELECT,
    });
  },

  /** Soft delete: the audit trail and historical rows keep their references. */
  async softDelete(tx: Db, id: string): Promise<void> {
    await tx.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: "SUSPENDED", securityStamp: null },
    });
    await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  },

  setPassword(tx: Db, id: string, passwordHash: string, securityStamp: string) {
    return tx.user.update({
      where: { id },
      data: { passwordHash, securityStamp },
      select: USER_SELECT,
    });
  },

  /**
   * Roles available to this company. Verified against the company so a role id
   * belonging to another company cannot be attached by guessing it.
   */
  countRolesInCompany(tx: Db, companyId: string, roleIds: string[]) {
    return tx.role.count({ where: { id: { in: roleIds }, companyId } });
  },

  async assignRoles(tx: Db, userIds: string[], roleIds: string[]) {
    await tx.userRole.deleteMany({ where: { userId: { in: userIds } } });
    if (roleIds.length === 0) return;
    await tx.userRole.createMany({
      data: userIds.flatMap((userId) => roleIds.map((roleId) => ({ userId, roleId }))),
    });
  },

  /** Members of a company, newest first, ignoring soft-deleted rows. */
  activeMembers(tx: Db, companyId: string) {
    return tx.user.findMany({
      where: { companyId, ...notDeleted(false) },
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true, email: true },
    });
  },
};
