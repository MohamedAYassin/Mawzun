import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { mergeRelations } from "../../shared/relations.js";
import { applyMovementWithAlerts } from "./movementWithAlerts.js";

// Stock itself. There is no "create stock level" endpoint: levels are a
// projection of the movement ledger, and creating one directly would let the
// balance drift from the transactions that produced it.

export const StockFilterSchema = z.object({
  warehouseId: z.string().trim().min(1).optional(),
  storageLocationId: z.string().trim().min(1).optional(),
  productId: z.string().trim().min(1).optional(),
  onlyPositive: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export const AdjustStockSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب."),
  storageLocationId: z.string().min(1, "موقع التخزين مطلوب."),
  /** The quantity the shelf should hold after the correction. */
  countedQuantity: z.coerce.number().min(0, "الكمية لا يمكن أن تكون سالبة."),
  reason: z.string().trim().max(500).nullish(),
});

export const TransferStockSchema = z.object({
  productId: z.string().min(1, "المنتج مطلوب."),
  fromStorageLocationId: z.string().min(1, "موقع المصدر مطلوب."),
  toStorageLocationId: z.string().min(1, "موقع الهدف مطلوب."),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر."),
  reason: z.string().trim().max(500).nullish(),
});

const router = Router();
router.get(
  "/levels",
  requirePermission(Permissions.ViewInventory),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = StockFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.storageLocationId
          ? { storageLocationId: filter.storageLocationId }
          : filter.warehouseId
            ? { storageLocation: { warehouseId: filter.warehouseId } }
            : {}),
        ...searchFilter(["product.name", "product.skuCode"], input.search),
      };

      // Scalars here; relations one query at a time via mergeRelations().
      // Prisma would otherwise fetch `product` and `storageLocation`
      // CONCURRENTLY, which races on this transaction's single connection.
      const items = await tx.stockLevel.findMany({
        where,
        orderBy: orderBy(input, ["onHand", "reserved"], "onHand"),
        ...pageSlice(input),
        select: { id: true, onHand: true, reserved: true },
      });
      type LevelMerged = {
        product: { id: string; name: string; skuCode: string | null; trackStock: boolean; uom: { code: string } | null };
        storageLocation: { id: string; name: string; code: string | null; warehouse: { id: string; name: string } };
      };
      const withRelations = await mergeRelations<typeof items[number], LevelMerged>(tx, items, [
        (ids) =>
          tx.stockLevel.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              product: {
                select: { id: true, name: true, skuCode: true, trackStock: true, uom: { select: { code: true } } },
              },
            },
          }),
        (ids) =>
          tx.stockLevel.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              storageLocation: {
                select: { id: true, name: true, code: true, warehouse: { select: { id: true, name: true } } },
              },
            },
          }),
      ]);
      const total = await tx.stockLevel.count({ where });

      // withRelations, not items — the relations were fetched for this response.
      const rows = withRelations
        .map((level) => ({
          ...level,
          available: Number(level.onHand) - Number(level.reserved),
        }))
        .filter((level) => (filter.onlyPositive ? level.available > 0 : true));

      return toPage(rows, filter.onlyPositive ? rows.length : total, input);
    });
  })
);

/** The movement ledger. Read-only: entries are written only by the engine. */
router.get(
  "/transactions",
  requirePermission(Permissions.ViewInventory),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = StockFilterSchema.omit({ onlyPositive: true }).parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        ...(filter.productId ? { productId: filter.productId } : {}),
        ...(filter.storageLocationId
          ? { storageLocationId: filter.storageLocationId }
          : filter.warehouseId
            ? { storageLocation: { warehouseId: filter.warehouseId } }
            : {}),
        ...searchFilter(["referenceNumber", "reason"], input.search),
      };

      // Scalars here; three relations loaded one at a time (see mergeRelations).
      const items = await tx.inventoryTransaction.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "quantity"], "createdAt"),
        ...pageSlice(input),
        select: {
          id: true,
          transactionType: true,
          quantity: true,
          balanceAfter: true,
          unitCost: true,
          reason: true,
          referenceType: true,
          referenceId: true,
          referenceNumber: true,
          createdAt: true,
        },
      });
      const withRelations = await mergeRelations(tx, items, [
        (ids) =>
          tx.inventoryTransaction.findMany({
            where: { id: { in: ids } },
            select: { id: true, product: { select: { id: true, name: true, skuCode: true } } },
          }),
        (ids) =>
          tx.inventoryTransaction.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              storageLocation: { select: { id: true, name: true, warehouse: { select: { id: true, name: true } } } },
            },
          }),
        (ids) =>
          tx.inventoryTransaction.findMany({
            where: { id: { in: ids } },
            select: { id: true, actor: { select: { id: true, fullName: true } } },
          }),
      ]);
      const total = await tx.inventoryTransaction.count({ where });

      return toPage(withRelations, total, input);
    });
  })
);

