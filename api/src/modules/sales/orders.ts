import { Router } from "express";
import { z } from "zod";
import { checkCoupon } from "./coupons.js";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import type { OrderStatus } from "../../generated/prisma/enums.js";
import { applyMovementWithAlerts } from "../inventory/movementWithAlerts.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const itemSchema = z.object({
  productId: z.string().min(1),
  variantId: z.string().nullish(),
  quantity: z.coerce.number().positive("الكمية يجب أن تكون أكبر من صفر."),
  unitPrice: z.coerce.number().min(0).default(0),
  unitCost: z.coerce.number().min(0).default(0),
  itemDiscountPercentage: z.coerce.number().min(0).max(100).default(0),
  itemDiscountAmount: z.coerce.number().min(0).default(0),
  discountType: z.enum(["PERCENTAGE", "FIXED"]).default("PERCENTAGE"),
  needsManufacturing: z.boolean().default(false),
});

export const CreateOrderSchema = z.object({
  customerId: z.string().min(1, "العميل مطلوب."),
  type: z.enum(["SALE", "RETURN", "EXCHANGE"]).default("SALE"),
  orderSourceId: z.string().nullish(),
  paymentMethodId: z.string().nullish(),
  carrierId: z.string().nullish(),
  shippingGovernorateId: z.string().nullish(),
  cityId: z.string().nullish(),
  warehouseId: z.string().nullish(),
  cancelReasonId: z.string().nullish(),
  originalOrderId: z.string().nullish(),

  shippingCost: z.coerce.number().min(0).default(0),
  discountPercentage: z.coerce.number().min(0).max(100).default(0),
  // Coupon code — validated and applied on top of the per-order percentage.
  couponCode: z.string().trim().max(60).nullish(),
  detailedAddress: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(1000).nullish(),

  items: z.array(itemSchema).min(1, "يجب إضافة صنف واحد على الأقل."),
});

export const UpdateOrderSchema = CreateOrderSchema.partial().strict();

export const ChangeStatusSchema = z.object({
  status: z.enum([
    "NEW",
    "CONFIRMED",
    "POSTPONED",
    "CANCELLED",
    "NO_ANSWER",
    "DELIVERED",
    "RETURNED",
    "NOT_DELIVERED",
    "ON_THE_WAY",
    "RETURNED_TO_WAREHOUSE",
  ]),
  cancelReasonId: z.string().nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export const BulkStatusSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1, "يجب اختيار طلب واحد على الأقل."),
  status: ChangeStatusSchema.shape.status,
  cancelReasonId: z.string().nullish(),
});

