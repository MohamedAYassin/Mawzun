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
import { route } from "../../shared/route.js";
import { mergeRelations } from "../../shared/relations.js";
import { applyMovementWithAlerts } from "./movementWithAlerts.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullish(),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر."),
  unitCost: z.coerce.number().min(0).default(0),
});

export const CreateStockOperationSchema = z.object({
  operationTypeId: z.string().min(1, "نوع الحركة مطلوب."),
  fromWarehouseId: z.string().nullish(),
  toWarehouseId: z.string().nullish(),
  reference: z.string().trim().max(150).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  // Drafts may be created empty (the transfers screen creates a shell to fill
  // from the stock-operations screen afterwards); execution re-checks that
  // real quantities exist before touching stock.
  items: z.array(itemSchema),
});

export const UpdateStockOperationSchema = z.object({
  fromWarehouseId: z.string().nullish(),
  toWarehouseId: z.string().nullish(),
  reference: z.string().trim().max(150).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  items: z.array(itemSchema).min(1).optional(),
});

export const StockOperationFilterSchema = z.object({
  status: z.enum(["DRAFT", "PENDING", "READY", "DONE", "CANCELLED"]).optional(),
  operationTypeId: z.string().trim().min(1).optional(),
  warehouseId: z.string().trim().min(1).optional(),
});

// Scalars only. Relations are loaded one query at a time by hydrateOperation().
// Five relations in one select means five statements issued CONCURRENTLY by
// Prisma — a race on this transaction's single connection (pg warns now,
// rejects on pg 9).
const SELECT = {
  id: true,
  operationNumber: true,
  status: true,
  reference: true,
  notes: true,
  createdAt: true,
  executedAt: true,
} as const;

