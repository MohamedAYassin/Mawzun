import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

export const CreateWarehouseSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  code: z.string().trim().max(100).nullish(),
  address: z.string().trim().max(500).nullish(),
  city: z.string().trim().max(120).nullish(),
  countryCode: z.string().trim().length(2, "كود الدولة يجب أن يكون حرفين.").nullish(),
  phoneNumber: z.string().trim().max(50).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

export const UpdateWarehouseSchema = CreateWarehouseSchema.partial().strict();

const SELECT = {
  id: true,
  name: true,
  code: true,
  address: true,
  city: true,
  countryCode: true,
  phoneNumber: true,
  notes: true,
  isActive: true,
  isDefault: true,
  createdAt: true,
  _count: { select: { storageLocations: true } },
} as const;

async function assertNameFree(
  tx: Db,
  companyId: string,
  name: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.warehouse.findFirst({
    where: { companyId, name, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("يوجد مستودع بنفس الاسم بالفعل.");
}

/** Only one warehouse can be the default, so promoting one demotes the rest. */
async function applyDefault(tx: Db, companyId: string, id: string): Promise<void> {
  await tx.warehouse.updateMany({
    where: { companyId, isDefault: true, id: { not: id } },
    data: { isDefault: false },
  });
}

export const warehouseRoutes = defineResource({
  entity: "Warehouse",
  unpaginated: true,
  createSchema: CreateWarehouseSchema,
  updateSchema: UpdateWarehouseSchema,
  view: [Permissions.ViewWarehouses, Permissions.ViewInventory],
  manage: [Permissions.CreateWarehouse, Permissions.UpdateWarehouse, Permissions.DeleteWarehouse],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["name", "code", "city"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.warehouse.findMany({
        where,
        orderBy: orderBy(input, ["name", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.warehouse.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.warehouse.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateWarehouseSchema>) {
      await assertNameFree(tx, companyId, data.name);

      const created = await tx.warehouse.create({
        data: { companyId, ...data },
        select: SELECT,
      });
      if (data.isDefault) await applyDefault(tx, companyId, created.id);
      return created;
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateWarehouseSchema>) {
      const existing = await tx.warehouse.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("المستودع غير موجود.");

      if (data.name) await assertNameFree(tx, companyId, data.name, id);

      const updated = await tx.warehouse.update({ where: { id }, data, select: SELECT });
      if (data.isDefault) await applyDefault(tx, companyId, id);
      return updated;
    },

    async remove(tx: Db, _companyId: string, id: string) {
      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const locations = await tx.storageLocation.count({ where: { warehouseId: id, deletedAt: null } });
      const levels = await tx.stockLevel.count({ where: { storageLocation: { warehouseId: id } } });

      if (locations > 0 || levels > 0) {
        throw new BadRequestError(
          "لا يمكن حذف المستودع لأنه يحتوي على مواقع تخزين أو مخزون. يمكنك تعطيله بدلاً من ذلك."
        );
      }

      await tx.warehouse.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});
