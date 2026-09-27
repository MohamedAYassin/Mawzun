import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// Cities are always reached through their governorate, so the router is
// mounted with `mergeParams` and every query carries the parent id. That makes
// a cross-company or cross-governorate read structurally impossible rather
// than something each handler has to remember to filter on.

export const CreateCitySchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  code: z.string().trim().max(20).nullish(),
  shippingCost: z.coerce.number().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const UpdateCitySchema = CreateCitySchema.partial().strict();

export const CityFilterSchema = z.object({
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const SELECT = {
  id: true,
  name: true,
  code: true,
  shippingCost: true,
  isActive: true,
  governorateId: true,
  createdAt: true,
  governorate: { select: { id: true, name: true, shippingCost: true } },
} as const;

/** Confirms the parent governorate belongs to this company. */
async function assertGovernorate(tx: Db, companyId: string, governorateId: string) {
  const found = await tx.governorate.count({
    where: { id: governorateId, companyId, deletedAt: null },
  });
  if (found === 0) throw new NotFoundError("المحافظة غير موجودة.");
}

const router = Router({ mergeParams: true });
router.get(
  "/",
  requirePermission(Permissions.ViewCarriers, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = CityFilterSchema.parse(req.query);
    const governorateId = param(req, "governorateId");

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        governorateId,
        ...notDeleted(input.includeDeleted),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["name", "code"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.city.findMany({
        where,
        orderBy: orderBy(input, ["name", "shippingCost", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.city.count({ where });
      return toPage(items, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewCarriers, Permissions.ViewOrders),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const city = await tx.city.findFirst({
        where: {
          id: param(req, "id"),
          companyId: req.ctx.companyId!,
          governorateId: param(req, "governorateId"),
          deletedAt: null,
        },
        select: SELECT,
      });
      if (!city) throw new NotFoundError("المدينة غير موجودة.");
      return city;
    })
  )
);

router.post(
  "/",
  requirePermission(Permissions.ManageCarriers),
  route(
    async (req: AuthedRequest) => {
      const governorateId = param(req, "governorateId");
      const data = CreateCitySchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        await assertGovernorate(tx, companyId, governorateId);

        const created = await tx.city.create({
          data: { companyId, governorateId, ...data },
          select: SELECT,
        });

        await audit(tx, {
          action: "city.created",
          entity: "City",
          entityId: created.id,
          summary: `تم إضافة المدينة ${created.name}.`,
        });

        return created;
      });
    },
    { status: 201, message: "تم إضافة المدينة بنجاح." }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.ManageCarriers),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const governorateId = param(req, "governorateId");
      const data = UpdateCitySchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        const existing = await tx.city.findFirst({
          where: { id, companyId, governorateId, deletedAt: null },
          select: { id: true },
        });
        if (!existing) throw new NotFoundError("المدينة غير موجودة.");

        const updated = await tx.city.update({ where: { id }, data, select: SELECT });

        await audit(tx, {
          action: "city.updated",
          entity: "City",
          entityId: id,
          summary: `تم تحديث المدينة ${updated.name}.`,
          changes: data,
        });

        return updated;
      });
    },
    { message: "تم تحديث المدينة بنجاح." }
  )
);

router.delete(
  "/:id",
  requirePermission(Permissions.ManageCarriers),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const companyId = req.ctx.companyId!;

      const city = await tx.city.findFirst({
        where: { id, companyId, governorateId: param(req, "governorateId"), deletedAt: null },
        select: { id: true, name: true, _count: { select: { orders: true } } },
      });
      if (!city) throw new NotFoundError("المدينة غير موجودة.");

      if (city._count.orders > 0) {
        throw new ConflictError("لا يمكن حذف مدينة مستخدمة في طلبات.");
      }

      await tx.city.update({ where: { id }, data: { deletedAt: new Date() } });

      await audit(tx, {
        action: "city.deleted",
        entity: "City",
        entityId: id,
        summary: `تم حذف المدينة ${city.name}.`,
      });

      return null;
    })
  )
);

export { router as cityRoutes };

// ---------------------------------------------------------------------------
// Flat lookup
// ---------------------------------------------------------------------------

export const CityLookupFilterSchema = CityFilterSchema.extend({
  governorateId: z.string().trim().min(1).optional(),
});

const lookupRouter = Router();
/**
 * Every city in the company, for dropdowns that are not driven by a
 * governorate selection. Read-only: creating a city always goes through its
 * governorate so the parent is never ambiguous.
 */
lookupRouter.get(
  "/",
  requirePermission(Permissions.ViewCarriers, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = CityLookupFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        ...notDeleted(input.includeDeleted),
        ...(filter.governorateId ? { governorateId: filter.governorateId } : {}),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["name", "code"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.city.findMany({
        where,
        orderBy: orderBy(input, ["name", "shippingCost", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.city.count({ where });
      return toPage(items, total, input);
    });
  })
);

export { lookupRouter as cityLookupRoutes };
