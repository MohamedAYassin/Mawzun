import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { mergeRelations } from "../../shared/relations.js";
import { route } from "../../shared/route.js";
import { defaultStorageLocation } from "../inventory/stockEngine.js";
import { applyMovementWithAlerts } from "../inventory/movementWithAlerts.js";

// ---------------------------------------------------------------------------
// Manufacturing
// ---------------------------------------------------------------------------
//
// A production batch is a run that makes goods the company does not have in
// stock but has already sold. That is why batches are built from orders: you
// pick the orders that are short, and the required quantities are aggregated
// from their lines. The batch is then worked through, and recording output
// books the finished goods into stock.
//
// There is no bill of materials here. The app has never modelled one, and
// inventing a half-baked version would be worse than being explicit: a batch
// names what it produces, not what it consumes. Components are issued through
// a stock operation with the PRODUCTION_OUT type.

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const manualItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر."),
  unitCost: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(500).nullish(),
});

export const CreateProductionBatchSchema = z.object({
  notes: z.string().trim().max(1000).default(""),
  startDate: z.coerce.date().nullish(),
  /** Orders this run should cover. Their lines are aggregated into the batch. */
  orderIds: z.array(z.string().min(1)).max(500).default([]),
  /** Explicit lines, for a run that is not tied to specific orders. */
  items: z.array(manualItemSchema).max(500).default([]),
});

export const UpdateProductionBatchSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
  startDate: z.coerce.date().nullish(),
  status: z.enum(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  orderIds: z.array(z.string().min(1)).max(500).optional(),
  items: z.array(manualItemSchema).max(500).optional(),
});

/** Recording output: how much of each line actually came off the line. */
export const ProduceItemsSchema = z.object({
  storageLocationId: z.string().trim().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().positive("الكمية المنتجة يجب أن تكون أكبر من صفر."),
      })
    )
    .min(1, "يجب تحديد صنف واحد على الأقل."),
});

export const ProductionBatchFilterSchema = z.object({
  status: z
    .enum(["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"])
    .optional(),
});

const ITEM_SELECT = {
  id: true,
  quantity: true,
  producedQuantity: true,
  unitCost: true,
  notes: true,
  product: { select: { id: true, name: true, skuCode: true } },
} as const;

const LIST_SCALARS = {
  id: true,
  batchNumber: true,
  status: true,
  notes: true,
  startDate: true,
  completionDate: true,
  cancelledAt: true,
  createdAt: true,
} as const;

// Scalars only. The relations below are loaded one query at a time by
// loadBatchDetail() — `items` and `orders` together are two relation loads,
// which Prisma issues CONCURRENTLY on whatever client it is given. On a
// transaction client that is two statements racing one connection: pg warns
// today and rejects on pg 9. See src/shared/relations.ts.
const DETAIL_SCALARS = {
  ...LIST_SCALARS,
  updatedAt: true,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Allocates the next batch number from the company's own counter.
 *
 * The legacy code used `count() + 1`, which collides as soon as two batches
 * are created at once and produces duplicate numbers after any deletion.
 */
async function nextBatchNumber(tx: Db, companyId: string): Promise<string> {
  const settings = await tx.companySettings.upsert({
    where: { companyId },
    create: { companyId, productionBatchPrefix: "BATCH", productionNextNumber: 2 },
    update: { productionNextNumber: { increment: 1 } },
    select: { productionBatchPrefix: true, productionNextNumber: true },
  });
  const sequence = settings.productionNextNumber - 1;
  return `${settings.productionBatchPrefix}-${String(sequence).padStart(7, "0")}`;
}

/**
 * Loads one batch with its relations.
 *
 * Relations are fetched one query at a time (mergeRelations) rather than in a
 * single select. Prisma issues one statement per relation CONCURRENTLY on
 * whatever client it is handed; on this transaction client that races the
 * connection. Round-trips are identical either way — only the overlap is gone.
 */
type BatchItemRow = {
  id: string;
  quantity: unknown;
  producedQuantity: unknown;
  unitCost: unknown;
  notes: string | null;
  product: { id: string; name: string; skuCode: string };
};

type BatchOrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  hasShortage: boolean;
  createdAt: Date;
  customer: { id: string; name: string; phoneNumber1: string } | null;
  _count: { items: number };
};

