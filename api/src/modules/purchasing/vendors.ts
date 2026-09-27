import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

// One model for both supplier kinds.
//
// A consignment vendor stocks goods the company sells on their behalf and is
// settled on commission, which is why commissionRate exists — but they are
// the same counterparty otherwise, and the old schema's separate
// ConsignmentVendor table duplicated every other field.

export const CreateVendorSchema = z.object({
  kind: z.enum(["SUPPLIER", "CONSIGNMENT"]).default("SUPPLIER"),
  name: z.string().trim().min(1, "الاسم مطلوب.").max(150),
  contactPerson: z.string().trim().max(150).default(""),
  phoneNumber: z.string().trim().max(30).default(""),
  email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح.").max(150).default(""),
  address: z.string().trim().max(300).default(""),
  taxNumber: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(1000).default(""),
  isActive: z.boolean().default(true),
  commissionRate: z.coerce.number().min(0).max(100).default(0),
});

export const UpdateVendorSchema = CreateVendorSchema.partial().strict();

export const VendorFilterSchema = z.object({
  kind: z.enum(["SUPPLIER", "CONSIGNMENT"]).optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const SELECT = {
  id: true,
  kind: true,
  name: true,
  contactPerson: true,
  phoneNumber: true,
  email: true,
  address: true,
  taxNumber: true,
  notes: true,
  isActive: true,
  commissionRate: true,
  createdAt: true,
  _count: { select: { purchaseOrders: true } },
} as const;

export const vendorRoutes = defineResource({
  entity: "Vendor",
  createSchema: CreateVendorSchema,
  updateSchema: UpdateVendorSchema,
  filterSchema: VendorFilterSchema,
  view: [Permissions.ViewVendors, Permissions.ViewPurchaseOrders],
  manage: [Permissions.CreateVendor, Permissions.UpdateVendor, Permissions.DeleteVendor],
  handlers: {
    async list(
      tx: Db,
      companyId: string,
      input: PaginationInput,
      filter: z.infer<typeof VendorFilterSchema>
    ) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["name", "contactPerson", "phoneNumber", "email"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.vendor.findMany({
        where,
        orderBy: orderBy(input, ["name", "createdAt"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.vendor.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.vendor.findFirst({ where: { id, companyId, deletedAt: null }, select: SELECT });
    },

    create(tx: Db, companyId: string, data: z.infer<typeof CreateVendorSchema>) {
      return tx.vendor.create({ data: { companyId, ...data }, select: SELECT });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateVendorSchema>) {
      const existing = await tx.vendor.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("المورد غير موجود.");

      return tx.vendor.update({ where: { id }, data, select: SELECT });
    },

    async remove(tx: Db, _companyId: string, id: string) {
      await tx.vendor.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    },
  },
});
