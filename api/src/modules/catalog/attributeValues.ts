import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { searchFilter } from "../../shared/query.js";

// Values live under their attribute, so this is a nested router rather than a
// top-level resource. It is mounted at /catalog/attributes/:attributeId/values.

export const CreateAttributeValueSchema = z.object({
  value: z.string().trim().min(1, "القيمة مطلوبة.").max(255),
  colorHex: z
    .string()
    .trim()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "كود اللون غير صالح.")
    .nullish(),
  skuSuffix: z.string().trim().max(100).nullish(),
  barcode: z.string().trim().max(100).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const UpdateAttributeValueSchema = CreateAttributeValueSchema.partial().strict();

const SELECT = {
  id: true,
  attributeId: true,
  value: true,
  colorHex: true,
  skuSuffix: true,
  barcode: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
} as const;

const router = Router({ mergeParams: true });

/** Resolves the attribute first: every value belongs to one, and it must be ours. */
async function requireAttribute(req: AuthedRequest, attributeId: string) {
  return scoped(req, async (tx) => {
    const attribute = await tx.productAttribute.findFirst({
      where: { id: attributeId, companyId: req.ctx.companyId!, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!attribute) throw new NotFoundError("الخاصية غير موجودة.");
    return attribute;
  });
}

router.get(
  "/",
  requirePermission(Permissions.ViewProducts),
  route(async (req: AuthedRequest) => {
    const attributeId = param(req, "attributeId");
    await requireAttribute(req, attributeId);

    return scoped(req, async (tx) =>
      tx.productAttributeValue.findMany({
        where: {
          attributeId,
          companyId: req.ctx.companyId!,
          deletedAt: null,
          ...searchFilter(["value"], typeof req.query.search === "string" ? req.query.search : undefined),
        },
        orderBy: [{ sortOrder: "asc" }, { value: "asc" }],
        select: SELECT,
      })
    );
  })
);

router.post(
  "/",
  requirePermission(Permissions.CreateProduct, Permissions.UpdateProduct),
  route(
    async (req: AuthedRequest) => {
      const attributeId = param(req, "attributeId");
      const data = CreateAttributeValueSchema.parse(req.body);

      return scoped(req, async (tx) => {
        await requireAttribute(req, attributeId);

        // Unique per attribute, not per company — two attributes may both have
        // a "Large" without clashing.
        const clash = await tx.productAttributeValue.findFirst({
          where: { attributeId, value: data.value, deletedAt: null },
          select: { id: true },
        });
        if (clash) throw new ConflictError("توجد قيمة بنفس الاسم لهذه الخاصية.");

        const created = await tx.productAttributeValue.create({
          data: {
            companyId: req.ctx.companyId!,
            attributeId,
            value: data.value,
            colorHex: data.colorHex ?? null,
            skuSuffix: data.skuSuffix ?? null,
            barcode: data.barcode ?? null,
            sortOrder: data.sortOrder,
            isActive: data.isActive,
          },
          select: SELECT,
        });

        await audit(tx, {
          action: "productAttributeValue.created",
          entity: "ProductAttributeValue",
          entityId: created.id,
          summary: `تم إضافة القيمة ${created.value}.`,
        });

        return created;
      });
    },
    { status: 201, message: "تمت الإضافة بنجاح." }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.CreateProduct, Permissions.UpdateProduct),
  route(
    async (req: AuthedRequest) => {
      const attributeId = param(req, "attributeId");
      const id = param(req, "id");
      const data = UpdateAttributeValueSchema.parse(req.body);

      return scoped(req, async (tx) => {
        await requireAttribute(req, attributeId);

        const existing = await tx.productAttributeValue.findFirst({
          where: { id, attributeId, companyId: req.ctx.companyId!, deletedAt: null },
          select: { id: true },
        });
        if (!existing) throw new NotFoundError("القيمة غير موجودة.");

        const updated = await tx.productAttributeValue.update({
          where: { id },
          data: {
            value: data.value,
            colorHex: data.colorHex,
            skuSuffix: data.skuSuffix,
            barcode: data.barcode,
            sortOrder: data.sortOrder,
            isActive: data.isActive,
          },
          select: SELECT,
        });

        await audit(tx, {
          action: "productAttributeValue.updated",
          entity: "ProductAttributeValue",
          entityId: id,
          summary: `تم تحديث القيمة ${updated.value}.`,
          changes: data,
        });

        return updated;
      });
    },
    { message: "تم التحديث بنجاح." }
  )
);

router.delete(
  "/:id",
  requirePermission(Permissions.CreateProduct, Permissions.UpdateProduct),
  route(async (req: AuthedRequest) => {
    const attributeId = param(req, "attributeId");
    const id = param(req, "id");

    return scoped(req, async (tx) => {
      await requireAttribute(req, attributeId);

      const existing = await tx.productAttributeValue.findFirst({
        where: { id, attributeId, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, value: true },
      });
      if (!existing) throw new NotFoundError("القيمة غير موجودة.");

      await tx.productAttributeValue.update({ where: { id }, data: { deletedAt: new Date() } });

      await audit(tx, {
        action: "productAttributeValue.deleted",
        entity: "ProductAttributeValue",
        entityId: id,
        summary: `تم حذف القيمة ${existing.value}.`,
      });

      return null;
    });
  })
);

export { router as attributeValueRoutes };