type BatchRelations = {
  _count: { items: number; orders: number };
  items: BatchItemRow[];
  orders: BatchOrderRow[];
};

async function loadBatchDetail<T extends { id: string }>(tx: Db, rows: T[]): Promise<Array<T & BatchRelations>> {
  const [merged] = await mergeRelations<T, BatchRelations>(tx, rows, [
    (ids) => tx.productionBatch.findMany({ where: { id: { in: ids } }, select: { id: true, _count: { select: { items: true, orders: true } } } }),
    (ids) => tx.productionBatch.findMany({ where: { id: { in: ids } }, select: { id: true, items: { select: ITEM_SELECT } } }),
    (ids) =>
      tx.productionBatch.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          orders: {
            select: {
              id: true,
              orderNumber: true,
              status: true,
              hasShortage: true,
              createdAt: true,
              customer: { select: { id: true, name: true, phoneNumber1: true } },
              _count: { select: { items: true } },
            },
          },
        },
      }),
  ]);
  return [merged];
}

async function loadBatch(tx: Db, companyId: string, id: string) {
  const batch = await tx.productionBatch.findFirst({
    where: { id, companyId, deletedAt: null },
    select: DETAIL_SCALARS,
  });
  if (!batch) throw new NotFoundError("دفعة الإنتاج غير موجودة.");
  const [hydrated] = await loadBatchDetail(tx, [batch]);
  return hydrated;
}

/**
 * Sums the order lines that need making into per-product required quantities.
 *
 * Only lines flagged `needsManufacturing` count — a batch exists to cover a
 * shortfall, and pulling in every line would over-produce anything already
 * on the shelf.
 */
async function aggregateOrderLines(
  tx: Db,
  companyId: string,
  orderIds: string[]
): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();

  const lines = await tx.orderItem.findMany({
    where: { orderId: { in: orderIds }, companyId, needsManufacturing: true },
    select: { productId: true, quantity: true },
  });

  const totals = new Map<string, number>();
  for (const line of lines) {
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + Number(line.quantity));
  }
  return totals;
}

/** Verifies every id belongs to this company before it is written. */
async function assertCompanyProducts(tx: Db, companyId: string, productIds: string[]) {
  if (productIds.length === 0) return;
  const found = await tx.product.count({
    where: { id: { in: productIds }, companyId, deletedAt: null },
  });
  if (found !== productIds.length) {
    throw new BadRequestError("أحد المنتجات غير موجود في هذه الشركة.");
  }
}

/**
 * Rebuilds the batch's lines from its linked orders.
 *
 * Produced quantities are carried across by product, because re-linking orders
 * to a batch that is already part-built must not erase what has been made. The
 * `overrides` map lets a caller raise the produced figure at the same time.
 */
async function syncItemsFromOrders(
  tx: Db,
  companyId: string,
  batch: {
    id: string;
    items: readonly { product: { id: string }; producedQuantity: unknown; unitCost: unknown }[];
  },
  orderIds: string[],
  overrides?: Map<string, number>
) {
  const required = await aggregateOrderLines(tx, companyId, orderIds);

  const previous = new Map(
    batch.items.map((item) => [
      item.product.id,
      { produced: Number(item.producedQuantity), unitCost: Number(item.unitCost) },
    ])
  );

  await assertCompanyProducts(tx, companyId, [...required.keys()]);

  await tx.productionBatchItem.deleteMany({ where: { productionBatchId: batch.id } });

  if (required.size === 0) return;

  await tx.productionBatchItem.createMany({
    data: [...required.entries()].map(([productId, quantity]) => {
      const carried = previous.get(productId);
      const overrideValue = overrides?.get(productId);
      return {
        companyId,
        productionBatchId: batch.id,
        productId,
        quantity,
        producedQuantity: overrideValue ?? carried?.produced ?? 0,
        unitCost: carried?.unitCost ?? 0,
      };
    }),
  });
}

