import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import type { Db } from "../../config/database.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// ---------------------------------------------------------------------------
// Coupons — company-level discount codes redeemable at order creation.
// ---------------------------------------------------------------------------

export const CouponInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, "رمز الخصم مطلوب.")
      .max(60)
      .transform((v) => v.toUpperCase()),
    discountType: z.enum(["PERCENTAGE", "FIXED"]).default("PERCENTAGE"),
    value: z.coerce.number().min(0, "قيمة الخصم غير صالحة."),
    minOrderTotal: z.coerce.number().min(0).optional().nullable(),
    maxRedemptions: z.coerce.number().int().min(1).optional().nullable(),
    expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
    isActive: z.boolean().default(true),
  })
  .superRefine((val, ctx) => {
    if (val.discountType === "PERCENTAGE" && val.value > 100) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "نسبة الخصم لا يمكن أن تتجاوز 100%." });
    }
    if (val.discountType === "FIXED" && val.value <= 0) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "أدخل مبلغ الخصم." });
    }
  });

const SELECT = {
  id: true,
  code: true,
  discountType: true,
  value: true,
  minOrderTotal: true,
  maxRedemptions: true,
  redemptionCount: true,
  expiresAt: true,
  isActive: true,
  createdAt: true,
  _count: { select: { orders: true } },
} as const;

export const couponRoutes = Router();

couponRoutes.get(
  "/",
  requirePermission(Permissions.ViewOrders, Permissions.ViewStores),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const status = req.query.status as string | undefined;

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        ...notDeleted(false),
        ...(status === "active" ? { isActive: true } : {}),
        ...(status === "inactive" ? { isActive: false } : {}),
        ...searchFilter(["code"], input.search),
      };
      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.coupon.findMany({
        where,
        orderBy: orderBy(input, ["code", "createdAt"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.coupon.count({ where });
      return toPage(items, total, input);
    });
  })
);

couponRoutes.post(
  "/",
  requirePermission(Permissions.ViewOrders, Permissions.ManageStores),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const input = CouponInputSchema.parse(req.body);

      const clash = await tx.coupon.findFirst({
        where: { companyId: req.ctx.companyId!, code: input.code, deletedAt: null },
        select: { id: true },
      });
      if (clash) throw new ConflictError("رمز الخصم مستخدم بالفعل.");

      const coupon = await tx.coupon.create({
        data: {
          companyId: req.ctx.companyId!,
          code: input.code,
          discountType: input.discountType,
          value: input.value,
          minOrderTotal: input.minOrderTotal ?? null,
          maxRedemptions: input.maxRedemptions ?? null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          isActive: input.isActive,
        },
        select: SELECT,
      });

      await audit(tx, {
        action: "coupon.created",
        entity: "Coupon",
        entityId: coupon.id,
        summary: `تم إنشاء رمز الخصم ${coupon.code}.`,
      });
      return coupon;
    })
  )
);

couponRoutes.patch(
  "/:id",
  requirePermission(Permissions.ManageStores),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      // zod v4: .partial()/.omit() throw on schemas containing superRefine —
      // build the patch shape from the base object instead (no refinement).
      const CouponPatchSchema = z
        .object({
          code: z.string().trim().min(1).max(60).optional(),
          discountType: z.enum(["PERCENTAGE", "FIXED"]).optional(),
          value: z.coerce.number().min(0).optional(),
          minOrderTotal: z.coerce.number().min(0).optional().nullable(),
          maxRedemptions: z.coerce.number().int().min(1).optional().nullable(),
          expiresAt: z.string().datetime({ offset: true }).optional().nullable(),
          isActive: z.boolean().optional(),
        })
        .strict();
      const input = CouponPatchSchema.parse(req.body);

      const existing = await tx.coupon.findFirst({
        where: { id, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, code: true },
      });
      if (!existing) throw new NotFoundError("رمز الخصم غير موجود.");

      if (input.code && input.code !== existing.code) {
        const clash = await tx.coupon.findFirst({
          where: { companyId: req.ctx.companyId!, code: input.code, deletedAt: null, id: { not: id } },
          select: { id: true },
        });
        if (clash) throw new ConflictError("رمز الخصم مستخدم بالفعل.");
      }

      const coupon = await tx.coupon.update({
        where: { id },
        data: {
          ...(input.code ? { code: input.code } : {}),
          ...(input.discountType !== undefined ? { discountType: input.discountType } : {}),
          ...(input.value !== undefined ? { value: input.value } : {}),
          ...(input.minOrderTotal !== undefined ? { minOrderTotal: input.minOrderTotal } : {}),
          ...(input.maxRedemptions !== undefined ? { maxRedemptions: input.maxRedemptions } : {}),
          ...(input.expiresAt !== undefined
            ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        select: SELECT,
      });

      await audit(tx, {
        action: "coupon.updated",
        entity: "Coupon",
        entityId: id,
        summary: `تم تحديث رمز الخصم ${coupon.code}.`,
      });
      return coupon;
    })
  )
);

