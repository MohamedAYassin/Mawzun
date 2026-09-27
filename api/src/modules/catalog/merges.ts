import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { orderBy, pageSlice } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// Merging two products is how duplicate catalogue entries get cleaned up. It is
// staged rather than immediate: a merge is requested, reviewed, then executed,
// because it rewrites stock history and cannot be trivially undone.

export const CreateMergeSchema = z.object({
  sourceProductId: z.string().min(1, "المنتج المصدر مطلوب."),
  targetProductId: z.string().min(1, "المنتج الهدف مطلوب."),
  reason: z.string().trim().max(500).nullish(),
});

const SELECT = {
  id: true,
  reason: true,
  status: true,
  mergedAt: true,
  createdAt: true,
  sourceProduct: { select: { id: true, name: true, skuCode: true } },
  targetProduct: { select: { id: true, name: true, skuCode: true } },
} as const;

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewProducts),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);

    return scoped(req, async (tx) => {
      const where = { companyId: req.ctx.companyId! };
      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.productMerge.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "status"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.productMerge.count({ where });
      return toPage(items, total, input);
    });
  })
);

router.post(
  "/",
  requirePermission(Permissions.UpdateProduct),
  route(
    async (req: AuthedRequest) => {
      const data = CreateMergeSchema.parse(req.body);
      if (data.sourceProductId === data.targetProductId) {
        throw new BadRequestError("لا يمكن دمج المنتج مع نفسه.");
      }

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
        const source = await tx.product.findFirst({
          where: { id: data.sourceProductId, companyId, deletedAt: null },
          select: { id: true, name: true },
        });
        const target = await tx.product.findFirst({
          where: { id: data.targetProductId, companyId, deletedAt: null },
          select: { id: true, name: true },
        });

        if (!source) throw new NotFoundError("المنتج المصدر غير موجود.");
        if (!target) throw new NotFoundError("المنتج الهدف غير موجود.");

        const pending = await tx.productMerge.findFirst({
          where: {
            companyId,
            sourceProductId: data.sourceProductId,
            status: "PENDING",
          },
          select: { id: true },
        });
        if (pending) throw new ConflictError("يوجد طلب دمج معلق لهذا المنتج بالفعل.");

        const created = await tx.productMerge.create({
          data: {
            companyId,
            sourceProductId: data.sourceProductId,
            targetProductId: data.targetProductId,
            reason: data.reason ?? null,
          },
          select: SELECT,
        });

        await audit(tx, {
          action: "productMerge.requested",
          entity: "ProductMerge",
          entityId: created.id,
          summary: `طلب دمج "${source.name}" في "${target.name}".`,
        });

        return created;
      });
    },
    { status: 201, message: "تم إنشاء طلب الدمج." }
  )
);

/**
 * Executes a pending merge.
 *
 * Stock is combined rather than replaced: where both products already have a
 * level in the same location, the source quantity is added to the target and
 * the source row is dropped. Every stock movement of the source is re-pointed
 * at the target so history stays consistent, then the source is deactivated so
 * it can no longer be ordered.
 */
router.post(
  "/:id/execute",
  requirePermission(Permissions.UpdateProduct),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const companyId = req.ctx.companyId!;

      const merge = await tx.productMerge.findFirst({
        where: { id, companyId },
        select: { id: true, status: true, sourceProductId: true, targetProductId: true },
      });
      if (!merge) throw new NotFoundError("طلب الدمج غير موجود.");
      if (merge.status !== "PENDING") {
        throw new ConflictError("لا يمكن تنفيذ طلب دمج تم تنفيذه أو إلغاؤه.");
      }

      const {
        sourceProductId: sourceId,
        targetProductId: targetId,
      } = merge;

      const sourceLevels = await tx.stockLevel.findMany({
        where: { productId: sourceId },
        select: { id: true, storageLocationId: true, onHand: true, reserved: true },
      });

      for (const level of sourceLevels) {
        await tx.stockLevel.upsert({
          where: {
            productId_storageLocationId: { productId: targetId, storageLocationId: level.storageLocationId },
          },
          create: {
            companyId,
            productId: targetId,
            storageLocationId: level.storageLocationId,
            onHand: level.onHand,
            reserved: level.reserved,
          },
          update: {
            onHand: { increment: level.onHand },
            reserved: { increment: level.reserved },
          },
        });
      }

      await tx.stockLevel.deleteMany({ where: { productId: sourceId } });
      await tx.inventoryTransaction.updateMany({
        where: { productId: sourceId },
        data: { productId: targetId },
      });

      // Reorder points are keyed (product, warehouse); carrying them across
      // would collide whenever both products had one, so the source's are
      // dropped rather than merged blindly.
      await tx.reorderPoint.deleteMany({ where: { productId: sourceId } });

      await tx.product.update({
        where: { id: sourceId },
        data: { isActive: false, archivedAt: new Date() },
      });

      const completed = await tx.productMerge.update({
        where: { id },
        data: { status: "MERGED", mergedAt: new Date() },
        select: SELECT,
      });

      await audit(tx, {
        action: "productMerge.executed",
        entity: "ProductMerge",
        entityId: id,
        summary: `تم تنفيذ الدمج: نُقل ${sourceLevels.length} مستوى مخزون.`,
      });

      return completed;
    })
  )
);

router.post(
  "/:id/cancel",
  requirePermission(Permissions.UpdateProduct),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");

      const merge = await tx.productMerge.findFirst({
        where: { id, companyId: req.ctx.companyId! },
        select: { id: true, status: true },
      });
      if (!merge) throw new NotFoundError("طلب الدمج غير موجود.");
      if (merge.status !== "PENDING") {
        throw new ConflictError("لا يمكن إلغاء طلب دمج تم تنفيذه.");
      }

      const cancelled = await tx.productMerge.update({
        where: { id },
        data: { status: "CANCELLED" },
        select: SELECT,
      });

      await audit(tx, {
        action: "productMerge.cancelled",
        entity: "ProductMerge",
        entityId: id,
        summary: "تم إلغاء طلب الدمج.",
      });

      return cancelled;
    })
  )
);

export { router as mergeRoutes };