/** Links the given orders to the batch and unlinks everything else. */
async function syncOrders(tx: Db, companyId: string, batchId: string, orderIds: string[]) {
  await tx.order.updateMany({
    where: { companyId, productionBatchId: batchId, id: { notIn: orderIds } },
    data: { productionBatchId: null },
  });

  if (orderIds.length === 0) return;

  const matched = await tx.order.count({
    where: { id: { in: orderIds }, companyId, deletedAt: null },
  });
  if (matched !== orderIds.length) {
    throw new BadRequestError("أحد الطلبات غير موجود في هذه الشركة.");
  }

  await tx.order.updateMany({
    where: { id: { in: orderIds }, companyId },
    data: { productionBatchId: batchId },
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewProductionBatches),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = ProductionBatchFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...searchFilter(["batchNumber", "notes"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.productionBatch.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "batchNumber", "status"], "createdAt"),
        ...pageSlice(input),
        select: LIST_SCALARS,
      });
      const total = await tx.productionBatch.count({ where });
      // The list shows _count only; load it one query at a time rather than
      // letting Prisma fire it alongside the page query on this transaction.
      const withCounts = await mergeRelations<
        (typeof items)[number],
        { _count: { items: number; orders: number } }
      >(tx, items, [
        (ids) => tx.productionBatch.findMany({ where: { id: { in: ids } }, select: { id: true, _count: { select: { items: true, orders: true } } } }),
      ]);
      return toPage(withCounts, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewProductionBatches),
  route(async (req: AuthedRequest) =>
    scoped(req, (tx) => loadBatch(tx, req.ctx.companyId!, param(req, "id")))
  )
);

router.post(
  "/",
  requirePermission(Permissions.CreateProductionBatch),
  route(
    async (req: AuthedRequest) => {
      const data = CreateProductionBatchSchema.parse(req.body);
      if (data.orderIds.length === 0 && data.items.length === 0) {
        throw new BadRequestError("يجب تحديد طلبات أو أصناف لدفعة الإنتاج.");
      }

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        const productIds = [...new Set(data.items.map((i) => i.productId))];
        await assertCompanyProducts(tx, companyId, productIds);

        const created = await tx.productionBatch.create({
          data: {
            companyId,
            batchNumber: await nextBatchNumber(tx, companyId),
            notes: data.notes,
            startDate: data.startDate ?? null,
            status: "PLANNED",
          },
          select: { id: true, companyId: true, items: { select: ITEM_SELECT } },
        });

        await syncOrders(tx, companyId, created.id, data.orderIds);

        if (data.orderIds.length > 0) {
          await syncItemsFromOrders(tx, companyId, created, data.orderIds);
        } else {
          await tx.productionBatchItem.createMany({
            data: data.items.map((item) => ({
              companyId,
              productionBatchId: created.id,
              productId: item.productId,
              quantity: item.quantity,
              unitCost: item.unitCost,
              notes: item.notes ?? null,
            })),
          });
        }

        const batch = await loadBatch(tx, companyId, created.id);

        await audit(tx, {
          action: "productionBatch.created",
          entity: "ProductionBatch",
          entityId: created.id,
          summary: `تم إنشاء دفعة الإنتاج ${batch.batchNumber}.`,
        });

        return batch;
      });
    },
    { status: 201, message: "تم إنشاء دفعة الإنتاج بنجاح." }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.UpdateProductionBatch),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = UpdateProductionBatchSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        const batch = await loadBatch(tx, companyId, id);

        if (batch.status === "COMPLETED" || batch.status === "CANCELLED") {
          throw new ConflictError("لا يمكن تعديل دفعة مكتملة أو ملغاة.");
        }

        if (data.items) {
          const productIds = [...new Set(data.items.map((i) => i.productId))];
          await assertCompanyProducts(tx, companyId, productIds);

          await tx.productionBatchItem.deleteMany({ where: { productionBatchId: id } });
          if (data.items.length > 0) {
            await tx.productionBatchItem.createMany({
              data: data.items.map((item) => ({
                companyId,
                productionBatchId: id,
                productId: item.productId,
                quantity: item.quantity,
                unitCost: item.unitCost,
                notes: item.notes ?? null,
              })),
            });
          }
        } else if (data.orderIds) {
          await syncOrders(tx, companyId, id, data.orderIds);
          await syncItemsFromOrders(tx, companyId, batch, data.orderIds);
        }

        const nextStatus = data.status ?? batch.status;

        const updated = await tx.productionBatch.update({
          where: { id },
          data: {
            notes: data.notes,
            startDate: data.startDate,
            status: nextStatus,
            completionDate:
              nextStatus === "COMPLETED" && !batch.completionDate ? new Date() : undefined,
            cancelledAt:
              nextStatus === "CANCELLED" && !batch.cancelledAt ? new Date() : undefined,
          },
          select: DETAIL_SCALARS,
        });
        const [updatedHydrated] = await loadBatchDetail(tx, [updated]);

        await audit(tx, {
          action: "productionBatch.updated",
          entity: "ProductionBatch",
          entityId: id,
          summary: `تم تحديث دفعة الإنتاج ${updated.batchNumber}.`,
          changes: data,
        });

        return updatedHydrated;
      });
    },
    { message: "تم تحديث دفعة الإنتاج بنجاح." }
  )
);