export const OrderFilterSchema = z.object({
  status: z
    .enum([
      "NEW",
      "CONFIRMED",
      "POSTPONED",
      "CANCELLED",
      "NO_ANSWER",
      "DELIVERED",
      "RETURNED",
      "NOT_DELIVERED",
      "ON_THE_WAY",
      "RETURNED_TO_WAREHOUSE",
    ])
    .optional(),
  type: z.enum(["SALE", "RETURN", "EXCHANGE"]).optional(),
  customerId: z.string().trim().min(1).optional(),
  carrierId: z.string().trim().min(1).optional(),
  orderSourceId: z.string().trim().min(1).optional(),
  paymentMethodId: z.string().trim().min(1).optional(),
  warehouseId: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// Scalar columns only. Relations are loaded by loadOrderRelations() below,
// one query at a time — see the note there.
const LIST_SCALARS = {
  id: true,
  orderNumber: true,
  type: true,
  status: true,
  shippingCost: true,
  discountPercentage: true,
  couponCode: true,
  currencyCode: true,
  orderPrice: true,
  orderActualPrice: true,
  hasShortage: true,
  createdAt: true,
  confirmedAt: true,
  deliveredAt: true,
} as const;

/**
 * Loads an order's relations with one query each, strictly in sequence.
 *
 * Prisma fetches every relation with its own statement and issues them
 * CONCURRENTLY. On a transaction client — one connection — that is statements
 * racing, which pg warns about today and rejects on pg 9. Seven relations here
 * means seven simultaneous statements on one socket.
 *
 * Round-trips are unchanged: Prisma issues these same statements either way.
 * Only the timing differs, and sequential is the correct one.
 *
 * Returned as a plain lookup keyed by order id, so callers merge rather than
 * re-query.
 */
async function loadOrderRelations<T extends { id: string }>(
  tx: Db,
  orders: T[]
): Promise<Map<string, Record<string, unknown>>> {
  const ids = orders.map((o) => o.id);
  const merged = new Map<string, Record<string, unknown>>(ids.map((id) => [id, {}]));
  if (ids.length === 0) return merged;

  const idFilter = { id: { in: ids } } as const;
  const parts: { key: string; rows: { id: string }[] }[] = [
    { key: "customer", rows: await tx.order.findMany({ where: idFilter, select: { id: true, customer: { select: { id: true, name: true, phoneNumber1: true } } } }) },
    { key: "carrier", rows: await tx.order.findMany({ where: idFilter, select: { id: true, carrier: { select: { id: true, name: true } } } }) },
    { key: "orderSource", rows: await tx.order.findMany({ where: idFilter, select: { id: true, orderSource: { select: { id: true, name: true } } } }) },
    { key: "paymentMethod", rows: await tx.order.findMany({ where: idFilter, select: { id: true, paymentMethod: { select: { id: true, name: true } } } }) },
    { key: "city", rows: await tx.order.findMany({ where: idFilter, select: { id: true, city: { select: { id: true, name: true } } } }) },
    { key: "shippingGovernorate", rows: await tx.order.findMany({ where: idFilter, select: { id: true, shippingGovernorate: { select: { id: true, name: true } } } }) },
    { key: "warehouse", rows: await tx.order.findMany({ where: idFilter, select: { id: true, warehouse: { select: { id: true, name: true } } } }) },
    { key: "_count", rows: await tx.order.findMany({ where: idFilter, select: { id: true, _count: { select: { items: true } } } }) },
  ];

  for (const { key, rows } of parts) {
    for (const row of rows as never[]) {
      const r = row as { id: string } & Record<string, unknown>;
      merged.get(r.id)![key] = r[key];
    }
  }
  return merged;
}

const LIST_SELECT = { ...LIST_SCALARS } as const;

// Scalars only, for the same reason as LIST_SELECT: relations are loaded one
// query at a time by loadOrderRelations() / loadOrderDetailRelations().
const DETAIL_SCALARS = {
  ...LIST_SCALARS,
  externalId: true,
  externalNumber: true,
  detailedAddress: true,
  notes: true,
  cancelledAt: true,
  shippedAt: true,
  updatedAt: true,
} as const;

/**
 * The detail-only relations, one query each in sequence.
 *
 * `items` is loaded separately from its `product` relation: a nested relation
 * inside a list relation is still a second statement, and Prisma would run it
 * concurrently with the others. Two sequential queries keep the socket clean.
 */
async function loadOrderDetailRelations(
  tx: Db,
  orderId: string
): Promise<Record<string, unknown>> {
  const where = { id: orderId } as const;

  // The list relations first — detail must be a SUPERSET of list, or the
  // detail screen loses fields the list screen shows.
  const base = await loadOrderRelations(tx, [{ id: orderId }]);

  const cancelReason = await tx.order.findUnique({ where, select: { cancelReason: { select: { id: true, name: true } } } });
  const originalOrder = await tx.order.findUnique({ where, select: { originalOrder: { select: { id: true, orderNumber: true } } } });
  const derivedOrders = await tx.order.findUnique({ where, select: { derivedOrders: { select: { id: true, orderNumber: true, type: true, status: true } } } });
  const productionBatch = await tx.order.findUnique({ where, select: { productionBatch: { select: { id: true, batchNumber: true } } } });

  const lines = await tx.orderItem.findMany({
    where: { orderId },
    select: {
      id: true,
      quantity: true,
      confirmedQuantity: true,
      unitPrice: true,
      unitCost: true,
      itemDiscountPercentage: true,
      itemDiscountAmount: true,
      discountType: true,
      needsManufacturing: true,
    },
  });
  const lineIds = lines.map((l) => l.id);
  const products = lineIds.length
    ? await tx.orderItem.findMany({
        where: { id: { in: lineIds } },
        select: { id: true, product: { select: { id: true, name: true, skuCode: true, images: { where: { isPrimary: true }, take: 1, select: { imageUrl: true } } } } },
      })
    : [];
  const productById = new Map(products.map((r) => [r.id, r.product]));

  return {
    ...(base.get(orderId) ?? {}),
    cancelReason: cancelReason?.cancelReason ?? null,
    originalOrder: originalOrder?.originalOrder ?? null,
    derivedOrders: derivedOrders?.derivedOrders ?? [],
    productionBatch: productionBatch?.productionBatch ?? null,
    items: lines.map((l) => ({ ...l, product: productById.get(l.id) ?? null })),
  };
}

const DETAIL_SELECT = { ...DETAIL_SCALARS } as const;

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------


/**
 * Order totals are computed server-side and never trusted from the client.
 *
 * The line total applies the item discount first, then the order-level
 * percentage is applied to the sum plus shipping. The stored `orderPrice` is
 * the customer-facing figure; `orderActualPrice` is what is actually charged.
 */
function computeTotals(
  lines: { quantity: number; unitPrice: number; itemDiscountPercentage: number; itemDiscountAmount: number; discountType: string }[],
  shippingCost: number,
  discountPercentage: number
) {
  const lineTotals = lines.map((line) => {
    const gross = line.quantity * line.unitPrice;
    const discount =
      line.discountType === "PERCENTAGE"
        ? (gross * line.itemDiscountPercentage) / 100
        : Math.min(line.itemDiscountAmount, gross);
    return Math.max(0, gross - discount);
  });

  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const orderPrice = subtotal + shippingCost;
  const orderActualPrice = Math.max(0, orderPrice - (orderPrice * discountPercentage) / 100);

  return { lineTotals, subtotal, orderPrice, orderActualPrice };
}

/** Allocates the next order number from the company's own sequence. */
async function nextOrderNumber(tx: Db, companyId: string): Promise<string> {
  const settings = await tx.companySettings.upsert({
    where: { companyId },
    create: { companyId, orderPrefix: "ORD", orderNextNumber: 2 },
    update: { orderNextNumber: { increment: 1 } },
    select: { orderPrefix: true, orderNextNumber: true },
  });
  return `${settings.orderPrefix}-${String(settings.orderNextNumber - 1).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Stock commitment
// ---------------------------------------------------------------------------

/**
 * Commits stock for a confirmed order.
 *
 * Whether this happens at confirmation, at fulfilment or at shipping is a
 * company setting, so the same routine is called from whichever transition the
 * setting names. Goods leave the order's warehouse, or the company's default
 * one when the order does not name it.
 */
async function commitStock(
  tx: Db,
  order: { id: string; orderNumber: string; type?: string; warehouseId: string | null; companyId: string },
  items: { product: { id: string }; confirmedQuantity: unknown; quantity: unknown }[],
  actorId: string
): Promise<void> {
  const settings = await tx.companySettings.findUnique({
    where: { companyId: order.companyId },
    select: { stockCommitPoint: true },
  });
  if (settings?.stockCommitPoint !== "CONFIRMATION") return;

  let warehouseId = order.warehouseId;
  if (!warehouseId) {
    const fallback = await tx.warehouse.findFirst({
      where: { companyId: order.companyId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    warehouseId = fallback?.id ?? null;
  }
  if (!warehouseId) return;

  // Pick the warehouse's OLDEST active location (the primary stock room) —
  // ordering by code would silently redirect commits to whichever location
  // sorts first alphabetically, draining a different bin than users adjust.
  const location = await tx.storageLocation.findFirst({
    where: { warehouseId, companyId: order.companyId, isActive: true, deletedAt: null, parentId: null },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true },
  });
  if (!location) return;

  for (const item of items) {
    const quantity = Number(item.confirmedQuantity ?? item.quantity ?? 0);
    if (quantity <= 0) continue;

    // A RETURN order brings goods back into the warehouse; SALE/EXCHANGE take
    // them out. The movement type mirrors the direction so reports can tell
    // restocks from sales apart.
    const isReturn = order.type === "RETURN";
    await applyMovementWithAlerts(
      tx,
      { companyId: order.companyId, actorId },
      {
        productId: item.product.id,
        storageLocationId: location.id,
        quantity: isReturn ? quantity : -quantity,
        type: isReturn ? "RETURN_IN" : "SALE",
        reason: `طلب ${order.orderNumber}`,
        referenceType: "Order",
        referenceId: order.id,
        referenceNumber: order.orderNumber,
      }
    );
  }
}

/** Puts stock back when an order is cancelled or returned. */
async function releaseStock(
  tx: Db,
  order: {
    id: string;
    orderNumber: string;
    type?: string;
    companyId: string;
    warehouseId: string | null;
    confirmedAt: Date | null;
  },
  items: { product: { id: string }; confirmedQuantity: unknown; quantity: unknown }[],
  actorId: string
): Promise<void> {
  // Only reverse what was actually committed.
  if (!order.confirmedAt) return;

  const settings = await tx.companySettings.findUnique({
    where: { companyId: order.companyId },
    select: { stockCommitPoint: true },
  });
  if (settings?.stockCommitPoint !== "CONFIRMATION") return;

  let warehouseId = order.warehouseId;
  if (!warehouseId) {
    const fallback = await tx.warehouse.findFirst({
      where: { companyId: order.companyId, isDefault: true, deletedAt: null },
      select: { id: true },
    });
    warehouseId = fallback?.id ?? null;
  }
  if (!warehouseId) return;

  // Pick the warehouse's OLDEST active location (the primary stock room) —
  // ordering by code would silently redirect commits to whichever location
  // sorts first alphabetically, draining a different bin than users adjust.
  const location = await tx.storageLocation.findFirst({
    where: { warehouseId, companyId: order.companyId, isActive: true, deletedAt: null, parentId: null },
    orderBy: [{ createdAt: "asc" }],
    select: { id: true },
  });
  if (!location) return;

  for (const item of items) {
    const quantity = Number(item.confirmedQuantity ?? item.quantity ?? 0);
    if (quantity <= 0) continue;

    // Cancelling a RETURN order takes back the stock it restocked on confirm.
    const wasReturn = order.type === "RETURN";
    await applyMovementWithAlerts(
      tx,
      { companyId: order.companyId, actorId },
      {
        productId: item.product.id,
        storageLocationId: location.id,
        quantity: wasReturn ? -quantity : quantity,
        type: wasReturn ? "SALE" : "RETURN_IN",
        reason: wasReturn ? `إلغاء إرجاع طلب ${order.orderNumber}` : `إرجاع طلب ${order.orderNumber}`,
        referenceType: "Order",
        referenceId: order.id,
        referenceNumber: order.orderNumber,
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();
const STOCK_REVERSING: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  "CANCELLED",
  "RETURNED",
  "RETURNED_TO_WAREHOUSE",
]);

router.get(
  "/",
  requirePermission(Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = OrderFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.customerId ? { customerId: filter.customerId } : {}),
        ...(filter.carrierId ? { carrierId: filter.carrierId } : {}),
        ...(filter.orderSourceId ? { orderSourceId: filter.orderSourceId } : {}),
        ...(filter.paymentMethodId ? { paymentMethodId: filter.paymentMethodId } : {}),
        ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
        ...(filter.from || filter.to
          ? {
              createdAt: {
                ...(filter.from ? { gte: filter.from } : {}),
                ...(filter.to ? { lte: filter.to } : {}),
              },
            }
          : {}),
        ...searchFilter(["orderNumber", "notes", "detailedAddress"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.order.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "orderNumber", "orderActualPrice", "status"], "createdAt"),
        ...pageSlice(input),
        select: LIST_SELECT,
      });
      const total = await tx.order.count({ where });

      // Relations, one query each, merged by id. See loadOrderRelations().
      const relations = await loadOrderRelations(tx, items);
      const rows = items.map((o) => ({ ...o, ...(relations.get(o.id) ?? {}) }));

      return toPage(rows, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewOrders),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const orderScalars = await tx.order.findFirst({
        where: { id: param(req, "id"), companyId: req.ctx.companyId!, deletedAt: null },
        select: DETAIL_SELECT,
      });
      if (!orderScalars) throw new NotFoundError("الطلب غير موجود.");

      // Relations, one sequential query each — see loadOrderDetailRelations().
      const order = { ...orderScalars, ...(await loadOrderDetailRelations(tx, orderScalars.id)) } as typeof orderScalars & {
        items: { id: string; quantity: unknown; unitPrice: unknown; itemDiscountPercentage: unknown; itemDiscountAmount: unknown; discountType: string; product: { id: string; name: string; skuCode: string | null; images: { imageUrl: string }[] } | null }[];
      };

      const { items, ...rest } = order;
      return {
        ...rest,
        items: items.map((item) => {
          const gross = Number(item.quantity) * Number(item.unitPrice);
          const discount =
            item.discountType === "PERCENTAGE"
              ? (gross * Number(item.itemDiscountPercentage)) / 100
              : Number(item.itemDiscountAmount);
          return { ...item, lineTotal: Math.max(0, gross - discount) };
        }),
      };
    })
  )
);

router.get(
  "/:id/invoice",
  requirePermission(Permissions.ViewOrders),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      // Scalars first, then each relation as its own sequential query. Three
      // relations in one select would be three concurrent statements on this
      // transaction's single connection.
      const orderScalars = await tx.order.findFirst({
        where: { id: param(req, "id"), companyId: req.ctx.companyId!, deletedAt: null },
        select: {
          id: true, orderNumber: true, type: true, status: true,
          createdAt: true, currencyCode: true,
          orderPrice: true, orderActualPrice: true, shippingCost: true,
          discountPercentage: true, couponCode: true, notes: true,
        },
      });
      if (!orderScalars) throw new NotFoundError("الطلب غير موجود.");

      const invoiceCustomer = await tx.order.findUnique({
        where: { id: orderScalars.id },
        select: { customer: { select: { name: true, phoneNumber1: true, email: true } } },
      });
      const invoiceWarehouse = await tx.order.findUnique({
        where: { id: orderScalars.id },
        select: { warehouse: { select: { name: true } } },
      });
      const invoiceLines = await tx.orderItem.findMany({
        where: { orderId: orderScalars.id },
        select: {
          id: true, quantity: true, unitPrice: true,
          itemDiscountPercentage: true, itemDiscountAmount: true, discountType: true,
        },
      });
      const invoiceLineIds = invoiceLines.map((l) => l.id);
      const invoiceProducts = invoiceLineIds.length
        ? await tx.orderItem.findMany({
            where: { id: { in: invoiceLineIds } },
            select: { id: true, product: { select: { name: true, skuCode: true } } },
          })
        : [];
      const invoiceProductById = new Map(invoiceProducts.map((r) => [r.id, r.product]));

      const order = {
        ...orderScalars,
        customer: invoiceCustomer?.customer ?? null,
        warehouse: invoiceWarehouse?.warehouse ?? null,
        items: invoiceLines.map((l) => ({ ...l, product: invoiceProductById.get(l.id) ?? null })),
      };

      // Company header block for the printable sheet.
      const company = await tx.company.findUnique({
        where: { id: req.ctx.companyId! },
        select: { name: true, email: true, phoneNumber: true, addressLine: true },
      });

      const items = order.items.map((item) => {
        const gross = Number(item.quantity) * Number(item.unitPrice);
        const discount =
          item.discountType === "PERCENTAGE"
            ? (gross * Number(item.itemDiscountPercentage)) / 100
            : Number(item.itemDiscountAmount);
        return {
          productName: item.product?.name ?? null,
          skuCode: item.product?.skuCode ?? null,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          discount: Math.max(0, discount),
          lineTotal: Math.max(0, gross - discount),
        };
      });

      const subtotal = items.reduce((sum, i) => sum + i.lineTotal, 0);
      return {
        company: {
          name: company?.name ?? "",
          email: company?.email ?? null,
          phoneNumber: company?.phoneNumber ?? null,
          address: company?.addressLine ?? null,
        },
        invoice: {
          orderNumber: order.orderNumber,
          date: order.createdAt,
          status: order.status,
          currency: order.currencyCode,
          customerName: order.customer?.name ?? null,
          customerPhone: order.customer?.phoneNumber1 ?? null,
          customerEmail: order.customer?.email ?? null,
          warehouseName: order.warehouse?.name ?? null,
          couponCode: order.couponCode,
          subtotal,
          shippingCost: Number(order.shippingCost),
          discountPercentage: Number(order.discountPercentage),
          // Percentage discount amount implied by the stored totals.
          discountAmount: Math.max(0, Number(order.orderPrice) - Number(order.shippingCost) - subtotal),
          total: Number(order.orderActualPrice),
        },
        items,
      };
    })
  )
);

router.post(
  "/",
  requirePermission(Permissions.CreateOrder),
  route(
    async (req: AuthedRequest) => {
      const data = CreateOrderSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const customer = await tx.customer.findFirst({
          where: { id: data.customerId, companyId, deletedAt: null },
          select: { id: true, name: true },
        });
        if (!customer) throw new BadRequestError("العميل غير موجود.");

        const productIds = [...new Set(data.items.map((i) => i.productId))];
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, companyId, deletedAt: null },
          select: { id: true, price: true, costPrice: true, name: true },
        });
        if (products.length !== productIds.length) {
          throw new BadRequestError("أحد المنتجات غير موجود في هذه الشركة.");
        }

        const priceById = new Map(products.map((p) => [p.id, p]));
        // Preliminary totals (without coupon) to validate the coupon floor
        // against, then final totals with the coupon's contribution.
        const baseTotals = computeTotals(
          data.items.map((item) => ({
            quantity: item.quantity,
            unitPrice: item.unitPrice || Number(priceById.get(item.productId)?.price ?? 0),
            itemDiscountPercentage: item.itemDiscountPercentage,
            itemDiscountAmount: item.itemDiscountAmount,
            discountType: item.discountType,
          })),
          data.shippingCost,
          data.discountPercentage
        );

        // Coupon: validate against the post-percentage total, then apply as a
        // final fixed reduction (PERCENTAGE coupons are converted to an exact
        // amount here so the coupon row stays the single source of truth).
        let couponId: string | null = null;
        let couponCodeSnapshot: string | null = null;
        let couponFixedDiscount = 0;
        if (data.couponCode) {
          const check = await checkCoupon(
            tx,
            companyId,
            data.couponCode,
            baseTotals.orderActualPrice
          );
          if (!check.valid) throw new BadRequestError(check.reason ?? "رمز الخصم غير صالح.");
          couponId = check.couponId ?? null;
          couponCodeSnapshot = check.code ?? null;
          couponFixedDiscount = check.discountAmount ?? 0;
        }

        const totals =
          couponFixedDiscount > 0
            ? {
                ...baseTotals,
                orderActualPrice: Math.max(
                  0,
                  baseTotals.orderActualPrice - couponFixedDiscount
                ),
              }
            : baseTotals;

        const created = await tx.order.create({
          data: {
            companyId,
            orderNumber: await nextOrderNumber(tx, companyId),
            type: data.type,
            status: "NEW",
            createdById: req.ctx.userId,
            customerId: data.customerId,
            orderSourceId: data.orderSourceId ?? null,
            paymentMethodId: data.paymentMethodId ?? null,
            carrierId: data.carrierId ?? null,
            shippingGovernorateId: data.shippingGovernorateId ?? null,
            cityId: data.cityId ?? null,
            warehouseId: data.warehouseId ?? null,
            cancelReasonId: data.cancelReasonId ?? null,
            originalOrderId: data.originalOrderId ?? null,
            shippingCost: data.shippingCost,
            discountPercentage: data.discountPercentage,
            couponId,
            couponCode: couponCodeSnapshot,
            orderPrice: totals.orderPrice,
            orderActualPrice: totals.orderActualPrice,
            detailedAddress: data.detailedAddress ?? null,
            notes: data.notes ?? null,
            items: {
              create: data.items.map((item) => ({
                companyId,
                productId: item.productId,
                quantity: item.quantity,
                confirmedQuantity: item.quantity,
                unitPrice: item.unitPrice || Number(priceById.get(item.productId)?.price ?? 0),
                unitCost: item.unitCost || Number(priceById.get(item.productId)?.costPrice ?? 0),
                itemDiscountPercentage: item.itemDiscountPercentage,
                itemDiscountAmount: item.itemDiscountAmount,
                discountType: item.discountType,
                needsManufacturing: item.needsManufacturing,
              })),
            },
          },
          select: DETAIL_SELECT,
        });

        await audit(tx, {
          action: "order.created",
          entity: "Order",
          entityId: created.id,
          summary: `تم إنشاء الطلب ${created.orderNumber} للعميل ${customer.name}.`,
        });

        // Consume the coupon only after the order row is real: increment the
        // redemption counter (the max cap was validated in checkCoupon).
        if (couponId) {
          await tx.coupon.update({
            where: { id: couponId },
            data: { redemptionCount: { increment: 1 } },
          });
        }

        return created;
      });
    },
    { status: 201, message: "تم إنشاء الطلب بنجاح." }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.UpdateOrder),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = UpdateOrderSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const order = await tx.order.findFirst({
          where: { id, companyId, deletedAt: null },
          select: { id: true, status: true },
        });
        if (!order) throw new NotFoundError("الطلب غير موجود.");

        if (order.status === "DELIVERED" || order.status === "CANCELLED") {
          throw new ConflictError("لا يمكن تعديل طلب تم تسليمه أو إلغاؤه.");
        }

        const items = data.items;
        let totals: ReturnType<typeof computeTotals> | undefined;

        if (items) {
          totals = computeTotals(items, data.shippingCost ?? 0, data.discountPercentage ?? 0);
        } else if (data.shippingCost !== undefined || data.discountPercentage !== undefined) {
          const current = await tx.orderItem.findMany({
            where: { orderId: id },
            select: {
              quantity: true,
              unitPrice: true,
              itemDiscountPercentage: true,
              itemDiscountAmount: true,
              discountType: true,
            },
          });
          totals = computeTotals(
            current.map((item) => ({
              quantity: Number(item.quantity),
              unitPrice: Number(item.unitPrice),
              itemDiscountPercentage: Number(item.itemDiscountPercentage),
              itemDiscountAmount: Number(item.itemDiscountAmount),
              discountType: item.discountType,
            })),
            data.shippingCost ?? 0,
            data.discountPercentage ?? 0
          );
        }

        const updated = await tx.order.update({
          where: { id },
          data: {
            type: data.type,
            orderSourceId: data.orderSourceId,
            paymentMethodId: data.paymentMethodId,
            carrierId: data.carrierId,
            shippingGovernorateId: data.shippingGovernorateId,
            cityId: data.cityId,
            warehouseId: data.warehouseId,
            detailedAddress: data.detailedAddress,
            notes: data.notes,
            shippingCost: data.shippingCost,
            discountPercentage: data.discountPercentage,
            orderPrice: totals?.orderPrice,
            orderActualPrice: totals?.orderActualPrice,
            items:
              items === undefined
                ? undefined
                : {
                    deleteMany: {},
                    create: items.map((item) => ({
                      companyId,
                      productId: item.productId,
                      quantity: item.quantity,
                      confirmedQuantity: item.quantity,
                      unitPrice: item.unitPrice,
                      unitCost: item.unitCost,
                      itemDiscountPercentage: item.itemDiscountPercentage,
                      itemDiscountAmount: item.itemDiscountAmount,
                      discountType: item.discountType,
                      needsManufacturing: item.needsManufacturing,
                    })),
                  },
          },
          select: DETAIL_SELECT,
        });

        await audit(tx, {
          action: "order.updated",
          entity: "Order",
          entityId: id,
          summary: `تم تحديث الطلب ${updated.orderNumber}.`,
          changes: data,
        });

        return updated;
      });
    },
    { message: "تم تحديث الطلب بنجاح." }
  )
);

/**
 * Moves an order through its pipeline.
 *
 * Confirmation and the terminal states carry stock consequences, so the
 * transition is a single endpoint rather than a generic patch — otherwise a
 * client could set `status: DELIVERED` without the goods ever leaving stock.
 */
router.post(
  "/bulk/status",
  requirePermission(Permissions.UpdateOrder),
  route(async (req: AuthedRequest) => {
    const { orderIds, status, cancelReasonId } = BulkStatusSchema.parse(req.body);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const orders = await tx.order.findMany({
        where: { id: { in: orderIds }, companyId, deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          type: true,
          status: true,
          warehouseId: true,
          confirmedAt: true,
          items: {
            select: { quantity: true, confirmedQuantity: true, product: { select: { id: true } } },
          },
        },
      });

      if (orders.length !== orderIds.length) {
        throw new BadRequestError("بعض الطلبات غير موجودة.");
      }

      if (status === "CANCELLED" && !cancelReasonId) {
        throw new BadRequestError("يجب تحديد سبب الإلغاء.");
      }

      let changed = 0;
      for (const order of orders) {
        if (order.status === status || order.status === "CANCELLED") continue;

        await tx.order.update({
          where: { id: order.id },
          data: {
            status,
            cancelReasonId: status === "CANCELLED" ? (cancelReasonId ?? null) : undefined,
            confirmedAt: status === "CONFIRMED" ? new Date() : undefined,
            deliveredAt: status === "DELIVERED" ? new Date() : undefined,
            cancelledAt: status === "CANCELLED" ? new Date() : undefined,
            shippedAt: status === "ON_THE_WAY" ? new Date() : undefined,
          },
        });

        const ctxOrder = { ...order, companyId };
        if (status === "CONFIRMED") {
          await commitStock(tx, ctxOrder, order.items, req.ctx.userId);
        } else if (STOCK_REVERSING.has(status)) {
          await releaseStock(tx, ctxOrder, order.items, req.ctx.userId);
        }

        changed += 1;
      }

      await audit(tx, {
        action: "order.bulkStatus",
        entity: "Order",
        summary: `تم تحديث حالة ${changed} طلب إلى ${status}.`,
        changes: { orderIds, status },
      });

      return { requested: orderIds.length, changed };
    });
  })
);

router.post(
  "/:id/status",
  requirePermission(Permissions.UpdateOrder),
  route(async (req: AuthedRequest) => {
    const id = param(req, "id");
    const { status, cancelReasonId, notes } = ChangeStatusSchema.parse(req.body);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const order = await tx.order.findFirst({
        where: { id, companyId, deletedAt: null },
        select: {
          id: true,
          orderNumber: true,
          type: true,
          status: true,
          warehouseId: true,
          confirmedAt: true,
          items: {
            select: {
              quantity: true,
              confirmedQuantity: true,
              product: { select: { id: true } },
            },
          },
        },
      });
      if (!order) throw new NotFoundError("الطلب غير موجود.");

      if (order.status === status) {
        throw new ConflictError("الطلب في هذه الحالة بالفعل.");
      }
      if (order.status === "CANCELLED") {
        throw new ConflictError("لا يمكن تغيير حالة طلب ملغى.");
      }

      // DELIVERED is terminal: the goods are out, the revenue is booked, and
      // the only sanctioned exits (RETURNED / RETURNED_TO_WAREHOUSE) come from
      // the returns flow, not this endpoint. Reopening or cancelling here
      // would restock goods the customer already has and erase booked revenue.
      if (order.status === "DELIVERED") {
        throw new ConflictError("لا يمكن تغيير حالة طلب تم تسليمه. استخدم شاشة المرتجعات.");
      }

      if (status === "CANCELLED" && !cancelReasonId) {
        throw new BadRequestError("يجب تحديد سبب الإلغاء.");
      }

      const now = new Date();
      const timestamps = {
        confirmedAt: status === "CONFIRMED" ? now : undefined,
        shippedAt: status === "ON_THE_WAY" ? now : undefined,
        deliveredAt: status === "DELIVERED" ? now : undefined,
        cancelledAt: status === "CANCELLED" ? now : undefined,
      };

      const updated = await tx.order.update({
        where: { id },
        data: {
          status,
          cancelReasonId: status === "CANCELLED" ? (cancelReasonId ?? null) : undefined,
          notes: notes ?? undefined,
          ...timestamps,
        },
        select: DETAIL_SELECT,
      });

      const ctxOrder = { ...order, companyId };

      if (status === "CONFIRMED") {
        // A stock-tracked order without a warehouse can never commit or
        // release stock — confirming it would book the sale while inventory
        // silently stays put. Fail loudly instead of skipping.
        const needsStock = await tx.product.count({
          where: { id: { in: order.items.map((i) => i.product.id) }, trackStock: true, deletedAt: null },
        });
        if (needsStock > 0 && !order.warehouseId) {
          throw new BadRequestError(
            "لا يمكن تأكيد طلب يحتوي أصنافاً متتبعة للمخزون بدون تحديد مستودع الصرف."
          );
        }
        if (order.warehouseId) {
          await commitStock(tx, ctxOrder, order.items, req.ctx.userId);
        }
      } else if (STOCK_REVERSING.has(status)) {
        await releaseStock(tx, ctxOrder, order.items, req.ctx.userId);
      }

      await audit(tx, {
        action: `order.status.${status.toLowerCase()}`,
        entity: "Order",
        entityId: id,
        summary: `تم تغيير حالة الطلب ${order.orderNumber} إلى ${status}.`,
        changes: { from: order.status, to: status },
      });

      return updated;
    });
  })
);

router.delete(
  "/:id",
  requirePermission(Permissions.DeleteOrder),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const order = await tx.order.findFirst({
        where: { id, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, orderNumber: true, status: true },
      });
      if (!order) throw new NotFoundError("الطلب غير موجود.");

      if (order.status === "DELIVERED") {
        throw new ConflictError("لا يمكن حذف طلب تم تسليمه.");
      }

      await tx.order.update({ where: { id }, data: { deletedAt: new Date() } });

      await audit(tx, {
        action: "order.deleted",
        entity: "Order",
        entityId: id,
        summary: `تم حذف الطلب ${order.orderNumber}.`,
      });

      return null;
    })
  )
);

export { router as orderRoutes };