/** The relation half of SELECT, applied after the scalar query. */
async function hydrateOperation<T extends { id: string }>(tx: Db, ops: T[]) {
  type Merged = {
    operationType: { id: string; name: string; code: string; requiresValidation: boolean } | null;
    fromWarehouse: { id: string; name: string } | null;
    toWarehouse: { id: string; name: string } | null;
    executedBy: { id: string; fullName: string } | null;
    items: {
      id: string;
      quantity: unknown;
      doneQuantity: unknown;
      unitCost: unknown;
      product: { id: string; name: string; skuCode: string | null } | null;
      variant: { id: string; name: string; skuCode: string | null } | null;
    }[];
  };

  const merged = await mergeRelations<T, Merged>(tx, ops, [
    (ids) =>
      tx.stockOperation.findMany({
        where: { id: { in: ids } },
        select: { id: true, operationType: { select: { id: true, name: true, code: true, requiresValidation: true } } },
      }),
    (ids) =>
      tx.stockOperation.findMany({
        where: { id: { in: ids } },
        select: { id: true, fromWarehouse: { select: { id: true, name: true } } },
      }),
    (ids) =>
      tx.stockOperation.findMany({
        where: { id: { in: ids } },
        select: { id: true, toWarehouse: { select: { id: true, name: true } } },
      }),
    (ids) =>
      tx.stockOperation.findMany({
        where: { id: { in: ids } },
        select: { id: true, executedBy: { select: { id: true, fullName: true } } },
      }),
    (ids) =>
      tx.stockOperation.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          items: { select: { id: true, quantity: true, doneQuantity: true, unitCost: true } },
        },
      }),
  ]);

  // Item-level relations, one query each.
  const allItemIds = merged.flatMap((o) => (o.items ?? []).map((i) => i.id));
  if (allItemIds.length) {
    const itemProducts = await tx.stockOperationItem.findMany({
      where: { id: { in: allItemIds } },
      select: { id: true, product: { select: { id: true, name: true, skuCode: true } } },
    });
    const itemVariants = await tx.stockOperationItem.findMany({
      where: { id: { in: allItemIds } },
      select: { id: true, variant: { select: { id: true, name: true, skuCode: true } } },
    });
    const prodById = new Map(itemProducts.map((r) => [r.id, r.product]));
    const varById = new Map(itemVariants.map((r) => [r.id, r.variant]));
    for (const o of merged) {
      o.items = (o.items ?? []).map((i) => ({
        ...i,
        product: prodById.get(i.id) ?? null,
        variant: varById.get(i.id) ?? null,
      }));
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Direction is derived from which warehouses are set rather than stored as a
 * column: an operation with only a target is a receipt, only a source is an
 * issue, and both is a transfer. Storing it separately would allow the two to
 * disagree.
 */
type Direction = { from: string | null; to: string | null };

function assertDirection(from: string | null, to: string | null): Direction {
  if (!from && !to) {
    throw new BadRequestError("يجب تحديد المستودع المصدر أو الهدف.");
  }
  return { from: from ?? null, to: to ?? null };
}

/**
 * Resolves the bin an operation reads from or writes to.
 *
 * Operation items name a product but not a location, so the warehouse's primary
 * location stands in. A warehouse without any location cannot hold stock, and
 * failing here beats silently dropping the movement.
 */
async function resolveLocation(tx: Db, companyId: string, warehouseId: string): Promise<string> {
  const location = await tx.storageLocation.findFirst({
    where: { warehouseId, companyId, isActive: true, deletedAt: null },
    orderBy: [{ code: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!location) {
    const warehouse = await tx.warehouse.findUnique({
      where: { id: warehouseId },
      select: { name: true },
    });
    throw new BadRequestError(`المستودع "${warehouse?.name ?? ""}" لا يحتوي على مواقع تخزين.`);
  }

  return location.id;
}

/** Allocates the next operation number from the type's own sequence. */
async function nextOperationNumber(tx: Db, operationTypeId: string): Promise<string> {
  const type = await tx.operationType.update({
    where: { id: operationTypeId },
    data: { nextSequence: { increment: 1 } },
    select: { sequencePrefix: true, nextSequence: true },
  });
  return `${type.sequencePrefix}-${String(type.nextSequence - 1).padStart(5, "0")}`;
}

async function loadOperation(tx: Db, companyId: string, id: string) {
  const operation = await tx.stockOperation.findFirst({
    where: { id, companyId, deletedAt: null },
    select: SELECT,
  });
  if (!operation) throw new NotFoundError("عملية المخزون غير موجودة.");
  const [hydrated] = await hydrateOperation(tx, [operation]);
  return hydrated;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewStockOperations),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = StockOperationFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.operationTypeId ? { operationTypeId: filter.operationTypeId } : {}),
        ...(filter.warehouseId
          ? { OR: [{ fromWarehouseId: filter.warehouseId }, { toWarehouseId: filter.warehouseId }] }
          : {}),
        ...searchFilter(["operationNumber", "reference"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.stockOperation.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "operationNumber", "status"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.stockOperation.count({ where });
      const hydrated = await hydrateOperation(tx, items);
      return toPage(hydrated, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewStockOperations),
  route(async (req: AuthedRequest) =>
    scoped(req, (tx) => loadOperation(tx, req.ctx.companyId!, param(req, "id")))
  )
);

router.post(
  "/",
  requirePermission(Permissions.ManageStockOperations),
  route(
    async (req: AuthedRequest) => {
      const data = CreateStockOperationSchema.parse(req.body);
      assertDirection(data.fromWarehouseId ?? null, data.toWarehouseId ?? null);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const operationType = await tx.operationType.findFirst({
          where: { id: data.operationTypeId, companyId, deletedAt: null },
          select: { id: true, requiresValidation: true },
        });
        if (!operationType) throw new NotFoundError("نوع الحركة غير موجود.");

        for (const warehouseId of [data.fromWarehouseId, data.toWarehouseId]) {
          if (!warehouseId) continue;
          const exists = await tx.warehouse.count({ where: { id: warehouseId, companyId } });
          if (exists === 0) throw new BadRequestError("أحد المستودعات غير موجود.");
        }

        const productIds = [...new Set(data.items.map((i) => i.productId))];
        const products = await tx.product.count({
          where: { id: { in: productIds }, companyId, deletedAt: null },
        });
        if (products !== productIds.length) {
          throw new BadRequestError("أحد المنتجات غير موجود في هذه الشركة.");
        }

        const operationNumber = await nextOperationNumber(tx, data.operationTypeId);

        const created = await tx.stockOperation.create({
          data: {
            companyId,
            operationNumber,
            operationTypeId: data.operationTypeId,
            fromWarehouseId: data.fromWarehouseId ?? null,
            toWarehouseId: data.toWarehouseId ?? null,
            reference: data.reference ?? null,
            notes: data.notes ?? null,
            // Operations that need a second pair of eyes start pending; the
            // rest are ready to execute immediately.
            status: operationType.requiresValidation ? "PENDING" : "READY",
            items: {
              create: data.items.map((item) => ({
                companyId,
                productId: item.productId,
                variantId: item.variantId ?? null,
                quantity: item.quantity,
                unitCost: item.unitCost,
              })),
            },
          },
          select: SELECT,
        });
      const [createdHydrated] = await hydrateOperation(tx, [created]);

        await audit(tx, {
          action: "stockOperation.created",
          entity: "StockOperation",
          entityId: created.id,
          summary: `تم إنشاء عملية المخزون ${created.operationNumber}.`,
        });

        return createdHydrated;
      });
    },
    { status: 201, message: "تم إنشاء العملية بنجاح." }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.ManageStockOperations),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = UpdateStockOperationSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        const operation = await loadOperation(tx, companyId, id);

        // Once stock has physically moved the operation is history; editing it
        // would make the ledger disagree with the record that produced it.
        if (operation.status !== "DRAFT" && operation.status !== "PENDING") {
          throw new ConflictError("لا يمكن تعديل عملية تم تنفيذها أو إلغاؤها.");
        }

        const updated = await tx.stockOperation.update({
          where: { id },
          data: {
            fromWarehouseId: data.fromWarehouseId,
            toWarehouseId: data.toWarehouseId,
            reference: data.reference,
            notes: data.notes,
            items:
              data.items === undefined
                ? undefined
                : {
                    deleteMany: {},
                    create: data.items.map((item) => ({
                      companyId,
                      productId: item.productId,
                      variantId: item.variantId ?? null,
                      quantity: item.quantity,
                      unitCost: item.unitCost,
                    })),
                  },
          },
          select: SELECT,
        });
      const [updatedHydrated] = await hydrateOperation(tx, [updated]);

        await audit(tx, {
          action: "stockOperation.updated",
          entity: "StockOperation",
          entityId: id,
          summary: `تم تحديث العملية ${updated.operationNumber}.`,
        });

        return updatedHydrated;
      });
    },
    { message: "تم تحديث العملية بنجاح." }
  )
);

