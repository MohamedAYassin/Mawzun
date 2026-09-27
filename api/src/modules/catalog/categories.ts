import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";
import { slugifyOrFallback } from "../../utils/slug.js";

export const CreateCategorySchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  description: z.string().trim().max(1000).nullish(),
  imageUrl: z.string().trim().max(2000).nullish(),
  parentId: z.string().nullish(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export const UpdateCategorySchema = CreateCategorySchema.partial().strict();

const SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  parentId: true,
  isActive: true,
  sortOrder: true,
  createdAt: true,
  _count: { select: { products: true, children: true } },
} as const;

async function assertNameFree(
  tx: Db,
  companyId: string,
  name: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.category.findFirst({
    where: { companyId, name, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("يوجد تصنيف بنفس الاسم بالفعل.");
}

/**
 * Guards the tree. A category cannot be its own parent, and it cannot be moved
 * under one of its own descendants — either would detach the subtree from the
 * root and make it unreachable.
 */
async function assertNoCycle(tx: Db, id: string, parentId: string): Promise<void> {
  if (id === parentId) {
    throw new BadRequestError("لا يمكن أن يكون التصنيف أباً لنفسه.");
  }

  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 100; depth += 1) {
    if (cursor === id) {
      throw new BadRequestError("لا يمكن نقل التصنيف إلى أحد فروعه.");
    }
    const parent: { parentId: string | null } | null = await tx.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = parent?.parentId ?? null;
  }
}

export const categoryRoutes = defineResource({
  entity: "Category",
  createSchema: CreateCategorySchema,
  updateSchema: UpdateCategorySchema,
  view: [Permissions.ViewCategories, Permissions.ViewProducts],
  manage: [Permissions.CreateCategory, Permissions.UpdateCategory, Permissions.DeleteCategory],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["name", "description"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.category.findMany({
        where,
        orderBy: orderBy(input, ["name", "sortOrder", "createdAt"], "sortOrder"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.category.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.category.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateCategorySchema>) {
      await assertNameFree(tx, companyId, data.name);
      if (data.parentId) await assertNoCycle(tx, "", data.parentId);

      return tx.category.create({
        data: {
          companyId,
          name: data.name,
          slug: slugifyOrFallback(data.name, "category"),
          description: data.description ?? null,
          imageUrl: data.imageUrl ?? null,
          parentId: data.parentId ?? null,
          isActive: data.isActive,
          sortOrder: data.sortOrder,
        },
        select: SELECT,
      });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateCategorySchema>) {
      const existing = await tx.category.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("التصنيف غير موجود.");

      if (data.name) await assertNameFree(tx, companyId, data.name, id);
      if (data.parentId) await assertNoCycle(tx, id, data.parentId);

      return tx.category.update({
        where: { id },
        data: {
          name: data.name,
          slug: data.name ? slugifyOrFallback(data.name, "category") : undefined,
          description: data.description,
          imageUrl: data.imageUrl,
          parentId: data.parentId,
          isActive: data.isActive,
          sortOrder: data.sortOrder,
        },
        select: SELECT,
      });
    },

    /**
     * Refuses to delete a category that still has children or products.
     *
     * `parentId` is `onDelete: Restrict`, so the database would block it too —
     * but orphaning products is worse than refusing, and the message needs to
     * say which of the two is in the way.
     */
    async remove(tx: Db, _companyId: string, id: string) {
      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const children = await tx.category.count({ where: { parentId: id, deletedAt: null } });
      const products = await tx.product.count({ where: { categoryId: id, deletedAt: null } });

      if (children > 0) {
        throw new BadRequestError("لا يمكن حذف تصنيف يحتوي على تصنيفات فرعية.");
      }
      if (products > 0) {
        throw new BadRequestError("لا يمكن حذف تصنيف مرتبط بمنتجات.");
      }

      await tx.category.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});

