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
import { defaultStorageLocation } from "../inventory/stockEngine.js";
import { applyMovementWithAlerts } from "../inventory/movementWithAlerts.js";

const itemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر."),
  unitPrice: z.coerce.number().min(0).default(0),
});

export const CreatePurchaseOrderSchema = z.object({
  vendorId: z.string().min(1, "المورد مطلوب."),
  notes: z.string().trim().max(1000).default(""),
  expectedAt: z.coerce.date().nullish(),
  items: z.array(itemSchema).min(1, "يجب إضافة صنف واحد على الأقل."),
});

export const UpdatePurchaseOrderSchema = CreatePurchaseOrderSchema.partial()
  .extend({ status: z.enum(["DRAFT", "ORDERED", "CANCELLED"]).optional() })
  .strict();

export const ReceiveItemsSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر."),
      })
    )
    .min(1, "يجب تحديد صنف واحد على الأقل."),
});

export const PurchaseOrderFilterSchema = z.object({
  status: z
    .enum(["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"])
    .optional(),
  vendorId: z.string().trim().min(1).optional(),
});

const LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  totalAmount: true,
  notes: true,
  expectedAt: true,
  receivedAt: true,
  createdAt: true,
  vendor: { select: { id: true, name: true, kind: true } },
  _count: { select: { items: true } },
} as const;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  cancelledAt: true,
  items: {
    select: {
      id: true,
      productName: true,
      skuCode: true,
      quantity: true,
      receivedQuantity: true,
      unitPrice: true,
      total: true,
      product: { select: { id: true, name: true, skuCode: true } },
    },
  },
} as const;

async function nextOrderNumber(tx: Db, companyId: string): Promise<string> {
  const settings = await tx.companySettings.upsert({
    where: { companyId },
    create: { companyId, purchaseOrderPrefix: "PO", purchaseNextNumber: 2 },
    update: { purchaseNextNumber: { increment: 1 } },
    select: { purchaseOrderPrefix: true, purchaseNextNumber: true },
  });
  return `${settings.purchaseOrderPrefix}-${String(settings.purchaseNextNumber - 1).padStart(6, "0")}`;
}

async function loadOrder(tx: Db, companyId: string, id: string) {
  const order = await tx.purchaseOrder.findFirst({
    where: { id, companyId, deletedAt: null },
    select: DETAIL_SELECT,
  });
  if (!order) throw new NotFoundError("أمر الشراء غير موجود.");
  return order;
}

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewPurchaseOrders),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = PurchaseOrderFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.vendorId ? { vendorId: filter.vendorId } : {}),
        ...searchFilter(["orderNumber", "notes"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.purchaseOrder.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "orderNumber", "totalAmount"], "createdAt"),
        ...pageSlice(input),
        select: LIST_SELECT,
      });
      const total = await tx.purchaseOrder.count({ where });
      return toPage(items, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewPurchaseOrders),
  route(async (req: AuthedRequest) =>
    scoped(req, (tx) => loadOrder(tx, req.ctx.companyId!, param(req, "id")))
  )
);

router.post(
  "/",
  requirePermission(Permissions.CreatePurchaseOrder),
  route(
    async (req: AuthedRequest) => {
      const data = CreatePurchaseOrderSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const vendor = await tx.vendor.findFirst({
          where: { id: data.vendorId, companyId, deletedAt: null },
          select: { id: true, name: true },
        });
        if (!vendor) throw new BadRequestError("المورد غير موجود.");

        const productIds = [...new Set(data.items.map((i) => i.productId))];
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, companyId, deletedAt: null },
          select: { id: true, name: true, skuCode: true, costPrice: true },
        });
        if (products.length !== productIds.length) {
          throw new BadRequestError("أحد المنتجات غير موجود في هذه الشركة.");
        }

        const byId = new Map(products.map((p) => [p.id, p]));
        const lines = data.items.map((item) => {
          const product = byId.get(item.productId)!;
          const unitPrice = item.unitPrice || Number(product.costPrice);
          return {
            productId: item.productId,
            productName: product.name,
            skuCode: product.skuCode,
            quantity: item.quantity,
            unitPrice,
            total: item.quantity * unitPrice,
          };
        });

        const created = await tx.purchaseOrder.create({
          data: {
            companyId,
            orderNumber: await nextOrderNumber(tx, companyId),
            vendorId: data.vendorId,
            notes: data.notes,
            expectedAt: data.expectedAt ?? null,
            status: "DRAFT",
            totalAmount: lines.reduce((sum, line) => sum + line.total, 0),
            items: { create: lines.map((line) => ({ companyId, ...line })) },
          },
          select: DETAIL_SELECT,
        });

        await audit(tx, {
          action: "purchaseOrder.created",
          entity: "PurchaseOrder",
          entityId: created.id,
          summary: `تم إنشاء أمر الشراء ${created.orderNumber} من ${vendor.name}.`,
        });

        return created;
      });
    },
    { status: 201, message: "تم إنشاء أمر الشراء بنجاح." }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.UpdatePurchaseOrder),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = UpdatePurchaseOrderSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        const order = await loadOrder(tx, companyId, id);

        if (order.status === "RECEIVED" || order.status === "CANCELLED") {
          throw new ConflictError("لا يمكن تعديل أمر تم استلامه أو إلغاؤه.");
        }

        let totalAmount: number | undefined;
        let itemsCreate;

        if (data.items) {
          const productIds = [...new Set(data.items.map((i) => i.productId))];
          const products = await tx.product.findMany({
            where: { id: { in: productIds }, companyId, deletedAt: null },
            select: { id: true, name: true, skuCode: true, costPrice: true },
          });
          if (products.length !== productIds.length) {
            throw new BadRequestError("أحد المنتجات غير موجود في هذه الشركة.");
          }

          const byId = new Map(products.map((p) => [p.id, p]));
          const lines = data.items.map((item) => {
            const product = byId.get(item.productId)!;
            const unitPrice = item.unitPrice || Number(product.costPrice);
            return {
              companyId,
              productId: item.productId,
              productName: product.name,
              skuCode: product.skuCode,
              quantity: item.quantity,
              unitPrice,
              total: item.quantity * unitPrice,
            };
          });

          totalAmount = lines.reduce((sum, line) => sum + line.total, 0);
          itemsCreate = { deleteMany: {}, create: lines };
        }

        const updated = await tx.purchaseOrder.update({
          where: { id },
          data: {
            vendorId: data.vendorId,
            notes: data.notes,
            expectedAt: data.expectedAt,
            status: data.status,
            cancelledAt: data.status === "CANCELLED" ? new Date() : undefined,
            totalAmount,
            items: itemsCreate,
          },
          select: DETAIL_SELECT,
        });

        await audit(tx, {
          action: "purchaseOrder.updated",
          entity: "PurchaseOrder",
          entityId: id,
          summary: `تم تحديث أمر الشراء ${updated.orderNumber}.`,
          changes: data,
        });

        return updated;
      });
    },
    { message: "تم تحديث أمر الشراء بنجاح." }
  )
);

