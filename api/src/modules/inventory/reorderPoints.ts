import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { BadRequestError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

// Reorder points are keyed (product, warehouse): one rule per product per
// warehouse, because the same product can run out at different rates in
// different places.

const ReorderPointLevels = z.object({
  productId: z.string().min(1, "المنتج مطلوب."),
  warehouseId: z.string().min(1, "المستودع مطلوب."),
  minStockLevel: z.coerce.number().min(0).default(0),
  maxStockLevel: z.coerce.number().min(0).default(0),
  reorderQuantity: z.coerce.number().min(0).default(0),
});

export const CreateReorderPointSchema = ReorderPointLevels.refine(
  (v) => v.maxStockLevel >= v.minStockLevel,
  { message: "الحد الأقصى يجب ألا يقل عن الحد الأدنى.", path: ["maxStockLevel"] }
);

export const UpdateReorderPointSchema = ReorderPointLevels.partial()
  .omit({ productId: true, warehouseId: true })
  .strict()
  .refine(
    (v) =>
      v.minStockLevel === undefined ||
      v.maxStockLevel === undefined ||
      v.maxStockLevel >= v.minStockLevel,
    { message: "الحد الأقصى يجب ألا يقل عن الحد الأدنى.", path: ["maxStockLevel"] }
  );

export const ReorderPointFilterSchema = z.object({
  productId: z.string().trim().min(1).optional(),
  warehouseId: z.string().trim().min(1).optional(),
});

const SELECT = {
  id: true,
  minStockLevel: true,
  maxStockLevel: true,
  reorderQuantity: true,
  product: { select: { id: true, name: true, skuCode: true } },
  warehouse: { select: { id: true, name: true } },
} as const;

async function requireRows(
  tx: Db,
  companyId: string,
  productId: string,
  warehouseId: string
): Promise<void> {
  // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
  const product = await tx.product.count({ where: { id: productId, companyId, deletedAt: null } });
  const warehouse = await tx.warehouse.count({ where: { id: warehouseId, companyId, deletedAt: null } });
  if (product === 0) throw new BadRequestError("المنتج غير موجود.");
  if (warehouse === 0) throw new BadRequestError("المستودع غير موجود.");
}

export const reorderPointRoutes = defineResource({
  entity: "ReorderPoint",
  unpaginated: true,
  createSchema: CreateReorderPointSchema,
  updateSchema: UpdateReorderPointSchema,
  filterSchema: ReorderPointFilterSchema,
  view: [Permissions.ViewInventory],
  manage: [Permissions.ManageInventory],
  handlers: {
    async list(
      tx: Db,
      companyId: string,
      input: PaginationInput,
      filter: z.infer<typeof ReorderPointFilterSchema>
    ) {
      const where = {
        companyId,
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...searchFilter(["product.name", "product.skuCode"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.reorderPoint.findMany({
        where,
        orderBy: orderBy(input, ["minStockLevel"], "minStockLevel"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.reorderPoint.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.reorderPoint.findFirst({ where: { id, companyId }, select: SELECT });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateReorderPointSchema>) {
      await requireRows(tx, companyId, data.productId, data.warehouseId);

      return tx.reorderPoint.upsert({
        where: {
          productId_warehouseId: { productId: data.productId, warehouseId: data.warehouseId },
        },
        create: { companyId, ...data },
        update: {
          minStockLevel: data.minStockLevel,
          maxStockLevel: data.maxStockLevel,
          reorderQuantity: data.reorderQuantity,
        },
        select: SELECT,
      });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateReorderPointSchema>) {
      const existing = await tx.reorderPoint.findFirst({ where: { id, companyId }, select: { id: true } });
      if (!existing) throw new NotFoundError("قاعدة إعادة الطلب غير موجودة.");

      return tx.reorderPoint.update({
        where: { id },
        data: {
          minStockLevel: data.minStockLevel,
          maxStockLevel: data.maxStockLevel,
          reorderQuantity: data.reorderQuantity,
        },
        select: SELECT,
      });
    },

    async remove(tx: Db, _companyId: string, id: string) {
      await tx.reorderPoint.delete({ where: { id } });
    },
  },
});
