import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// ---------------------------------------------------------------------------
// Fulfilment batches — a wave of picking or packing in one warehouse
// ---------------------------------------------------------------------------

export const CreateBatchSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(60),
  warehouseId: z.string().min(1, "المستودع مطلوب."),
  type: z.enum(["PICKING", "PACKING"]).default("PICKING"),
});

export const UpdateBatchSchema = CreateBatchSchema.partial().strict();

const BATCH_SELECT = {
  id: true,
  name: true,
  type: true,
  status: true,
  completedAt: true,
  createdAt: true,
  warehouse: { select: { id: true, name: true } },
} as const;

const batchRouter = Router();
batchRouter.get(
  "/",
  requirePermission(Permissions.ViewFulfillment),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["name"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.fulfillmentBatch.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "name", "status"], "createdAt"),
        ...pageSlice(input),
        select: BATCH_SELECT,
      });
      const total = await tx.fulfillmentBatch.count({ where });
      return toPage(items, total, input);
    });
  })
);

batchRouter.post(
  "/",
  requirePermission(Permissions.ManageFulfillment),
  route(
    async (req: AuthedRequest) => {
      const data = CreateBatchSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const warehouse = await tx.warehouse.count({
          where: { id: data.warehouseId, companyId, deletedAt: null },
        });
        if (warehouse === 0) throw new BadRequestError("المستودع غير موجود.");

        const clash = await tx.fulfillmentBatch.findFirst({
          where: { companyId, name: data.name, deletedAt: null },
          select: { id: true },
        });
        if (clash) throw new ConflictError("توجد دفعة بنفس الاسم بالفعل.");

        const created = await tx.fulfillmentBatch.create({
          data: { companyId, ...data },
          select: BATCH_SELECT,
        });

        await audit(tx, {
          action: "fulfillmentBatch.created",
          entity: "FulfillmentBatch",
          entityId: created.id,
          summary: `تم إنشاء دفعة التجهيز ${created.name}.`,
        });

        return created;
      });
    },
    { status: 201, message: "تم إنشاء الدفعة بنجاح." }
  )
);

batchRouter.patch(
  "/:id",
  requirePermission(Permissions.ManageFulfillment),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = UpdateBatchSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const batch = await tx.fulfillmentBatch.findFirst({
          where: { id, companyId: req.ctx.companyId!, deletedAt: null },
          select: { id: true, status: true },
        });
        if (!batch) throw new NotFoundError("دفعة التجهيز غير موجودة.");

        if (batch.status !== "NEW") {
          throw new ConflictError("لا يمكن تعديل دفعة مكتملة أو ملغاة.");
        }

        return tx.fulfillmentBatch.update({ where: { id }, data, select: BATCH_SELECT });
      });
    },
    { message: "تم تحديث الدفعة بنجاح." }
  )
);

batchRouter.post(
  "/:id/complete",
  requirePermission(Permissions.ManageFulfillment),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const batch = await tx.fulfillmentBatch.findFirst({
        where: { id, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, name: true, status: true },
      });
      if (!batch) throw new NotFoundError("دفعة التجهيز غير موجودة.");

      if (batch.status !== "NEW") {
        throw new ConflictError("لا يمكن إكمال دفعة مكتملة أو ملغاة.");
      }

      const updated = await tx.fulfillmentBatch.update({
        where: { id },
        data: { status: "DONE", completedAt: new Date() },
        select: BATCH_SELECT,
      });

      await audit(tx, {
        action: "fulfillmentBatch.completed",
        entity: "FulfillmentBatch",
        entityId: id,
        summary: `تم إكمال دفعة التجهيز ${batch.name}.`,
      });

      return updated;
    })
  )
);

batchRouter.post(
  "/:id/cancel",
  requirePermission(Permissions.ManageFulfillment),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const batch = await tx.fulfillmentBatch.findFirst({
        where: { id, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, name: true, status: true },
      });
      if (!batch) throw new NotFoundError("دفعة التجهيز غير موجودة.");

      if (batch.status !== "NEW") {
        throw new ConflictError("لا يمكن إلغاء دفعة مكتملة.");
      }

      const updated = await tx.fulfillmentBatch.update({
        where: { id },
        data: { status: "CANCELLED" },
        select: BATCH_SELECT,
      });

      await audit(tx, {
        action: "fulfillmentBatch.cancelled",
        entity: "FulfillmentBatch",
        entityId: id,
        summary: `تم إلغاء دفعة التجهيز ${batch.name}.`,
      });

      return updated;
    })
  )
);

// ---------------------------------------------------------------------------
// Shipping returns — what the carrier brought back
// ---------------------------------------------------------------------------

export const CreateReturnSchema = z.object({
  orderId: z.string().min(1, "الطلب مطلوب."),
  carrierId: z.string().nullish(),
  customerId: z.string().nullish(),
  qtyReturnedGood: z.coerce.number().int().min(0).default(0),
  qtyReturnedDamaged: z.coerce.number().int().min(0).default(0),
  qtyReturnedMissing: z.coerce.number().int().min(0).default(0),
  amountTotal: z.coerce.number().min(0).default(0),
  shippingCost: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(500).nullish(),
});

export const UpdateReturnSchema = CreateReturnSchema.partial()
  .omit({ orderId: true })
  .strict();

const RETURN_SELECT = {
  id: true,
  referenceNumber: true,
  qtyReturnedGood: true,
  qtyReturnedDamaged: true,
  qtyReturnedMissing: true,
  amountTotal: true,
  shippingCost: true,
  amountWithShipping: true,
  returnsCollected: true,
  returnsCollectedAt: true,
  notes: true,
  createdAt: true,
  order: { select: { id: true, orderNumber: true, status: true } },
  customer: { select: { id: true, name: true, phoneNumber1: true } },
  carrier: { select: { id: true, name: true } },
} as const;

