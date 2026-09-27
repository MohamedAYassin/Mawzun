import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";
import { slugifyOrFallback } from "../../utils/slug.js";

export const CreateAttributeSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(150),
  code: z
    .string()
    .trim()
    .min(1, "الكود مطلوب.")
    .max(100)
    .transform((v) => slugifyOrFallback(v, "attr")),
  type: z.enum(["TEXT", "SELECT", "COLOR"]).default("SELECT"),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const UpdateAttributeSchema = CreateAttributeSchema.partial().strict();

const SELECT = {
  id: true,
  name: true,
  code: true,
  type: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  _count: { select: { values: true } },
} as const;

async function assertCodeFree(
  tx: Db,
  companyId: string,
  code: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.productAttribute.findFirst({
    where: { companyId, code, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("توجد خاصية بنفس الكود بالفعل.");
}

export const attributeRoutes = defineResource({
  entity: "ProductAttribute",
  unpaginated: true,
  createSchema: CreateAttributeSchema,
  updateSchema: UpdateAttributeSchema,
  view: [Permissions.ViewProducts],
  manage: [Permissions.CreateProduct, Permissions.UpdateProduct],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["name", "code"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.productAttribute.findMany({
        where,
        orderBy: orderBy(input, ["name", "sortOrder", "createdAt"], "sortOrder"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.productAttribute.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.productAttribute.findFirst({
        where: { id, companyId, deletedAt: null },
        select: SELECT,
      });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateAttributeSchema>) {
      await assertCodeFree(tx, companyId, data.code);
      return tx.productAttribute.create({
        data: { companyId, ...data },
        select: SELECT,
      });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateAttributeSchema>) {
      const existing = await tx.productAttribute.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("الخاصية غير موجودة.");

      if (data.code) await assertCodeFree(tx, companyId, data.code, id);

      return tx.productAttribute.update({ where: { id }, data, select: SELECT });
    },

    // Cascade removes the values; variants referencing them go through
    // ProductVariantAttribute, which cascades as well.
    async remove(tx: Db, _companyId: string, id: string) {
      await tx.productAttribute.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});