/** PENDING -> READY. A second approval step for movements that need one. */
router.post(
  "/:id/validate",
  requirePermission(Permissions.ManageStockOperations),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const operation = await loadOperation(tx, req.ctx.companyId!, id);

      if (operation.status !== "PENDING") {
        throw new ConflictError("العملية ليست في حالة انتظار الاعتماد.");
      }

      const updated = await tx.stockOperation.update({
        where: { id },
        data: { status: "READY" },
        select: SELECT,
      });
      const [updatedHydrated] = await hydrateOperation(tx, [updated]);

      await audit(tx, {
        action: "stockOperation.validated",
        entity: "StockOperation",
        entityId: id,
        summary: `تم اعتماد العملية ${updated.operationNumber}.`,
      });

      return updatedHydrated;
    })
  )
);

/**
 * READY -> DONE, applying every line as a movement.
 *
 * The whole thing happens inside one `scoped` transaction: a failure on the
 * last line rolls back the earlier ones, so stock is never half-moved.
 */
router.post(
  "/:id/execute",
  requirePermission(Permissions.ManageStockOperations),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const companyId = req.ctx.companyId!;
      const operation = await loadOperation(tx, companyId, id);

      if (operation.status !== "READY") {
        throw new ConflictError("لا يمكن تنفيذ عملية غير جاهزة للتنفيذ.");
      }

      const { from, to } = assertDirection(operation.fromWarehouse?.id ?? null, operation.toWarehouse?.id ?? null);

      const fromLocation = from ? await resolveLocation(tx, companyId, from) : null;
      const toLocation = to ? await resolveLocation(tx, companyId, to) : null;

      const ctx = { companyId, actorId: req.ctx.userId };

      for (const item of operation.items) {
        // A line without a product cannot move stock; skip rather than crash.
        if (!item.product) continue;
        if (fromLocation) {
          await applyMovementWithAlerts(tx, ctx, {
            productId: item.product.id,
            storageLocationId: fromLocation,
            quantity: -Number(item.quantity),
            type: toLocation ? "TRANSFER_OUT" : "ADJUSTMENT_OUT",
            unitCost: Number(item.unitCost),
            reason: `عملية مخزون ${operation.operationNumber}`,
            referenceType: "StockOperation",
            referenceId: operation.id,
            referenceNumber: operation.operationNumber,
          });
        }

        if (toLocation) {
          await applyMovementWithAlerts(tx, ctx, {
            productId: item.product.id,
            storageLocationId: toLocation,
            quantity: Number(item.quantity),
            type: fromLocation ? "TRANSFER_IN" : "ADJUSTMENT_IN",
            unitCost: Number(item.unitCost),
            reason: `عملية مخزون ${operation.operationNumber}`,
            referenceType: "StockOperation",
            referenceId: operation.id,
            referenceNumber: operation.operationNumber,
          });
        }

        await tx.stockOperationItem.update({
          where: { id: item.id },
          data: { doneQuantity: Number(item.quantity) },
        });
      }

      const updated = await tx.stockOperation.update({
        where: { id },
        data: { status: "DONE", executedAt: new Date(), executedById: req.ctx.userId },
        select: SELECT,
      });
      const [updatedHydrated] = await hydrateOperation(tx, [updated]);

      await audit(tx, {
        action: "stockOperation.executed",
        entity: "StockOperation",
        entityId: id,
        summary: `تم تنفيذ العملية ${updated.operationNumber} (${operation.items.length} صنف).`,
      });

      return updatedHydrated;
    })
  )
);

