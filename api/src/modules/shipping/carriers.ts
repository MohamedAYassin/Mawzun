import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

// Shipping carriers.
//
// This merges what used to be two tables: a plain name list attached to orders
// and an integration record with costs and credentials. They were the same
// concept stored twice, which meant an order could point at a name that had no
// costs, and a carrier could have costs for a name no order could use.

export const CreateCarrierSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(150),
  code: z.string().trim().min(1, "الكود مطلوب.").max(60),
  type: z.enum(["INTEGRATED", "MANUAL"]).default("MANUAL"),
  isActive: z.boolean().default(true),
  logoUrl: z.string().trim().max(1000).nullish(),
  trackingUrlTemplate: z.string().trim().max(500).nullish(),
  defaultShippingCost: z.coerce.number().min(0).default(0),
  defaultCustomerShippingCost: z.coerce.number().min(0).default(0),
  returnShippingCost: z.coerce.number().min(0).default(0),
  autoSendOrderEnabled: z.boolean().default(false),
});

export const UpdateCarrierSchema = CreateCarrierSchema.partial().strict();

export const CarrierFilterSchema = z.object({
  type: z.enum(["INTEGRATED", "MANUAL"]).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

/**
 * Carrier credentials live in `settings` and are deliberately absent here.
 *
 * The column holds API keys for integrated carriers. Leaving it out of the
 * default projection means no list or detail response can leak them, and
 * nothing has to remember to strip the field at the edge.
 */
const SELECT = {
  id: true,
  name: true,
  code: true,
  type: true,
  isActive: true,
  logoUrl: true,
  trackingUrlTemplate: true,
  defaultShippingCost: true,
  defaultCustomerShippingCost: true,
  returnShippingCost: true,
  autoSendOrderEnabled: true,
  createdAt: true,
  _count: { select: { orders: true } },
} as const;

export const carrierRoutes = defineResource({
  entity: "Carrier",
  createSchema: CreateCarrierSchema,
  updateSchema: UpdateCarrierSchema,
  filterSchema: CarrierFilterSchema,
  view: [Permissions.ViewCarriers],
  manage: [Permissions.ManageCarriers],
  handlers: {
    async list(
      tx: Db,
      companyId: string,
      input: PaginationInput,
      filter: z.infer<typeof CarrierFilterSchema>
    ) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...(filter.type ? { type: filter.type } : {}),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["name", "code"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.carrier.findMany({
        where,
        orderBy: orderBy(input, ["name", "code", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.carrier.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.carrier.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    create(tx: Db, companyId: string, data: z.infer<typeof CreateCarrierSchema>) {
      return tx.carrier.create({ data: { companyId, ...data }, select: SELECT });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateCarrierSchema>) {
      const existing = await tx.carrier.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("شركة الشحن غير موجودة.");

      return tx.carrier.update({ where: { id }, data, select: SELECT });
    },

    async remove(tx: Db, companyId: string, id: string) {
      // Orders keep the carrier id for their shipping history.
      const carrier = await tx.carrier.findFirst({
        where: { id, companyId },
        select: { _count: { select: { orders: true } } },
      });
      if (carrier && carrier._count.orders > 0) {
        throw new ConflictError("لا يمكن حذف شركة شحن مستخدمة في طلبات.");
      }

      await tx.carrier.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    },
  },
});
