import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

export const CreateTaxRateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(100),
  percentage: z.coerce.number().min(0, "النسبة لا يمكن أن تكون سالبة.").max(100),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const UpdateTaxRateSchema = CreateTaxRateSchema.partial().strict();

const SELECT = {
  id: true,
  name: true,
  percentage: true,
  isDefault: true,
  isActive: true,
  createdAt: true,
} as const;

async function assertNameFree(
  tx: Db,
  companyId: string,
  name: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.taxRate.findFirst({
    where: { companyId, name, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("يوجد معدل ضريبة بنفس الاسم بالفعل.");
}

/**
 * Only one rate can be the default, so promoting one clears the others in the
 * same transaction. Doing it here rather than in the UI means the invariant
 * holds no matter which client writes.
 */
async function applyDefault(tx: Db, companyId: string, id: string): Promise<void> {
  await tx.taxRate.updateMany({
    where: { companyId, isDefault: true, id: { not: id } },
    data: { isDefault: false },
  });
}

export const taxRateRoutes = defineResource({
  entity: "TaxRate",
  unpaginated: true,
  createSchema: CreateTaxRateSchema,
  updateSchema: UpdateTaxRateSchema,
  view: [Permissions.ViewProducts],
  manage: [Permissions.UpdateProduct, Permissions.ManageSettings],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["name"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.taxRate.findMany({
        where,
        orderBy: orderBy(input, ["name", "percentage", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.taxRate.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.taxRate.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateTaxRateSchema>) {
      await assertNameFree(tx, companyId, data.name);

      const created = await tx.taxRate.create({
        data: { companyId, ...data },
        select: SELECT,
      });
      if (data.isDefault) await applyDefault(tx, companyId, created.id);
      return created;
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateTaxRateSchema>) {
      const existing = await tx.taxRate.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("معدل الضريبة غير موجود.");

      if (data.name) await assertNameFree(tx, companyId, data.name, id);

      const updated = await tx.taxRate.update({ where: { id }, data, select: SELECT });
      if (data.isDefault) await applyDefault(tx, companyId, id);
      return updated;
    },

    async remove(tx: Db, _companyId: string, id: string) {
      await tx.taxRate.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});
