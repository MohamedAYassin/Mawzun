import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { BadRequestError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

export const CreateStorageLocationSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  code: z.string().trim().max(100).nullish(),
  warehouseId: z.string().min(1, "المستودع مطلوب."),
  parentId: z.string().nullish(),
  notes: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().default(true),
  maxWeightKg: z.coerce.number().min(0).max(9_999_999).nullish(),
  maxVolumeM3: z.coerce.number().min(0).max(9_999_999).nullish(),
});

export const UpdateStorageLocationSchema = CreateStorageLocationSchema.partial()
  .omit({ warehouseId: true })
  .strict();

export const StorageLocationFilterSchema = z.object({
  warehouseId: z.string().trim().min(1).optional(),
  isActive: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
});

const SELECT = {
  id: true,
  name: true,
  code: true,
  warehouseId: true,
  parentId: true,
  notes: true,
  isActive: true,
  maxWeightKg: true,
  maxVolumeM3: true,
  createdAt: true,
  warehouse: { select: { id: true, name: true } },
} as const;

/** Locations form a tree within a warehouse; the same cycle guard as categories. */
async function assertNoCycle(tx: Db, id: string, parentId: string): Promise<void> {
  if (id === parentId) {
    throw new BadRequestError("لا يمكن أن يكون الموقع أباً لنفسه.");
  }

  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 100; depth += 1) {
    if (cursor === id) {
      throw new BadRequestError("لا يمكن نقل الموقع إلى أحد فروعه.");
    }
    const parent: { parentId: string | null } | null = await tx.storageLocation.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
}

export const storageLocationRoutes = defineResource({
  entity: "StorageLocation",
  unpaginated: true,
  createSchema: CreateStorageLocationSchema,
  updateSchema: UpdateStorageLocationSchema,
  filterSchema: StorageLocationFilterSchema,
  view: [Permissions.ViewStorageLocations, Permissions.ViewInventory],
  manage: [
    Permissions.CreateStorageLocation,
    Permissions.UpdateStorageLocation,
    Permissions.DeleteStorageLocation,
  ],
  handlers: {
    async list(
      tx: Db,
      companyId: string,
      input: PaginationInput,
      filter: z.infer<typeof StorageLocationFilterSchema>
    ) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["name", "code"], input.search),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.storageLocation.findMany({
        where,
        orderBy: orderBy(input, ["name", "code", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.storageLocation.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.storageLocation.findFirst({
        where: { id, companyId, deletedAt: null },
        select: SELECT,
      });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateStorageLocationSchema>) {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: data.warehouseId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!warehouse) throw new BadRequestError("المستودع غير موجود.");

      if (data.parentId) await assertNoCycle(tx, "", data.parentId);

      return tx.storageLocation.create({
        data: {
          companyId,
          name: data.name,
          code: data.code ?? null,
          warehouseId: data.warehouseId,
          parentId: data.parentId ?? null,
          notes: data.notes ?? null,
          isActive: data.isActive,
          maxWeightKg: data.maxWeightKg ?? null,
          maxVolumeM3: data.maxVolumeM3 ?? null,
        },
        select: SELECT,
      });
    },

    async update(
      tx: Db,
      companyId: string,
      id: string,
      data: z.infer<typeof UpdateStorageLocationSchema>
    ) {
      const existing = await tx.storageLocation.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("موقع التخزين غير موجود.");

      if (data.parentId) await assertNoCycle(tx, id, data.parentId);

      return tx.storageLocation.update({
        where: { id },
        data: {
          name: data.name,
          code: data.code,
          parentId: data.parentId,
          notes: data.notes,
          isActive: data.isActive,
          maxWeightKg: data.maxWeightKg,
          maxVolumeM3: data.maxVolumeM3,
        },
        select: SELECT,
      });
    },

    /**
     * Blocks deletion while stock is physically held here.
     *
     * The stock level would cascade away silently, which is exactly the kind of
     * quiet data loss an inventory system must not allow.
     */
    async remove(tx: Db, _companyId: string, id: string) {
      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const children = await tx.storageLocation.count({ where: { parentId: id, deletedAt: null } });
      const levels = await tx.stockLevel.count({ where: { storageLocationId: id } });

      if (children > 0) {
        throw new BadRequestError("لا يمكن حذف موقع يحتوي على مواقع فرعية.");
      }
      if (levels > 0) {
        throw new BadRequestError("لا يمكن حذف موقع يحتوي على مخزون. يمكنك تعطيله بدلاً من ذلك.");
      }

      await tx.storageLocation.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});