/**
 * Corrects a shelf to a counted quantity.
 *
 * The correction is expressed as a target, not a delta: the operator counts
 * what is physically there, and the difference becomes the movement. Storing it
 * as a delta invites sign errors and hides what the count actually was.
 */
router.post(
  "/adjust",
  requirePermission(Permissions.ManageInventory),
  route(
    async (req: AuthedRequest) => {
      const data = AdjustStockSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
        const product = await tx.product.findFirst({
          where: { id: data.productId, companyId, deletedAt: null },
          select: { id: true, name: true },
        });
        const location = await tx.storageLocation.findFirst({
          where: { id: data.storageLocationId, companyId, deletedAt: null },
          select: { id: true, name: true },
        });

        if (!product) throw new NotFoundError("المنتج غير موجود.");
        if (!location) throw new NotFoundError("موقع التخزين غير موجود.");

        const level = await tx.stockLevel.findUnique({
          where: {
            productId_storageLocationId: {
              productId: data.productId,
              storageLocationId: data.storageLocationId,
            },
          },
          select: { onHand: true },
        });

        const current = Number(level?.onHand ?? 0);
        const delta = data.countedQuantity - current;

        const result =
          delta === 0
            ? { balanceAfter: current }
            : await applyMovementWithAlerts(
                tx,
                { companyId, actorId: req.ctx.userId },
                {
                  productId: data.productId,
                  storageLocationId: data.storageLocationId,
                  quantity: delta,
                  type: delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
                  reason: data.reason ?? "تسوية يدوية بعد الجرد",
                }
              );

        await audit(tx, {
          action: "stock.adjusted",
          entity: "InventoryTransaction",
          entityId: data.productId,
          summary: `تسوية مخزون "${product.name}" في ${location.name}: ${current} → ${data.countedQuantity}.`,
          changes: { from: current, to: data.countedQuantity, delta },
        });

        return { productId: data.productId, previous: current, ...result };
      });
    },
    { message: "تم تسوية المخزون بنجاح." }
  )
);

router.post(
  "/transfer",
  requirePermission(Permissions.ManageInventory),
  route(
    async (req: AuthedRequest) => {
      const data = TransferStockSchema.parse(req.body);
      if (data.fromStorageLocationId === data.toStorageLocationId) {
        throw new BadRequestError("موقع المصدر والهدف يجب أن يكونا مختلفين.");
      }

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const locations = await tx.storageLocation.count({
          where: { id: { in: [data.fromStorageLocationId, data.toStorageLocationId] }, companyId },
        });
        if (locations !== 2) throw new NotFoundError("أحد مواقع التخزين غير موجود.");

        const ctx = { companyId, actorId: req.ctx.userId };

        // Two movements, one transaction — the goods must not exist in both
        // places or neither.
        await applyMovementWithAlerts(tx, ctx, {
          productId: data.productId,
          storageLocationId: data.fromStorageLocationId,
          quantity: -data.quantity,
          type: "TRANSFER_OUT",
          reason: data.reason ?? "تحويل داخلي",
        });

        const { balanceAfter } = await applyMovementWithAlerts(tx, ctx, {
          productId: data.productId,
          storageLocationId: data.toStorageLocationId,
          quantity: data.quantity,
          type: "TRANSFER_IN",
          reason: data.reason ?? "تحويل داخلي",
        });

        await audit(tx, {
          action: "stock.transferred",
          entity: "InventoryTransaction",
          entityId: data.productId,
          summary: `تحويل ${data.quantity} من المخزون.`,
          changes: data,
        });

        return { productId: data.productId, balanceAfter };
      });
    },
    { message: "تم التحويل بنجاح." }
  )
);

export { router as stockRoutes };