couponRoutes.delete(
  "/:id",
  requirePermission(Permissions.ManageStores),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const existing = await tx.coupon.findFirst({
        where: { id, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, code: true },
      });
      if (!existing) throw new NotFoundError("رمز الخصم غير موجود.");

      await tx.coupon.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });

      await audit(tx, {
        action: "coupon.deleted",
        entity: "Coupon",
        entityId: id,
        summary: `تم حذف رمز الخصم ${existing.code}.`,
      });
      return null;
    })
  )
);

// Redeem check: validates a code against the current cart total without
// consuming it — the order-create path applies the actual discount.
couponRoutes.post(
  "/redeem",
  requirePermission(Permissions.ViewOrders, Permissions.ViewStores),
  route(async (req: AuthedRequest) => {
    const body = z
      .object({
        code: z.string().trim().min(1).max(60),
        orderTotal: z.coerce.number().min(0),
      })
      .parse(req.body);

    return scoped(req, async (tx) => {
      const result = await checkCoupon(tx, req.ctx.companyId!, body.code, body.orderTotal);
      if (!result.valid) throw new BadRequestError(result.reason!);
      return result;
    });
  })
);

export interface CouponCheckResult {
  valid: boolean;
  reason?: string;
  couponId?: string;
  code?: string;
  discountType?: "PERCENTAGE" | "FIXED";
  discountAmount?: number;
}

// Shared with the order-create path. Pure validation — no redemption count
// mutation; that happens transactionally when the order is actually created.
export async function checkCoupon(
  tx: Db,
  companyId: string,
  rawCode: string,
  orderTotal: number
): Promise<CouponCheckResult> {
  const code = rawCode.trim().toUpperCase();
  const coupon = await tx.coupon.findFirst({
    where: { companyId, code, deletedAt: null },
    select: {
      id: true, code: true, discountType: true, value: true,
      minOrderTotal: true, maxRedemptions: true, redemptionCount: true,
      expiresAt: true, isActive: true,
    },
  });
  if (!coupon) return { valid: false, reason: "رمز الخصم غير صالح." };
  if (!coupon.isActive) return { valid: false, reason: "رمز الخصم غير مفعّل." };
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
    return { valid: false, reason: "رمز الخصم منتهي الصلاحية." };
  }
  if (coupon.maxRedemptions !== null && coupon.redemptionCount >= coupon.maxRedemptions) {
    return { valid: false, reason: "تم استهلاك عدد مرات استخدام رمز الخصم." };
  }
  if (coupon.minOrderTotal !== null && orderTotal < Number(coupon.minOrderTotal)) {
    return { valid: false, reason: `الحد الأدنى للطلب لاستخدام هذا الرمز ${Number(coupon.minOrderTotal)}.` };
  }
  const discountAmount =
    coupon.discountType === "PERCENTAGE"
      ? (orderTotal * Number(coupon.value)) / 100
      : Number(coupon.value);
  return {
    valid: true,
    couponId: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountAmount: Math.min(discountAmount, orderTotal),
  };
}