const returnRouter = Router();
returnRouter.get(
  "/",
  requirePermission(Permissions.ViewShippingReturns),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["referenceNumber", "notes"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.shippingReturn.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "referenceNumber"], "createdAt"),
        ...pageSlice(input),
        select: RETURN_SELECT,
      });
      const total = await tx.shippingReturn.count({ where });
      return toPage(items, total, input);
    });
  })
);

returnRouter.get(
  "/:id",
  requirePermission(Permissions.ViewShippingReturns),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const record = await tx.shippingReturn.findFirst({
        where: { id: param(req, "id"), companyId: req.ctx.companyId!, deletedAt: null },
        select: RETURN_SELECT,
      });
      if (!record) throw new NotFoundError("المرتجع غير موجود.");
      return record;
    })
  )
);

returnRouter.post(
  "/",
  requirePermission(Permissions.ManageShippingReturns),
  route(
    async (req: AuthedRequest) => {
      const data = CreateReturnSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const order = await tx.order.findFirst({
          where: { id: data.orderId, companyId, deletedAt: null },
          select: { id: true, orderNumber: true },
        });
        if (!order) throw new NotFoundError("الطلب غير موجود.");

        // The reference comes from the company's own counter, incremented
        // atomically in this transaction — the same way nextOrderNumber
        // allocates an order number, and for the same reason.
        //
        // It used to be derived from a row count (`count()` then `taken + 1`),
        // which is read-then-write: two overlapping creates both read the same
        // count and compute the same reference, and since
        // (companyId, referenceNumber) is UNIQUE the loser fails outright
        // rather than colliding silently. Measured against the real pool, 8
        // simultaneous creates yielded 3 rows and 5 CONFLICT errors — the
        // remaining clerks saw "هذه القيمة مستخدمة بالفعل." through no fault of
        // their own. An atomic increment cannot lose that race.
        const settings = await tx.companySettings.upsert({
          where: { companyId },
          create: { companyId, returnPrefix: "RET", returnNextNumber: 2 },
          update: { returnNextNumber: { increment: 1 } },
          select: { returnPrefix: true, returnNextNumber: true },
        });
        const referenceNumber =
          `${settings.returnPrefix}-${String(settings.returnNextNumber - 1).padStart(6, "0")}`;

        const created = await tx.shippingReturn.create({
          data: {
            companyId,
            referenceNumber,
            orderId: data.orderId,
            carrierId: data.carrierId ?? null,
            customerId: data.customerId ?? null,
            qtyReturnedGood: data.qtyReturnedGood,
            qtyReturnedDamaged: data.qtyReturnedDamaged,
            qtyReturnedMissing: data.qtyReturnedMissing,
            amountTotal: data.amountTotal,
            shippingCost: data.shippingCost,
            // What the company actually nets: the returned goods less the cost
            // of shipping them back.
            amountWithShipping: data.amountTotal - data.shippingCost,
            notes: data.notes ?? null,
          },
          select: RETURN_SELECT,
        });

        await audit(tx, {
          action: "shippingReturn.created",
          entity: "ShippingReturn",
          entityId: created.id,
          summary: `تم تسجيل مرتجع ${created.referenceNumber} للطلب ${order.orderNumber}.`,
        });

        return created;
      });
    },
    { status: 201, message: "تم تسجيل المرتجع بنجاح." }
  )
);

returnRouter.patch(
  "/:id",
  requirePermission(Permissions.ManageShippingReturns),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = UpdateReturnSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const existing = await tx.shippingReturn.findFirst({
          where: { id, companyId: req.ctx.companyId!, deletedAt: null },
          select: { id: true, amountTotal: true, shippingCost: true },
        });
        if (!existing) throw new NotFoundError("المرتجع غير موجود.");

        const amountTotal = data.amountTotal ?? Number(existing.amountTotal);
        const shippingCost = data.shippingCost ?? Number(existing.shippingCost);

        return tx.shippingReturn.update({
          where: { id },
          data: {
            carrierId: data.carrierId,
            customerId: data.customerId,
            qtyReturnedGood: data.qtyReturnedGood,
            qtyReturnedDamaged: data.qtyReturnedDamaged,
            qtyReturnedMissing: data.qtyReturnedMissing,
            amountTotal,
            shippingCost,
            amountWithShipping: amountTotal - shippingCost,
            notes: data.notes,
          },
          select: RETURN_SELECT,
        });
      });
    },
    { message: "تم تحديث المرتجع بنجاح." }
  )
);

/** Marks the money from a return as collected. */
returnRouter.post(
  "/:id/collect",
  requirePermission(Permissions.ManageShippingReturns),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const record = await tx.shippingReturn.findFirst({
        where: { id, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, referenceNumber: true, returnsCollected: true },
      });
      if (!record) throw new NotFoundError("المرتجع غير موجود.");

      if (record.returnsCollected) {
        throw new ConflictError("تم تحصيل هذا المرتجع بالفعل.");
      }

      const updated = await tx.shippingReturn.update({
        where: { id },
        data: { returnsCollected: true, returnsCollectedAt: new Date() },
        select: RETURN_SELECT,
      });

      await audit(tx, {
        action: "shippingReturn.collected",
        entity: "ShippingReturn",
        entityId: id,
        summary: `تم تحصيل المرتجع ${record.referenceNumber}.`,
      });

      return updated;
    })
  )
);

export { batchRouter as fulfillmentBatchRoutes, returnRouter as shippingReturnRoutes };
