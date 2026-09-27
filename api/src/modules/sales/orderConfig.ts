import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

// Order sources, payment methods and cancellation reasons are company-owned
// name lists the order form offers as dropdowns. Their schemas, query shape and
// guards are declared once and applied to each, but each model keeps its own
// handlers: Prisma types every delegate nominally, so collapsing the three into
// one generic would mean casting them away.

const CreateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  isActive: z.boolean().default(true),
});

const UpdateSchema = CreateSchema.partial().strict();

const FilterSchema = z.object({
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

type Entry = z.infer<typeof CreateSchema>;
type Filter = z.infer<typeof FilterSchema>;

const SELECT = {
  id: true,
  name: true,
  isActive: true,
  createdAt: true,
} as const;

/** The `where` clause all three share. */
function buildWhere(companyId: string, input: PaginationInput, filter: Filter) {
  return {
    companyId,
    ...notDeleted(input.includeDeleted),
    ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
    ...searchFilter(["name"], input.search),
  };
}

function listArgs(input: PaginationInput) {
  return {
    orderBy: orderBy(input, ["name", "createdAt"], "name"),
    ...pageSlice(input),
  };
}

type FindFirstRow = { id: string } | null;

async function assertNameFree(
  findFirst: (args: { where: Record<string, unknown>; select: { id: true } }) => Promise<FindFirstRow>,
  companyId: string,
  name: string,
  exceptId?: string
): Promise<void> {
  const clash = await findFirst({
    where: {
      companyId,
      name,
      deletedAt: null,
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw new ConflictError("يوجد عنصر بنفس الاسم بالفعل.");
}

/** Counts orders pointing at the row, whichever column uses it. */
async function countUsages(tx: Db, companyId: string, id: string): Promise<number> {
  return tx.order.count({
    where: {
      companyId,
      OR: [{ orderSourceId: id }, { paymentMethodId: id }, { cancelReasonId: id }],
    },
  });
}

export const orderSourceRoutes = defineResource({
  entity: "OrderSource",
  unpaginated: true,
  createSchema: CreateSchema,
  updateSchema: UpdateSchema,
  filterSchema: FilterSchema,
  view: [Permissions.ViewOrders],
  manage: [Permissions.UpdateOrder, Permissions.ManageSettings],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput, filter: Filter) {
      const where = buildWhere(companyId, input, filter);
      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.orderSource.findMany({ where, ...listArgs(input), select: SELECT });
      const total = await tx.orderSource.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.orderSource.findFirst({
        where: { id, companyId, deletedAt: null },
        select: SELECT,
      });
    },

    async create(tx: Db, companyId: string, data: Entry) {
      await assertNameFree((args) => tx.orderSource.findFirst(args), companyId, data.name);
      return tx.orderSource.create({ data: { companyId, ...data }, select: SELECT });
    },

    async update(tx: Db, companyId: string, id: string, data: Partial<Entry>) {
      const existing = await tx.orderSource.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("مصدر الطلب غير موجود.");

      if (data.name) {
        await assertNameFree((args) => tx.orderSource.findFirst(args), companyId, data.name, id);
      }

      return tx.orderSource.update({ where: { id }, data, select: SELECT });
    },

    async remove(tx: Db, companyId: string, id: string) {
      if ((await countUsages(tx, companyId, id)) > 0) {
        throw new BadRequestError("لا يمكن الحذف لوجود طلبات مرتبطة بهذا المصدر.");
      }
      await tx.orderSource.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});

export const paymentMethodRoutes = defineResource({
  entity: "PaymentMethod",
  unpaginated: true,
  createSchema: CreateSchema,
  updateSchema: UpdateSchema,
  filterSchema: FilterSchema,
  view: [Permissions.ViewOrders],
  manage: [Permissions.UpdateOrder, Permissions.ManageSettings],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput, filter: Filter) {
      const where = buildWhere(companyId, input, filter);
      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.paymentMethod.findMany({ where, ...listArgs(input), select: SELECT });
      const total = await tx.paymentMethod.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.paymentMethod.findFirst({
        where: { id, companyId, deletedAt: null },
        select: SELECT,
      });
    },

    async create(tx: Db, companyId: string, data: Entry) {
      await assertNameFree((args) => tx.paymentMethod.findFirst(args), companyId, data.name);
      return tx.paymentMethod.create({ data: { companyId, ...data }, select: SELECT });
    },

    async update(tx: Db, companyId: string, id: string, data: Partial<Entry>) {
      const existing = await tx.paymentMethod.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("طريقة الدفع غير موجودة.");

      if (data.name) {
        await assertNameFree((args) => tx.paymentMethod.findFirst(args), companyId, data.name, id);
      }

      return tx.paymentMethod.update({ where: { id }, data, select: SELECT });
    },

    async remove(tx: Db, companyId: string, id: string) {
      if ((await countUsages(tx, companyId, id)) > 0) {
        throw new BadRequestError("لا يمكن الحذف لوجود طلبات مرتبطة بطريقة الدفع.");
      }
      await tx.paymentMethod.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});

export const cancelReasonRoutes = defineResource({
  entity: "CancelReason",
  unpaginated: true,
  createSchema: CreateSchema,
  updateSchema: UpdateSchema,
  filterSchema: FilterSchema,
  view: [Permissions.ViewOrders],
  manage: [Permissions.UpdateOrder, Permissions.ManageSettings],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput, filter: Filter) {
      const where = buildWhere(companyId, input, filter);
      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.cancelReason.findMany({ where, ...listArgs(input), select: SELECT });
      const total = await tx.cancelReason.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.cancelReason.findFirst({
        where: { id, companyId, deletedAt: null },
        select: SELECT,
      });
    },

    async create(tx: Db, companyId: string, data: Entry) {
      await assertNameFree((args) => tx.cancelReason.findFirst(args), companyId, data.name);
      return tx.cancelReason.create({ data: { companyId, ...data }, select: SELECT });
    },

    async update(tx: Db, companyId: string, id: string, data: Partial<Entry>) {
      const existing = await tx.cancelReason.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("سبب الإلغاء غير موجود.");

      if (data.name) {
        await assertNameFree((args) => tx.cancelReason.findFirst(args), companyId, data.name, id);
      }

      return tx.cancelReason.update({ where: { id }, data, select: SELECT });
    },

    async remove(tx: Db, companyId: string, id: string) {
      if ((await countUsages(tx, companyId, id)) > 0) {
        throw new BadRequestError("لا يمكن الحذف لوجود طلبات مرتبطة بهذا السبب.");
      }
      await tx.cancelReason.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});
