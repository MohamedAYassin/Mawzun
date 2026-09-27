import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";
import { slugifyOrFallback } from "../../utils/slug.js";

export const CreateBrandSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  description: z.string().trim().max(1000).nullish(),
  logoUrl: z.string().trim().max(2000).nullish(),
  isActive: z.boolean().default(true),
});

export const UpdateBrandSchema = CreateBrandSchema.partial().strict();

const SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUrl: true,
  isActive: true,
  createdAt: true,
  _count: { select: { products: true } },
} as const;

async function assertNameFree(
  tx: Db,
  companyId: string,
  name: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.brand.findFirst({
    where: { companyId, name, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("يوجد ماركة بنفس الاسم بالفعل.");
}

export const brandRoutes = defineResource({
  entity: "Brand",
  createSchema: CreateBrandSchema,
  updateSchema: UpdateBrandSchema,
  view: [Permissions.ViewBrands, Permissions.ViewProducts],
  manage: [Permissions.CreateBrand, Permissions.UpdateBrand, Permissions.DeleteBrand],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["name", "description"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.brand.findMany({
        where,
        orderBy: orderBy(input, ["name", "createdAt"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.brand.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.brand.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateBrandSchema>) {
      await assertNameFree(tx, companyId, data.name);
      return tx.brand.create({
        data: {
          companyId,
          name: data.name,
          slug: slugifyOrFallback(data.name, "brand"),
          description: data.description ?? null,
          logoUrl: data.logoUrl ?? null,
          isActive: data.isActive,
        },
        select: SELECT,
      });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateBrandSchema>) {
      const existing = await tx.brand.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("الماركة غير موجودة.");

      if (data.name) await assertNameFree(tx, companyId, data.name, id);

      return tx.brand.update({
        where: { id },
        data: {
          name: data.name,
          slug: data.name ? slugifyOrFallback(data.name, "brand") : undefined,
          description: data.description,
          logoUrl: data.logoUrl,
          isActive: data.isActive,
        },
        select: SELECT,
      });
    },

    async remove(tx: Db, _companyId: string, id: string) {
      // Soft delete: products keep their brand reference so historical orders
      // still render correctly.
      await tx.brand.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});
