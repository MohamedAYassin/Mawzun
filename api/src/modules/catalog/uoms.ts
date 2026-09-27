import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

export const CreateUomSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "الكود مطلوب.")
    .max(30)
    .transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "الاسم مطلوب.").max(100),
  category: z.string().trim().max(60).default("general"),
  isActive: z.boolean().default(true),
});

export const UpdateUomSchema = CreateUomSchema.partial().strict();

const SELECT = {
  id: true,
  code: true,
  name: true,
  category: true,
  isActive: true,
  createdAt: true,
} as const;

async function assertCodeFree(
  tx: Db,
  companyId: string,
  code: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.uom.findFirst({
    where: { companyId, code, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("يوجد وحدة قياس بنفس الكود بالفعل.");
}

// Uom has no deletedAt: units are referenced by products and are toggled
// inactive rather than removed, so a product never loses its unit.
export const uomRoutes = defineResource({
  entity: "Uom",
  unpaginated: true,
  createSchema: CreateUomSchema,
  updateSchema: UpdateUomSchema,
  view: [Permissions.ViewUoms, Permissions.ViewProducts],
  manage: [Permissions.ManageUoms],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput) {
      const where = {
        companyId,
        ...searchFilter(["code", "name"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.uom.findMany({
        where,
        orderBy: orderBy(input, ["name", "code", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.uom.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.uom.findFirst({ where: { id, companyId }, select: SELECT });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateUomSchema>) {
      await assertCodeFree(tx, companyId, data.code);
      return tx.uom.create({
        data: { companyId, ...data },
        select: SELECT,
      });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateUomSchema>) {
      const existing = await tx.uom.findFirst({ where: { id, companyId }, select: { id: true } });
      if (!existing) throw new NotFoundError("وحدة القياس غير موجودة.");

      if (data.code) await assertCodeFree(tx, companyId, data.code, id);

      return tx.uom.update({ where: { id }, data, select: SELECT });
    },

    /**
     * Inactivates instead of deleting when anything still uses the unit — a
     * product's unit is part of how its quantity is read, so removing the row
     * would silently reinterpret historical stock.
     */
    async remove(tx: Db, _companyId: string, id: string) {
      const inUse = await tx.product.count({ where: { uomId: id, deletedAt: null } });
      if (inUse > 0) {
        throw new BadRequestError(
          "لا يمكن حذف الوحدة لأنها مستخدمة في منتجات. يمكنك تعطيلها بدلاً من ذلك."
        );
      }
      await tx.uom.delete({ where: { id } });
    },
  },
});
