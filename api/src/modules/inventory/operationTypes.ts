import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import type { PaginationInput } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { defineResource } from "../../shared/resource.js";

export const CreateOperationTypeSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(150),
  code: z
    .string()
    .trim()
    .min(1, "الكود مطلوب.")
    .max(100)
    .transform((v) => v.toUpperCase()),
  description: z.string().trim().max(500).nullish(),
  requiresValidation: z.boolean().default(false),
  sequencePrefix: z.string().trim().max(30).default("OP"),
  reservationMethod: z.enum(["MANUAL", "AT_CONFIRMATION", "AT_FULFILLMENT"]).default("MANUAL"),
  isActive: z.boolean().default(true),
});

export const UpdateOperationTypeSchema = CreateOperationTypeSchema.partial().strict();

const SELECT = {
  id: true,
  name: true,
  code: true,
  description: true,
  requiresValidation: true,
  sequencePrefix: true,
  reservationMethod: true,
  isActive: true,
  nextSequence: true,
  createdAt: true,
} as const;

async function assertCodeFree(
  tx: Db,
  companyId: string,
  code: string,
  exceptId?: string
): Promise<void> {
  const clash = await tx.operationType.findFirst({
    where: { companyId, code, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ConflictError("يوجد نوع حركة بنفس الكود بالفعل.");
}

export const operationTypeRoutes = defineResource({
  entity: "OperationType",
  unpaginated: true,
  createSchema: CreateOperationTypeSchema,
  updateSchema: UpdateOperationTypeSchema,
  view: [Permissions.ViewStockOperations, Permissions.ViewInventory],
  manage: [Permissions.ManageStockOperations],
  handlers: {
    async list(tx: Db, companyId: string, input: PaginationInput) {
      const where = {
        companyId,
        ...notDeleted(input.includeDeleted),
        ...searchFilter(["name", "code"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.operationType.findMany({
        where,
        orderBy: orderBy(input, ["name", "createdAt"], "name"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.operationType.count({ where });
      return [items, total];
    },

    detail(tx: Db, companyId: string, id: string) {
      return tx.operationType.findFirst({
        where: { id, companyId, deletedAt: null },
        select: SELECT,
      });
    },

    async create(tx: Db, companyId: string, data: z.infer<typeof CreateOperationTypeSchema>) {
      await assertCodeFree(tx, companyId, data.code);
      return tx.operationType.create({ data: { companyId, ...data }, select: SELECT });
    },

    async update(tx: Db, companyId: string, id: string, data: z.infer<typeof UpdateOperationTypeSchema>) {
      const existing = await tx.operationType.findFirst({
        where: { id, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundError("نوع الحركة غير موجود.");

      if (data.code) await assertCodeFree(tx, companyId, data.code, id);

      return tx.operationType.update({ where: { id }, data, select: SELECT });
    },

    async remove(tx: Db, _companyId: string, id: string) {
      const inUse = await tx.stockOperation.count({
        where: { operationTypeId: id, deletedAt: null },
      });
      if (inUse > 0) {
        throw new BadRequestError("لا يمكن حذف نوع حركة مستخدم في عمليات مخزون.");
      }
      await tx.operationType.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  },
});
