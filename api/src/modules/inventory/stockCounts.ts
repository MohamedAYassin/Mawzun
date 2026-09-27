import { Router } from "express";
import type { Db } from "../../config/database.js";
import { z } from "zod";
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

export const CreateStockCountSchema = z.object({
  warehouseId: z.string().nullish(),
  storageLocationId: z.string().nullish(),
  reason: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  /** When omitted, every product with stock in scope is counted. */
  productIds: z.array(z.string().min(1)).optional(),
});

export const RecordCountSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        storageLocationId: z.string().min(1),
        countedQuantity: z.coerce.number().min(0, "الكمية لا يمكن أن تكون سالبة."),
      })
    )
    .min(1, "يجب إدخال صنف واحد على الأقل."),
});

export const StockCountFilterSchema = z.object({
  status: z.enum(["DRAFT", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  warehouseId: z.string().trim().min(1).optional(),
});

// Scalars only. Relations are loaded one query at a time by hydrateCount().
// A single select with warehouse + storageLocation + items would be three
// statements issued CONCURRENTLY by Prisma — a race on this transaction's one
// connection (pg warns now, rejects on pg 9).
const SELECT = {
  id: true,
  referenceNumber: true,
  status: true,
  reason: true,
  notes: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} as const;

/** The relation half of SELECT, applied after the scalar query. */
async function hydrateCount<T extends { id: string }>(tx: Db, counts: T[]) {
  type Merged = {
    warehouse: { id: string; name: string } | null;
    storageLocation: { id: string; name: string } | null;
    items: {
      id: string;
      systemQuantity: unknown;
      countedQuantity: unknown;
      variance: unknown;
      product: { id: string; name: string; skuCode: string | null } | null;
      storageLocation: { id: string; name: string } | null;
    }[];
  };
  const merged = await mergeRelations<T, Merged>(tx, counts, [
    (ids) =>
      tx.stockCount.findMany({
        where: { id: { in: ids } },
        select: { id: true, warehouse: { select: { id: true, name: true } } },
      }),
    (ids) =>
      tx.stockCount.findMany({
        where: { id: { in: ids } },
        select: { id: true, storageLocation: { select: { id: true, name: true } } },
      }),
    (ids) =>
      tx.stockCount.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          items: {
            select: {
              id: true,
              systemQuantity: true,
              countedQuantity: true,
              variance: true,
            },
          },
        },
      }),
  ]);

  // Item-level relations, one query each.
  const allItemIds = merged.flatMap((c) => (c.items ?? []).map((i) => i.id));
  if (allItemIds.length) {
    const itemProducts = await tx.stockCountItem.findMany({
      where: { id: { in: allItemIds } },
      select: { id: true, product: { select: { id: true, name: true, skuCode: true } } },
    });
    const itemLocations = await tx.stockCountItem.findMany({
      where: { id: { in: allItemIds } },
      select: { id: true, storageLocation: { select: { id: true, name: true } } },
    });
    const prodById = new Map(itemProducts.map((r) => [r.id, r.product]));
    const locById = new Map(itemLocations.map((r) => [r.id, r.storageLocation]));
    for (const c of merged) {
      c.items = (c.items ?? []).map((i) => ({
        ...i,
        product: prodById.get(i.id) ?? null,
        storageLocation: locById.get(i.id) ?? null,
      }));
    }
  }
  return merged;
}

const router = Router();
async function loadCount(tx: Db, companyId: string, id: string) {
  const count = await tx.stockCount.findFirst({
    where: { id, companyId, deletedAt: null },
    select: SELECT,
  });
  if (!count) throw new NotFoundError("أمر الجرد غير موجود.");
  const [hydrated] = await hydrateCount(tx, [count]);
  return hydrated;
}

async function nextReferenceNumber(tx: Db): Promise<string> {
  const taken = await tx.stockCount.count();
  return `SC-${String(taken + 1).padStart(5, "0")}`;
}

router.get(
  "/",
  requirePermission(Permissions.ViewInventory),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = StockCountFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...searchFilter(["referenceNumber", "reason"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.stockCount.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "referenceNumber"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.stockCount.count({ where });
      const hydrated = await hydrateCount(tx, items);
      return toPage(hydrated, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewInventory),
  route(async (req: AuthedRequest) =>
    scoped(req, (tx) => loadCount(tx, req.ctx.companyId!, param(req, "id")))
  )
);

/**
 * Opens a count.
 *
 * The system quantity is frozen at creation, not read at completion. If it were
 * read later, stock that moved during the count would be silently written off
 * as a variance, and there would be no way to tell a real discrepancy from a
 * timing artefact.
 */
router.post(
  "/",
  requirePermission(Permissions.ManageInventory),
  route(
    async (req: AuthedRequest) => {
      const data = CreateStockCountSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const scope = {
          ...(data.storageLocationId
            ? { storageLocationId: data.storageLocationId }
            : data.warehouseId
              ? { storageLocation: { warehouseId: data.warehouseId } }
              : {}),
          ...(data.productIds ? { productId: { in: data.productIds } } : {}),
        };

        const levels = await tx.stockLevel.findMany({
          where: { companyId, ...scope },
          select: { productId: true, storageLocationId: true, onHand: true },
        });

        if (levels.length === 0) {
          throw new BadRequestError("لا يوجد مخزون في النطاق المحدد.");
        }

        const created = await tx.stockCount.create({
          data: {
            companyId,
            referenceNumber: await nextReferenceNumber(tx),
            warehouseId: data.warehouseId ?? null,
            storageLocationId: data.storageLocationId ?? null,
            reason: data.reason ?? null,
            notes: data.notes ?? null,
            status: "DRAFT",
            items: {
              create: levels.map((level) => ({
                companyId,
                productId: level.productId,
                storageLocationId: level.storageLocationId,
                systemQuantity: level.onHand,
              })),
            },
          },
          select: SELECT,
        });
        const [createdHydrated] = await hydrateCount(tx, [created]);

        await audit(tx, {
          action: "stockCount.created",
          entity: "StockCount",
          entityId: created.id,
          summary: `تم إنشاء أمر الجرد ${created.referenceNumber} (${levels.length} صنف).`,
        });

        return createdHydrated;
      });
    },
    { status: 201, message: "تم إنشاء أمر الجرد بنجاح." }
  )
);

