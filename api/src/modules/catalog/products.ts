import { Router } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { env } from "../../config/env.js";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import { toPage } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { mergeRelations } from "../../shared/relations.js";
import { slugifyOrFallback } from "../../utils/slug.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const money = z.coerce.number().min(0).max(99_999_999);
const optionalId = z.string().trim().min(1).nullish();

export const CreateProductSchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(255),
  description: z.string().trim().max(4000).nullish(),
  skuCode: z.string().trim().max(100).nullish(),
  barcode: z.string().trim().max(100).nullish(),
  isActive: z.boolean().default(true),

  categoryId: optionalId,
  brandId: optionalId,
  uomId: optionalId,
  salesTaxRateId: optionalId,
  purchaseTaxRateId: optionalId,

  price: money.default(0),
  priceBeforeDiscount: money.nullish(),
  costPrice: money.default(0),

  weightKg: z.coerce.number().min(0).max(999_999).nullish(),
  trackStock: z.boolean().default(true),
  trackExpiry: z.boolean().default(false),

  images: z
    .array(
      z.object({
        imageUrl: z.string().trim().max(2000),
        altText: z.string().trim().max(255).nullish(),
        isPrimary: z.boolean().default(false),
        sortOrder: z.coerce.number().int().min(0).default(0),
      })
    )
    .max(20, "لا يمكن إضافة أكثر من ٢٠ صورة.")
    .default([]),

  variants: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        skuCode: z.string().trim().min(1).max(100),
        barcode: z.string().trim().max(100).nullish(),
        price: money.default(0),
        costPrice: money.default(0),
        imageUrl: z.string().trim().max(2000).nullish(),
        isActive: z.boolean().default(true),
        valueIds: z.array(z.string()).default([]),
      })
    )
    .default([]),
});

export const UpdateProductSchema = CreateProductSchema.partial()
  .extend({
    archived: z.boolean().optional(),
  })
  .strict();

export const ListProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(env.PAGINATION_MAX_PAGE_SIZE).default(10),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  includeDeleted: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  archived: z.enum(["true", "false", "all"]).default("false"),
  lowStockOnly: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  /**
   * Overrides the company's default low-stock threshold for this request.
   * Only meaningful with lowStockOnly; the alerts screen lets the user widen
   * the net (≤3 / ≤5 / ≤10 / ≤20) without changing the saved company setting.
   */
  lowStockThreshold: z.coerce.number().min(0).optional(),
});

export type CreateProductInput = z.infer<typeof CreateProductSchema>;
export type UpdateProductInput = z.infer<typeof UpdateProductSchema>;
export type ListProductsInput = z.infer<typeof ListProductsSchema>;

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