/** PLANNED/DRAFT -> IN_PROGRESS. */
router.post(
  "/:id/start",
  requirePermission(Permissions.UpdateProductionBatch),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const batch = await loadBatch(tx, req.ctx.companyId!, id);

      if (batch.status !== "PLANNED" && batch.status !== "DRAFT") {
        throw new ConflictError("لا يمكن بدء دفعة غير مخططة.");
      }

      const updated = await tx.productionBatch.update({
        where: { id },
        data: { status: "IN_PROGRESS", startDate: batch.startDate ?? new Date() },
        select: DETAIL_SCALARS,
      });
      const [updatedHydrated] = await loadBatchDetail(tx, [updated]);

      await audit(tx, {
        action: "productionBatch.started",
        entity: "ProductionBatch",
        entityId: id,
        summary: `تم بدء تصنيع ${updated.batchNumber}.`,
      });

      return updatedHydrated;
    })
  )
);

/**
 * Books finished goods into stock.
 *
 * Output is recorded incrementally: a line can be produced in several goes,
 * and each go writes its own movement so the ledger shows when the goods
 * actually arrived rather than one lumped entry at the end.
 */
router.post(
  "/:id/produce",
  requirePermission(Permissions.UpdateProductionBatch),
  route(async (req: AuthedRequest) => {
    const id = param(req, "id");
    const data = ProduceItemsSchema.parse(req.body);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const batch = await loadBatch(tx, companyId, id);

      if (batch.status === "CANCELLED") {
        throw new ConflictError("لا يمكن التصنيع في دفعة ملغاة.");
      }
      if (batch.status === "DRAFT" || batch.status === "PLANNED") {
        await tx.productionBatch.update({
          where: { id },
          data: { status: "IN_PROGRESS", startDate: batch.startDate ?? new Date() },
        });
      }

      const locationId =
        data.storageLocationId ?? (await defaultStorageLocation(tx, companyId));
      if (!locationId) {
        throw new BadRequestError("لا يوجد موقع تخزين افتراضي لإيداع الإنتاج.");
      }

      if (data.storageLocationId) {
        const owned = await tx.storageLocation.count({
          where: { id: locationId, companyId, deletedAt: null },
        });
        if (owned === 0) throw new BadRequestError("موقع التخزين غير موجود في هذه الشركة.");
      }

      const requested = new Map(data.items.map((item) => [item.productId, item.quantity]));
      const ctx = { companyId, actorId: req.ctx.userId };

      for (const item of batch.items) {
        const quantity = requested.get(item.product.id);
        if (!quantity) continue;

        const outstanding = Number(item.quantity) - Number(item.producedQuantity);
        if (quantity > outstanding) {
          throw new BadRequestError(
            `الكمية المنتجة من "${item.product.name}" تتجاوز المتبقي (${outstanding}).`
          );
        }

        await applyMovementWithAlerts(tx, ctx, {
          productId: item.product.id,
          storageLocationId: locationId,
          quantity,
          type: "PRODUCTION_IN",
          unitCost: Number(item.unitCost),
          reason: `إنتاج من الدفعة ${batch.batchNumber}`,
          referenceType: "ProductionBatch",
          referenceId: batch.id,
          referenceNumber: batch.batchNumber,
        });

        await tx.productionBatchItem.update({
          where: { id: item.id },
          data: { producedQuantity: { increment: quantity } },
        });
      }

      const updated = await tx.productionBatch.update({
        where: { id },
        data: { status: "IN_PROGRESS" },
        select: DETAIL_SCALARS,
      });
      const [updatedHydrated] = await loadBatchDetail(tx, [updated]);

      await audit(tx, {
        action: "productionBatch.produced",
        entity: "ProductionBatch",
        entityId: id,
        summary: `تم تسجيل إنتاج ${data.items.length} صنف في ${batch.batchNumber}.`,
        changes: { items: data.items },
      });

      return updatedHydrated;
    });
  })
);