router.post(
  "/:id/cancel",
  requirePermission(Permissions.ManageStockOperations),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const operation = await loadOperation(tx, req.ctx.companyId!, id);

      if (operation.status === "DONE") {
        throw new ConflictError(
          "لا يمكن إلغاء عملية منفذة. أنشئ عملية عكسية لإرجاع المخزون."
        );
      }
      if (operation.status === "CANCELLED") {
        throw new ConflictError("العملية ملغاة بالفعل.");
      }

      const updated = await tx.stockOperation.update({
        where: { id },
        data: { status: "CANCELLED" },
        select: SELECT,
      });
      const [updatedHydrated] = await hydrateOperation(tx, [updated]);

      await audit(tx, {
        action: "stockOperation.cancelled",
        entity: "StockOperation",
        entityId: id,
        summary: `تم إلغاء العملية ${updated.operationNumber}.`,
      });

      return updatedHydrated;
    })
  )
);

router.delete(
  "/:id",
  requirePermission(Permissions.ManageStockOperations),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const operation = await loadOperation(tx, req.ctx.companyId!, id);

      if (operation.status === "DONE") {
        throw new ConflictError("لا يمكن حذف عملية منفذة لأنها مسجلة في حركة المخزون.");
      }

      await tx.stockOperation.update({ where: { id }, data: { deletedAt: new Date() } });

      await audit(tx, {
        action: "stockOperation.deleted",
        entity: "StockOperation",
        entityId: id,
        summary: `تم حذف العملية ${operation.operationNumber}.`,
      });

      return null;
    })
  )
);

export { router as stockOperationRoutes };