/**
 * Books goods in against a purchase order.
 *
 * Receipt is what turns a purchase order into stock, so it writes both the
 * movement and the received quantity in one transaction: a partial receipt
 * leaves the order PARTIALLY_RECEIVED and a full one closes it.
 */
router.post(
  "/:id/receive",
  requirePermission(Permissions.UpdatePurchaseOrder),
  route(async (req: AuthedRequest) => {
    const id = param(req, "id");
    const data = ReceiveItemsSchema.parse(req.body);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const order = await loadOrder(tx, companyId, id);

      if (order.status === "CANCELLED") {
        throw new ConflictError("لا يمكن الاستلام من أمر ملغى.");
      }

      const locationId = await defaultStorageLocation(tx, companyId);
      if (!locationId) {
        throw new BadRequestError("لا يوجد موقع تخزين افتراضي لاستلام البضاعة.");
      }

      const requested = new Map(data.items.map((item) => [item.productId, item.quantity]));

      for (const item of order.items) {
        const quantity = requested.get(item.product.id);
        if (!quantity) continue;

        const outstanding = Number(item.quantity) - Number(item.receivedQuantity);
        if (quantity > outstanding) {
          throw new BadRequestError(
            `الكمية المستلمة من "${item.productName}" تتجاوز المتبقي (${outstanding}).`
          );
        }

        await applyMovementWithAlerts(
          tx,
          { companyId, actorId: req.ctx.userId },
          {
            productId: item.product.id,
            storageLocationId: locationId,
            quantity,
            type: "PURCHASE",
            unitCost: Number(item.unitPrice),
            reason: `استلام من أمر الشراء ${order.orderNumber}`,
            referenceType: "PurchaseOrder",
            referenceId: order.id,
            referenceNumber: order.orderNumber,
          }
        );

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data: { receivedQuantity: { increment: quantity } },
        });
      }

      const remaining = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: id },
        select: { quantity: true, receivedQuantity: true },
      });
      const complete = remaining.every(
        (line) => Number(line.receivedQuantity) >= Number(line.quantity)
      );
      const anyReceived = remaining.some((line) => Number(line.receivedQuantity) > 0);

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: complete ? "RECEIVED" : anyReceived ? "PARTIALLY_RECEIVED" : "ORDERED",
          receivedAt: complete ? new Date() : undefined,
        },
        select: DETAIL_SELECT,
      });

      await audit(tx, {
        action: "purchaseOrder.received",
        entity: "PurchaseOrder",
        entityId: id,
        summary: `تم استلام ${data.items.length} صنف من ${order.orderNumber}.`,
        changes: { items: data.items, status: updated.status },
      });

      return updated;
    });
  })
);

router.delete(
  "/:id",
  requirePermission(Permissions.DeletePurchaseOrder),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const order = await loadOrder(tx, req.ctx.companyId!, id);

      if (order.status === "RECEIVED") {
        throw new ConflictError("لا يمكن حذف أمر تم استلامه.");
      }
      if (order.items.some((item) => Number(item.receivedQuantity) > 0)) {
        throw new ConflictError("لا يمكن حذف أمر تم استلام جزء منه.");
      }

      await tx.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date() } });

      await audit(tx, {
        action: "purchaseOrder.deleted",
        entity: "PurchaseOrder",
        entityId: id,
        summary: `تم حذف أمر الشراء ${order.orderNumber}.`,
      });

      return null;
    })
  )
);

export { router as purchaseOrderRoutes };