/** IN_PROGRESS -> COMPLETED, once every line has been produced in full. */
router.post(
  "/:id/complete",
  requirePermission(Permissions.UpdateProductionBatch),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const batch = await loadBatch(tx, req.ctx.companyId!, id);

      if (batch.status === "COMPLETED") throw new ConflictError("الدفعة مكتملة بالفعل.");
      if (batch.status === "CANCELLED") throw new ConflictError("لا يمكن إكمال دفعة ملغاة.");

      const short = batch.items.filter(
        (item) => Number(item.producedQuantity) < Number(item.quantity)
      );
      if (short.length > 0) {
        throw new ConflictError(
          `لم يكتمل إنتاج ${short.length} صنف بعد: ${short
            .map((item) => item.product.name)
            .join("، ")}.`
        );
      }

      const updated = await tx.productionBatch.update({
        where: { id },
        data: { status: "COMPLETED", completionDate: new Date() },
        select: DETAIL_SCALARS,
      });
      const [updatedHydrated] = await loadBatchDetail(tx, [updated]);

      await audit(tx, {
        action: "productionBatch.completed",
        entity: "ProductionBatch",
        entityId: id,
        summary: `تم إكمال دفعة الإنتاج ${updated.batchNumber}.`,
      });

      return updatedHydrated;
    })
  )
);

router.post(
  "/:id/cancel",
  requirePermission(Permissions.UpdateProductionBatch),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const batch = await loadBatch(tx, req.ctx.companyId!, id);

      if (batch.status === "COMPLETED") throw new ConflictError("لا يمكن إلغاء دفعة مكتملة.");
      if (batch.status === "CANCELLED") throw new ConflictError("الدفعة ملغاة بالفعل.");

      // Cancelling must let the orders be re-planned into another batch.
      await tx.order.updateMany({
        where: { productionBatchId: id, companyId: req.ctx.companyId! },
        data: { productionBatchId: null },
      });

      const updated = await tx.productionBatch.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
        select: DETAIL_SCALARS,
      });
      const [updatedHydrated] = await loadBatchDetail(tx, [updated]);

      await audit(tx, {
        action: "productionBatch.cancelled",
        entity: "ProductionBatch",
        entityId: id,
        summary: `تم إلغاء دفعة الإنتاج ${updated.batchNumber}.`,
      });

      return updatedHydrated;
    })
  )
);

router.delete(
  "/:id",
  requirePermission(Permissions.DeleteProductionBatch),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const companyId = req.ctx.companyId!;
      const batch = await loadBatch(tx, companyId, id);

      if (batch.status === "COMPLETED") {
        throw new ConflictError("لا يمكن حذف دفعة مكتملة لأن إنتاجها مسجل في حركة المخزون.");
      }
      if (batch.items.some((item) => Number(item.producedQuantity) > 0)) {
        throw new ConflictError("لا يمكن حذف دفعة تم تسجيل إنتاج فيها.");
      }

      await tx.order.updateMany({
        where: { productionBatchId: id, companyId },
        data: { productionBatchId: null },
      });
      await tx.productionBatch.update({ where: { id }, data: { deletedAt: new Date() } });

      await audit(tx, {
        action: "productionBatch.deleted",
        entity: "ProductionBatch",
        entityId: id,
        summary: `تم حذف دفعة الإنتاج ${batch.batchNumber}.`,
      });

      return null;
    })
  )
);

export { router as productionBatchRoutes };