const LIST_SCALARS = {
  id: true,
  name: true,
  slug: true,
  skuCode: true,
  barcode: true,
  price: true,
  priceBeforeDiscount: true,
  costPrice: true,
  isActive: true,
  trackStock: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Relations are listed separately, and loaded with their OWN query.
//
// Prisma issues one statement per relation and runs them CONCURRENTLY. On a
// transaction client — which is a single connection — that is two statements
// racing, which pg warns about today and rejects on pg 9. Splitting them keeps
// every statement sequential. The round-trip count is identical: the same five
// lookups happen either way, just not at the same time on one socket.


// Scalars only. Relations are loaded one query at a time by
// productRepository.detail() — eight relations in one select means eight
// statements issued CONCURRENTLY by Prisma, which races on the transaction's
// single connection (pg warns now, rejects on pg 9).
const DETAIL_SCALARS = {
  ...LIST_SCALARS,
  description: true,
  weightKg: true,
  trackExpiry: true,
  deletedAt: true,
} as const;

export const productRepository = {
  async list(tx: Db, companyId: string, input: ListProductsInput, restrictToIds?: string[] | null) {
    const where = {
      companyId,
      ...notDeleted(input.includeDeleted),
      ...(input.archived === "all" ? {} : { archivedAt: input.archived === "true" ? { not: null } : null }),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(input.brandId ? { brandId: input.brandId } : {}),
      ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...searchFilter(["name", "skuCode", "barcode"], input.search),
      // `restrictToIds` carries a filter that cannot be expressed against this
      // table alone (see lowStockProductIds). The caller resolves it first, so
      // both the page and the count below are computed over the filtered set.
      ...(restrictToIds ? { id: { in: restrictToIds } } : {}),
    };

    // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
    const items = await tx.product.findMany({
      where,
      orderBy: orderBy(input, ["name", "skuCode", "price", "createdAt", "updatedAt"], "createdAt"),
      ...pageSlice(input),
      select: LIST_SCALARS,
    });
    const total = await tx.product.count({ where });

    // Relations, one query each, in sequence — see mergeRelations().
    // Prisma would otherwise fetch all five CONCURRENTLY on this transaction's
    // single connection.
    type ProductMerged = {
      category: { id: string; name: string } | null;
      brand: { id: string; name: string } | null;
      uom: { id: string; code: string; name: string } | null;
      images: { imageUrl: string; altText: string | null }[];
      _count: { variants: number };
    };
    const withRelations = await mergeRelations<typeof items[number], ProductMerged>(tx, items, [
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, category: { select: { id: true, name: true } } } }),
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, brand: { select: { id: true, name: true } } } }),
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, uom: { select: { id: true, code: true, name: true } } } }),
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, images: { where: { isPrimary: true }, take: 1, select: { imageUrl: true, altText: true } } } }),
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, _count: { select: { variants: true } } } }),
    ]);

    return [withRelations, total] as const;
  },

  /**
   * One product with everything its detail screen needs.
   *
   * Relations are fetched one query at a time. Prisma would otherwise issue a
   * separate statement per relation CONCURRENTLY, which races on this
   * transaction's single connection. The round-trip count is the same either
   * way; only the overlap is removed.
   */
  async detail(tx: Db, companyId: string, id: string) {
    const base = await tx.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: DETAIL_SCALARS,
    });
    if (!base) return null;

    // LIST relations first so detail stays a superset of list.
    const [merged] = await mergeRelations<
      typeof base,
      {
        category: { id: string; name: string } | null;
        brand: { id: string; name: string } | null;
        uom: { id: string; code: string; name: string } | null;
        _count: { variants: number };
      }
    >(tx, [base], [
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, category: { select: { id: true, name: true } } } }),
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, brand: { select: { id: true, name: true } } } }),
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, uom: { select: { id: true, code: true, name: true } } } }),
      (ids) => tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, _count: { select: { variants: true } } } }),
    ]);

    // One relation per query. Two in one select would be two statements issued
    // concurrently on this transaction's single connection.
    const salesTax = await tx.product.findFirst({
      where: { id },
      select: { salesTaxRate: { select: { id: true, name: true, percentage: true } } },
    });
    const purchaseTax = await tx.product.findFirst({
      where: { id },
      select: { purchaseTaxRate: { select: { id: true, name: true, percentage: true } } },
    });
    const images = await tx.product.findFirst({
      where: { id },
      select: {
        images: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: { id: true, imageUrl: true, altText: true, sortOrder: true, isPrimary: true },
        },
      },
    });
    const variants = await tx.product.findFirst({
      where: { id },
      select: {
        variants: {
          where: { deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            name: true,
            skuCode: true,
            barcode: true,
            price: true,
            costPrice: true,
            imageUrl: true,
            isActive: true,
            attributes: { select: { value: { select: { id: true, value: true, colorHex: true, attribute: { select: { id: true, name: true, code: true } } } } } },
          },
        },
      },
    });
    const levels = await tx.product.findFirst({
      where: { id },
      select: {
        stockLevels: {
          select: {
            onHand: true,
            reserved: true,
            storageLocation: { select: { id: true, name: true, warehouse: { select: { id: true, name: true } } } },
          },
        },
      },
    });

    return {
      ...merged,
      salesTaxRate: salesTax?.salesTaxRate ?? null,
      purchaseTaxRate: purchaseTax?.purchaseTaxRate ?? null,
      images: images?.images ?? [],
      variants: variants?.variants ?? [],
      stockLevels: levels?.stockLevels ?? [],
    };
  },

  findBySku(tx: Db, companyId: string, skuCode: string, exceptId?: string) {
    return tx.product.findFirst({
      where: { companyId, skuCode, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
  },

  /**
   * Totals per product in one query.
   *
   * Joining stock into the list query would multiply rows per storage
   * location and break pagination, and an N+1 of per-product aggregates would
   * be worse. A single groupBy over the page's ids is the only shape that
   * stays correct and bounded.
   */
  async stockTotals(tx: Db, productIds: string[]) {
    if (productIds.length === 0) return new Map<string, { onHand: number; reserved: number }>();

    const rows = await tx.stockLevel.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds } },
      _sum: { onHand: true, reserved: true },
    });

    return new Map(
      rows.map((row) => [
        row.productId,
        { onHand: Number(row._sum.onHand ?? 0), reserved: Number(row._sum.reserved ?? 0) },
      ])
    );
  },

  async create(tx: Db, companyId: string, data: CreateProductInput) {
    // (returns via createInner so the hydration call below can see the id)
    const created = await tx.product.create({
      data: {
        companyId,
        name: data.name,
        slug: slugifyOrFallback(data.name, "product"),
        description: data.description ?? null,
        skuCode: data.skuCode ?? null,
        barcode: data.barcode ?? null,
        isActive: data.isActive,
        categoryId: data.categoryId ?? null,
        brandId: data.brandId ?? null,
        uomId: data.uomId ?? null,
        salesTaxRateId: data.salesTaxRateId ?? null,
        purchaseTaxRateId: data.purchaseTaxRateId ?? null,
        price: data.price,
        priceBeforeDiscount: data.priceBeforeDiscount ?? null,
        costPrice: data.costPrice,
        weightKg: data.weightKg ?? null,
        trackStock: data.trackStock,
        trackExpiry: data.trackExpiry,
        images: {
          create: data.images.map((image, index) => ({
            companyId,
            imageUrl: image.imageUrl,
            altText: image.altText ?? null,
            isPrimary: image.isPrimary,
            sortOrder: image.sortOrder || index,
          })),
        },
        variants: {
          create: data.variants.map((variant) => ({
            companyId,
            name: variant.name,
            skuCode: variant.skuCode,
            barcode: variant.barcode ?? null,
            price: variant.price,
            costPrice: variant.costPrice,
            imageUrl: variant.imageUrl ?? null,
            isActive: variant.isActive,
            attributes: {
              create: variant.valueIds.map((valueId) => ({ companyId, valueId })),
            },
          })),
        },
      },
      select: { id: true },
    });
    // Hydrate through detail() so the response carries the same relations the
    // GET endpoint returns. Selecting them inline would race (see detail()).
    return (await this.detail(tx, companyId, created.id))!;
  },

  async update(tx: Db, companyId: string, id: string, data: UpdateProductInput) {
    const { images, variants, archived, ...fields } = data;

    const updated = await tx.product.update({
      where: { id },
      data: {
        name: fields.name,
        slug: fields.name ? slugifyOrFallback(fields.name, "product") : undefined,
        description: fields.description,
        skuCode: fields.skuCode,
        barcode: fields.barcode,
        isActive: fields.isActive,
        categoryId: fields.categoryId,
        brandId: fields.brandId,
        uomId: fields.uomId,
        salesTaxRateId: fields.salesTaxRateId,
        purchaseTaxRateId: fields.purchaseTaxRateId,
        price: fields.price,
        priceBeforeDiscount: fields.priceBeforeDiscount,
        costPrice: fields.costPrice,
        weightKg: fields.weightKg,
        trackStock: fields.trackStock,
        trackExpiry: fields.trackExpiry,
        archivedAt: archived === undefined ? undefined : archived ? new Date() : null,
        images:
          images === undefined
            ? undefined
            : {
                deleteMany: {},
                create: images.map((image, index) => ({
                  companyId,
                  imageUrl: image.imageUrl,
                  altText: image.altText ?? null,
                  isPrimary: image.isPrimary,
                  sortOrder: image.sortOrder || index,
                })),
              },
        variants:
          variants === undefined
            ? undefined
            : {
                deleteMany: {},
                create: variants.map((variant) => ({
                  companyId,
                  name: variant.name,
                  skuCode: variant.skuCode,
                  barcode: variant.barcode ?? null,
                  price: variant.price,
                  costPrice: variant.costPrice,
                  imageUrl: variant.imageUrl ?? null,
                  isActive: variant.isActive,
                  attributes: {
                    create: variant.valueIds.map((valueId) => ({ companyId, valueId })),
                  },
                })),
              },
      },
      select: { id: true },
    });
    return (await this.detail(tx, companyId, updated.id))!;
  },

  /** Soft delete: orders, purchase orders and stock movements reference it. */
  async softDelete(tx: Db, id: string): Promise<void> {
    await tx.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  },

  restore(tx: Db, id: string) {
    return tx.product.update({
      where: { id },
      data: { deletedAt: null },
      select: { id: true, name: true },
    });
  },

  setArchived(tx: Db, id: string, archived: boolean) {
    return tx.product.update({
      where: { id },
      data: { archivedAt: archived ? new Date() : null },
      select: { id: true, name: true, archivedAt: true },
    });
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Verifies every referenced row belongs to this company.
 *
 * Row-level security would reject a cross-company id anyway, but the failure
 * would be a policy violation rather than a readable message, and checking
 * first means a typo in the UI produces a 400 instead of a 500.
 */
async function assertCompanyReferences(
  tx: Db,
  companyId: string,
  data: Partial<CreateProductInput>
): Promise<void> {
  const checks: [string | null | undefined, (ids: string[]) => Promise<number>, string][] = [
    [data.categoryId, (ids) => tx.category.count({ where: { id: { in: ids }, companyId } }), "التصنيف غير موجود."],
    [data.brandId, (ids) => tx.brand.count({ where: { id: { in: ids }, companyId } }), "الماركة غير موجودة."],
    [data.uomId, (ids) => tx.uom.count({ where: { id: { in: ids }, companyId } }), "وحدة القياس غير موجودة."],
    [
      data.salesTaxRateId,
      (ids) => tx.taxRate.count({ where: { id: { in: ids }, companyId } }),
      "معدل ضريبة البيع غير موجود.",
    ],
    [
      data.purchaseTaxRateId,
      (ids) => tx.taxRate.count({ where: { id: { in: ids }, companyId } }),
      "معدل ضريبة الشراء غير موجود.",
    ],
  ];

  for (const [id, count, message] of checks) {
    if (!id) continue;
    const found = await count([id]);
    if (found === 0) throw new BadRequestError(message);
  }

  const valueIds = [...new Set((data.variants ?? []).flatMap((v) => v.valueIds))];
  if (valueIds.length > 0) {
    const found = await tx.productAttributeValue.count({
      where: { id: { in: valueIds }, companyId },
    });
    if (found !== valueIds.length) {
      throw new BadRequestError("أحد قيم الخصائص غير موجود في هذه الشركة.");
    }
  }

  // SKUs are unique per product, so duplicates inside one payload are caught
  // before they reach the database.
  const skus = (data.variants ?? []).map((v) => v.skuCode);
  if (new Set(skus).size !== skus.length) {
    throw new ConflictError("يوجد أكثر من متغير بنفس كود المنتج.");
  }
}

/**
 * Products whose available quantity has fallen to or below their low-stock
 * threshold.
 *
 * This runs in SQL and before pagination, which is the whole point. Filtering
 * the fetched page in memory only ever saw `pageSize` rows, so both the rows
 * and the reported total were wrong: at pageSize=1 the list claimed exactly one
 * low-stock product however many there really were, and the count only became
 * correct by accident once the page was large enough to contain them all.
 *
 * Only the stock condition lives here. Category, brand, search and the archived
 * filter are applied by the caller's `where`, so the two compose rather than
 * duplicating each other.
 */
async function lowStockProductIds(
  tx: Db,
  companyId: string,
  thresholdOverride?: number
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT p."id"
    FROM "products" p
    LEFT JOIN (
      SELECT sl."productId",
             SUM(sl."onHand") AS on_hand,
             SUM(sl."reserved") AS reserved
      FROM "stock_levels" sl
      WHERE sl."companyId" = ${companyId}::text
      GROUP BY sl."productId"
    ) s ON s."productId" = p."id"
    WHERE p."companyId" = ${companyId}::text
      AND p."deletedAt" IS NULL
      AND p."trackStock" = true
      AND GREATEST(0, COALESCE(s.on_hand, 0) - COALESCE(s.reserved, 0))
          <= ${
            thresholdOverride === undefined
              ? Prisma.sql`COALESCE(
                   (SELECT cs."defaultLowStockThreshold" FROM "company_settings" cs
                    WHERE cs."companyId" = p."companyId"),
                   0
                 )`
              : Prisma.sql`${thresholdOverride}::numeric`
          }
  `;
  return rows.map((row) => row.id);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewProducts),
  route(async (req: AuthedRequest) => {
    const input = ListProductsSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Resolved before the page is read so the filter applies to the whole
      // result set, not just the rows this page happens to contain.
      const lowStockIds = input.lowStockOnly
        ? await lowStockProductIds(tx, companyId, input.lowStockThreshold)
        : null;
      if (lowStockIds && lowStockIds.length === 0) return toPage([], 0, input);

      const [items, total] = await productRepository.list(tx, companyId, input, lowStockIds);
      const totals = await productRepository.stockTotals(tx, items.map((p) => p.id));

      const rows = items.map((product) => {
        const stock = totals.get(product.id) ?? { onHand: 0, reserved: 0 };
        const { images, ...rest } = product as typeof product & { images: { imageUrl: string }[] };
        return {
          ...rest,
          primaryImage: images[0]?.imageUrl ?? null,
          onHand: stock.onHand,
          reserved: stock.reserved,
          available: Math.max(0, stock.onHand - stock.reserved),
        };
      });

      return toPage(rows, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewProducts),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const product = await productRepository.detail(tx, req.ctx.companyId!, param(req, "id"));
      if (!product) throw new NotFoundError("المنتج غير موجود.");

      const { stockLevels, images, variants, ...rest } = product;
      return {
        ...rest,
        images,
        variants: variants.map(({ attributes, ...variant }) => ({
          ...variant,
          values: attributes.map((a) => a.value),
        })),
        stock: stockLevels.map((level) => ({
          onHand: Number(level.onHand),
          reserved: Number(level.reserved),
          location: level.storageLocation,
        })),
        onHand: stockLevels.reduce((sum, l) => sum + Number(l.onHand), 0),
        reserved: stockLevels.reduce((sum, l) => sum + Number(l.reserved), 0),
      };
    })
  )
);

router.post(
  "/",
  requirePermission(Permissions.CreateProduct),
  route(
    async (req: AuthedRequest) => {
      const data = CreateProductSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;
        await assertCompanyReferences(tx, companyId, data);

        if (data.skuCode) {
          const clash = await productRepository.findBySku(tx, companyId, data.skuCode);
          if (clash) throw new ConflictError("يوجد منتج بنفس كود المنتج بالفعل.");
        }

        const created = await productRepository.create(tx, companyId, data);
        await audit(tx, {
          action: "product.created",
          entity: "Product",
          entityId: created.id,
          summary: `تم إضافة المنتج ${created.name}.`,
        });
        return created;
      });
    },
    { status: 201, message: "تم إضافة المنتج بنجاح." }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.UpdateProduct),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = UpdateProductSchema.parse(req.body);

      return scoped(req, async (tx) => {
        const companyId = req.ctx.companyId!;

        const existing = await tx.product.findFirst({
          where: { id, companyId, deletedAt: null },
          select: { id: true },
        });
        if (!existing) throw new NotFoundError("المنتج غير موجود.");

        await assertCompanyReferences(tx, companyId, data);

        if (data.skuCode) {
          const clash = await productRepository.findBySku(tx, companyId, data.skuCode, id);
          if (clash) throw new ConflictError("يوجد منتج بنفس كود المنتج بالفعل.");
        }

        const updated = await productRepository.update(tx, companyId, id, data);
        await audit(tx, {
          action: "product.updated",
          entity: "Product",
          entityId: id,
          summary: `تم تحديث المنتج ${updated.name}.`,
          changes: data,
        });
        return updated;
      });
    },
    { message: "تم تحديث المنتج بنجاح." }
  )
);

router.delete(
  "/:id",
  requirePermission(Permissions.DeleteProduct),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const product = await productRepository.detail(tx, req.ctx.companyId!, id);
      if (!product) throw new NotFoundError("المنتج غير موجود.");

      await productRepository.softDelete(tx, id);
      await audit(tx, {
        action: "product.deleted",
        entity: "Product",
        entityId: id,
        summary: `تم حذف المنتج ${product.name}.`,
      });
      return null;
    })
  )
);

router.post(
  "/:id/restore",
  requirePermission(Permissions.UpdateProduct),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const restored = await productRepository.restore(tx, id);
      await audit(tx, {
        action: "product.restored",
        entity: "Product",
        entityId: id,
        summary: `تمت استعادة المنتج ${restored.name}.`,
      });
      return restored;
    })
  )
);

router.post(
  "/:id/archive",
  requirePermission(Permissions.UpdateProduct),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const updated = await productRepository.setArchived(tx, id, true);
      await audit(tx, {
        action: "product.archived",
        entity: "Product",
        entityId: id,
        summary: `تم أرشفة المنتج ${updated.name}.`,
      });
      return updated;
    })
  )
);

router.post(
  "/:id/unarchive",
  requirePermission(Permissions.UpdateProduct),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const updated = await productRepository.setArchived(tx, id, false);
      await audit(tx, {
        action: "product.unarchived",
        entity: "Product",
        entityId: id,
        summary: `تم إلغاء أرشفة المنتج ${updated.name}.`,
      });
      return updated;
    })
  )
);

export { router as productRoutes };
