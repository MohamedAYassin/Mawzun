import type { Db } from "../../config/database.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import type { ListRolesInput } from "./role.schemas.js";

const ROLE_SELECT = {
  id: true,
  name: true,
  description: true,
  kind: true,
  isSystem: true,
  createdAt: true,
  permissions: { select: { permissionKey: true } },
  _count: { select: { users: true } },
} as const;

export const roleRepository = {
  async list(tx: Db, companyId: string, input: ListRolesInput) {
    const where = {
      companyId,
      ...searchFilter(["name"], input.search),
    };

    // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
    const items = await tx.role.findMany({
      where,
      orderBy: orderBy(input, ["name", "createdAt"], "createdAt"),
      ...pageSlice(input),
      select: ROLE_SELECT,
    });
    const total = await tx.role.count({ where });

    return [items, total] as const;
  },

  detail(tx: Db, companyId: string, id: string) {
    return tx.role.findFirst({ where: { id, companyId }, select: ROLE_SELECT });
  },

  existsByName(tx: Db, companyId: string, name: string, exceptId?: string) {
    return tx.role.findFirst({
      where: { companyId, name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
  },

  create(
    tx: Db,
    companyId: string,
    data: { name: string; description?: string | null; permissionKeys: string[] }
  ) {
    return tx.role.create({
      data: {
        companyId,
        name: data.name,
        description: data.description ?? null,
        kind: "CUSTOM",
        permissions: { create: data.permissionKeys.map((permissionKey) => ({ permissionKey })) },
      },
      select: ROLE_SELECT,
    });
  },

  update(
    tx: Db,
    id: string,
    data: { name?: string; description?: string | null; permissionKeys?: string[] }
  ) {
    return tx.role.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        permissions:
          data.permissionKeys === undefined
            ? undefined
            : {
                deleteMany: {},
                create: data.permissionKeys.map((permissionKey) => ({ permissionKey })),
              },
      },
      select: ROLE_SELECT,
    });
  },

  remove(tx: Db, id: string) {
    // UserRole rows cascade, so members simply lose this role.
    return tx.role.delete({ where: { id }, select: { id: true, name: true } });
  },
};