router.post(
  "/:id/start",
  requirePermission(Permissions.ManageInventory),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const count = await loadCount(tx, req.ctx.companyId!, id);

      if (count.status !== "DRAFT") {
        throw new ConflictError("لا يمكن بدء أمر جرد تم بدؤه أو إكماله.");
      }

      const updated = await tx.stockCount.update({
        where: { id },
        data: { status: "IN_PROGRESS", startedAt: new Date() },
        select: SELECT,
      });

      await audit(tx, {
        action: "stockCount.started",
        entity: "StockCount",
        entityId: id,
        summary: `تم بدء الجرد ${updated.referenceNumber}.`,
      });

      return updated;
    })
  )
);

router.post(
  "/:id/items",
  requirePermission(Permissions.ManageInventory),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = RecordCountSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        const count = await loadCount(tx, companyId, id);

        if (count.status !== "IN_PROGRESS") {
          throw new ConflictError("يجب بدء الجرد قبل تسجيل الكميات.");
        }

        for (const entry of data.items) {
          await tx.stockCountItem.updateMany({
            where: { stockCountId: id, productId: entry.productId, storageLocationId: entry.storageLocationId },
            data: {
              countedQuantity: entry.countedQuantity,
              variance: entry.countedQuantity,
            },
          });
        }

        // Variance is counted minus system, computed after the fact so a
        // recount overwrites cleanly instead of accumulating.
        const items = await tx.stockCountItem.findMany({
          where: { stockCountId: id },
          select: { id: true, systemQuantity: true, countedQuantity: true },
        });
        for (const item of items) {
          if (item.countedQuantity === null) continue;
          await tx.stockCountItem.update({
            where: { id: item.id },
            data: { variance: Number(item.countedQuantity) - Number(item.systemQuantity) },
          });
        }

        await audit(tx, {
          action: "stockCount.recorded",
          entity: "StockCount",
          entityId: id,
          summary: `تم تسجيل ${data.items.length} صنف في الجرد ${count.referenceNumber}.`,
        });

        return loadCount(tx, companyId, id);
      });
    },
    { message: "تم تسجيل الكميات بنجاح." }
  )
);

/**
 * Completes a count and posts the variances.
 *
 * Only counted lines are adjusted — an uncounted line stays as it is rather
 * than being treated as a zero, which would wipe stock whenever someone skipped
 * a shelf.
 */
router.post(
  "/:id/complete",
  requirePermission(Permissions.ManageInventory),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const companyId = req.ctx.companyId!;
      const count = await loadCount(tx, companyId, id);

      if (count.status !== "IN_PROGRESS") {
        throw new ConflictError("لا يمكن إكمال أمر جرد غير مبدوء.");
      }

      const counted = count.items.filter((item) => item.countedQuantity !== null);
      const ctx = { companyId, actorId: req.ctx.userId };

      for (const item of counted) {
        const variance = Number(item.variance);
        if (variance === 0 || !item.storageLocation || !item.product) continue;

        await applyMovementWithAlerts(tx, ctx, {
          productId: item.product.id,
          storageLocationId: item.storageLocation.id,
          quantity: variance,
          type: "COUNT_VARIANCE",
          reason: `جرد ${count.referenceNumber}`,
          referenceType: "StockCount",
          referenceId: count.id,
          referenceNumber: count.referenceNumber,
        });
      }

      const updated = await tx.stockCount.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() },
        select: SELECT,
      });

      await audit(tx, {
        action: "stockCount.completed",
        entity: "StockCount",
        entityId: id,
        summary: `تم إكمال الجرد ${updated.referenceNumber}: ${counted.length} صنف معدّل.`,
      });

      return updated;
    })
  )
);

router.post(
  "/:id/cancel",
  requirePermission(Permissions.ManageInventory),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const count = await loadCount(tx, req.ctx.companyId!, id);

      if (count.status === "COMPLETED") {
        throw new ConflictError("لا يمكن إلغاء أمر جرد مكتمل.");
      }

      const updated = await tx.stockCount.update({
        where: { id },
        data: { status: "CANCELLED" },
        select: SELECT,
      });

      await audit(tx, {
        action: "stockCount.cancelled",
        entity: "StockCount",
        entityId: id,
        summary: `تم إلغاء الجرد ${updated.referenceNumber}.`,
      });

      return updated;
    })
  )
);

export { router as stockCountRoutes };
