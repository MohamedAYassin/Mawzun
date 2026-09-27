import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

// Delivery geography. Companies define their own governorates and cities —
// including the delivery fee attached to each — so two tenants can serve the
// same country with completely different zones and prices.

export const CreateGovernorateSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  code: z.string().trim().max(20).nullish(),
  shippingCost: z.coerce.number().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const UpdateGovernorateSchema = CreateGovernorateSchema.partial().strict();

export const GovernorateFilterSchema = z.object({
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
  createdAt: true,
  _count: { select: { cities: true } },
} as const;

export const governoratesRoutes = defineResource({
  entity: "Governorate",
  createSchema: CreateGovernorateSchema,
  updateSchema: UpdateGovernorateSchema,
  filterSchema: GovernorateFilterSchema,
  view: [Permissions.ViewCarriers, Permissions.ViewOrders],
  manage: [Permissions.ManageCarriers],
  handlers: {
    async list(
      tx: Db,
      companyId: string,
      input: PaginationInput,
      filter: z.infer<typeof GovernorateFilterSchema>
    ) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["name", "code"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.governorate.findMany({
        where,
        orderBy: orderBy(input, ["name", "shippingCost", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.governorate.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.governorate.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    create(tx: Db, companyId: string, data: z.infer<typeof CreateGovernorateSchema>) {
      return tx.governorate.create({ data: { companyId, ...data }, select: SELECT });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateGovernorateSchema>) {
      const existing = await tx.governorate.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("المحافظة غير موجودة.");

      return tx.governorate.update({ where: { id }, data, select: SELECT });
    },

    async remove(tx: Db, companyId: string, id: string) {
      // Orders and cities both reference this row.
      const usage = await tx.governorate.findFirst({
        where: { id, companyId },
        select: { _count: { select: { cities: true, orders: true } } },
      });
      if (usage && (usage._count.cities > 0 || usage._count.orders > 0)) {
        throw new ConflictError("لا يمكن حذف محافظة مستخدمة في مدن أو طلبات.");
      }

      await tx.governorate.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});
