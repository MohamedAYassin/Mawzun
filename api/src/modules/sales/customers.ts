import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { defineResource } from "../../shared/resource.js";
import { route } from "../../shared/route.js";

export const CreateCustomerSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  phoneNumber1: z.string().trim().min(1, "رقم الهاتف مطلوب.").max(50),
  phoneNumber2: z.string().trim().max(50).nullish(),
  email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح.").max(200).nullish(),
  address: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(1000).nullish(),
  isActive: z.boolean().default(true),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial().strict();

export const CustomerFilterSchema = z.object({
  isActive: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
});

const SELECT = {
  id: true,
  name: true,
  phoneNumber1: true,
  phoneNumber2: true,
  email: true,
  address: true,
  notes: true,
  isActive: true,
  createdAt: true,
  _count: { select: { orders: true } },
} as const;

async function assertPhoneFree(
  tx: Db,
  companyId: string,
  phone: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.customer.findFirst({
    where: {
      companyId,
      phoneNumber1: phone,
      deletedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new ConflictError("يوجد عميل بنفس رقم الهاتف بالفعل.");
}

const resource = defineResource({
  entity: "Customer",
  createSchema: CreateCustomerSchema,
  updateSchema: UpdateCustomerSchema,
  filterSchema: CustomerFilterSchema,
  view: [Permissions.ViewCustomers, Permissions.ViewOrders],
  manage: [Permissions.CreateCustomer, Permissions.UpdateCustomer, Permissions.DeleteCustomer],
  handlers: {
    async list(
      tx: Db,
      companyId: string,
      input: PaginationInput,
      filter: z.infer<typeof CustomerFilterSchema>
    ) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["name", "phoneNumber1", "phoneNumber2", "email"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.customer.findMany({
        where,
        orderBy: orderBy(input, ["name", "createdAt"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.customer.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.customer.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateCustomerSchema>) {
      await assertPhoneFree(tx, companyId, data.phoneNumber1);
      return tx.customer.create({ data: { companyId, ...data }, select: SELECT });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateCustomerSchema>) {
      const existing = await tx.customer.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("العميل غير موجود.");

      if (data.phoneNumber1) await assertPhoneFree(tx, companyId, data.phoneNumber1, id);

      return tx.customer.update({ where: { id }, data, select: SELECT });
    },

    async remove(tx: Db, _companyId: string, id: string) {
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    },
  },
});

// Order entry needs a customer id for a phone number it may never have seen.
// This returns the existing row rather than failing, so the operator is never
// blocked by a race with another agent entering the same number.
const router = Router();

// find-or-create writes: keep it behind CreateCustomer (the resource below
// gates reads with ViewCustomers and writes with the manage set).
router.post(
  "/find-or-create",
  requirePermission(Permissions.CreateCustomer),
  route(async (req: AuthedRequest) => {
    const data = CreateCustomerSchema.parse(req.body);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const existing = await tx.customer.findFirst({
        where: { companyId, phoneNumber1: data.phoneNumber1, deletedAt: null },
        select: SELECT,
      });
      if (existing) return { customer: existing, created: false };

      const created = await tx.customer.create({ data: { companyId, ...data }, select: SELECT });
      await audit(tx, {
        action: "customer.created",
        entity: "Customer",
        entityId: created.id,
        summary: `تم إضافة العميل ${created.name}.`,
      });

      return { customer: created, created: true };
    });
  })
);

router.get("/:id/orders", requirePermission(Permissions.ViewOrders), route(async (req: AuthedRequest) =>
  scoped(req, async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: param(req, "id"), companyId: req.ctx.companyId!, deletedAt: null },
      select: { id: true },
    });
    if (!customer) throw new NotFoundError("العميل غير موجود.");

    return tx.order.findMany({
      where: { customerId: customer.id, companyId: req.ctx.companyId!, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        orderPrice: true,
        orderActualPrice: true,
        createdAt: true,
      },
    });
  })
));

// The generated CRUD routes are mounted last so the specific paths above win.
router.use(resource);

export { router as customerRoutes };
