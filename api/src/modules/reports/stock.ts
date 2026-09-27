import { Router } from "express";
import { z } from "zod";
import { Prisma } from "../../generated/prisma/client.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// ---------------------------------------------------------------------------
// Stock reports
// ---------------------------------------------------------------------------
//
// Stock is held per product per bin, so the report is a join across
// stock_levels, storage_locations, warehouses and products. It is read-only by
// design: correcting stock goes through a stock operation or a stock count so
// every change leaves a ledger entry behind.

export const StockReportFilterSchema = z.object({
  warehouseId: z.string().trim().min(1).optional(),
  locationId: z.string().trim().min(1).optional(),
  categoryId: z.string().trim().min(1).optional(),
  /** Hides rows with nothing in them, which is most of the table. */
  onlyInStock: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

const SELECT = {
  id: true,
  onHand: true,
  reserved: true,
  product: {
    select: {
      id: true,
      name: true,
      skuCode: true,
      costPrice: true,
      category: { select: { id: true, name: true } },
    },
  },
  storageLocation: {
    select: {
      id: true,
      name: true,
      code: true,
      warehouse: { select: { id: true, name: true } },
    },
  },
} as const;

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewReports, Permissions.ViewInventory),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = StockReportFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const term = input.search?.trim();

      const where = {
        companyId,
        ...(filter.onlyInStock ? { onHand: { not: 0 } } : {}),
        ...(filter.locationId ? { storageLocationId: filter.locationId } : {}),
        ...(filter.warehouseId
          ? { storageLocation: { warehouseId: filter.warehouseId } }
          : {}),
        ...(filter.categoryId
          ? { product: { categoryId: filter.categoryId, deletedAt: null } }
          : { product: { deletedAt: null } }),
        ...(term
          ? {
              product: {
                deletedAt: null,
                OR: [
                  { name: { contains: term, mode: "insensitive" as const } },
                  { skuCode: { contains: term, mode: "insensitive" as const } },
                ],
              },
            }
          : {}),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const rows = await tx.stockLevel.findMany({
        where,
        orderBy: [{ product: { name: "asc" } }, { storageLocation: { code: "asc" } }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: SELECT,
      });
      const total = await tx.stockLevel.count({ where });

      return toPage(
        rows.map((row) => {
          const onHand = Number(row.onHand);
          const reserved = Number(row.reserved);
          const costPrice = Number(row.product.costPrice);
          return {
            id: row.id,
            productId: row.product.id,
            productName: row.product.name,
            skuCode: row.product.skuCode,
            categoryName: row.product.category?.name ?? null,
            locationId: row.storageLocation.id,
            locationName: row.storageLocation.name,
            locationCode: row.storageLocation.code,
            warehouseId: row.storageLocation.warehouse.id,
            warehouseName: row.storageLocation.warehouse.name,
            quantityOnHand: onHand,
            reservedQuantity: reserved,
            availableQuantity: Math.max(0, onHand - reserved),
            unitCost: costPrice,
            totalCost: Math.round(onHand * costPrice * 100) / 100,
          };
        }),
        total,
        input
      );
    });
  })
);

/** The totals row under the stock table. */
router.get(
  "/totals",
  requirePermission(Permissions.ViewReports, Permissions.ViewInventory),
  route(async (req: AuthedRequest) => {
    const filter = StockReportFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const where = {
        companyId,
        ...(filter.onlyInStock ? { onHand: { not: 0 } } : {}),
        ...(filter.locationId ? { storageLocationId: filter.locationId } : {}),
        ...(filter.warehouseId
          ? { storageLocation: { warehouseId: filter.warehouseId } }
          : {}),
        ...(filter.categoryId ? { product: { categoryId: filter.categoryId } } : {}),
      };

      const rows = await tx.stockLevel.findMany({
        where,
        select: { onHand: true, reserved: true, product: { select: { costPrice: true } } },
      });

      let totalQuantity = 0;
      let reservedQuantity = 0;
      let totalCost = 0;
      for (const row of rows) {
        const onHand = Number(row.onHand);
        totalQuantity += onHand;
        reservedQuantity += Number(row.reserved);
        totalCost += onHand * Number(row.product.costPrice);
      }

      return {
        totalQuantity,
        reservedQuantity,
        availableQuantity: Math.max(0, totalQuantity - reservedQuantity),
        totalCost: Math.round(totalCost * 100) / 100,
        rowCount: rows.length,
      };
    });
  })
);

/** Daily in/out movement from the immutable ledger, for the trend chart. */
const MovementsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

router.get(
  "/movements",
  requirePermission(Permissions.ViewReports, Permissions.ViewInventory),
  route(async (req: AuthedRequest) => {
    const { days } = MovementsQuerySchema.parse(req.query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const rows = await tx.$queryRaw<{ day: Date; inQty: string; outQty: string }[]>`
        SELECT date_trunc('day', t."createdAt")::date AS day,
          COALESCE(SUM(CASE WHEN t.quantity > 0 THEN t.quantity ELSE 0 END), 0) AS "inQty",
          COALESCE(SUM(CASE WHEN t.quantity < 0 THEN -t.quantity ELSE 0 END), 0) AS "outQty"
        FROM "inventory_transactions" t
        WHERE t."companyId" = ${companyId}::text
          AND t."createdAt" >= now() - (${days}::int * interval '1 day')
        GROUP BY 1
        ORDER BY 1
      `;
      return {
        days,
        points: rows.map((row) => ({
          date: row.day.toISOString().slice(0, 10),
          in: Number(row.inQty),
          out: Number(row.outQty),
        })),
      };
    });
  })
);

// ---------------------------------------------------------------------------
// Needs-attention queue
// ---------------------------------------------------------------------------
//
// One payload for the inventory command page: dead and dying stock with the
// rows inline (capped), plus counts of unfinished work — open counts and
// operations waiting on a human. Thresholds reuse the same rule as the
// overview card: the product's own reorder point, else the company default.
const ATTENTION_LIMIT = 8;

type LowStockRow = {
  productId: string;
  name: string;
  skuCode: string | null;
  onHand: string;
  threshold: string;
};

// Products below their threshold but not yet dead (zero-stock rows are listed
// under out-of-stock instead). Threshold rule matches the overview card: the
// product's own reorder point, else the company default.
function lowStockSource(companyId: string) {
  return Prisma.sql`(
    SELECT p."id" AS "productId", p."name", p."skuCode",
      COALESCE((SELECT SUM(sl."onHand") FROM "stock_levels" sl WHERE sl."productId" = p."id"), 0) AS "onHand",
      COALESCE(
        (SELECT MIN(rp."minStockLevel") FROM "reorder_points" rp WHERE rp."productId" = p."id"),
        (SELECT cs."defaultLowStockThreshold" FROM "company_settings" cs WHERE cs."companyId" = p."companyId"),
        0
      ) AS "threshold"
    FROM "products" p
    WHERE p."companyId" = ${companyId}::text
      AND p."deletedAt" IS NULL
      AND p."isActive" = true
      AND p."trackStock" = true
  ) AS s`;
}

router.get(
  "/attention",
  requirePermission(Permissions.ViewReports, Permissions.ViewInventory),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      // "Out of stock" is a statement about the product's total position, not
      // about any single stock row. `NOT EXISTS (... onHand > 0)` reads a
      // product as in-stock when it has one positive row and a larger negative
      // one — +3, +3, -6 nets to zero but the old check saw the +3s. Summing
      // first is what makes the panel agree with the product list.
      const outItems = await tx.$queryRaw<{ productId: string; name: string; skuCode: string | null }[]>`
        SELECT p."id" AS "productId", p."name", p."skuCode"
        FROM "products" p
        WHERE p."companyId" = ${companyId}::text
          AND p."deletedAt" IS NULL
          AND p."isActive" = true
          AND p."trackStock" = true
          AND GREATEST(0, COALESCE(
                (SELECT SUM(sl."onHand") FROM "stock_levels" sl WHERE sl."productId" = p."id"), 0
              ) - COALESCE(
                (SELECT SUM(sl."reserved") FROM "stock_levels" sl WHERE sl."productId" = p."id"), 0
              )) <= 0
        ORDER BY p."name"
        LIMIT ${ATTENTION_LIMIT}
      `;
      const outTotal = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count
        FROM "products" p
        WHERE p."companyId" = ${companyId}::text
          AND p."deletedAt" IS NULL
          AND p."isActive" = true
          AND p."trackStock" = true
          AND GREATEST(0, COALESCE(
                (SELECT SUM(sl."onHand") FROM "stock_levels" sl WHERE sl."productId" = p."id"), 0
              ) - COALESCE(
                (SELECT SUM(sl."reserved") FROM "stock_levels" sl WHERE sl."productId" = p."id"), 0
              )) <= 0
      `;
      const lowItems = await tx.$queryRaw<LowStockRow[]>(
        Prisma.sql`SELECT s."productId", s."name", s."skuCode", s."onHand", s."threshold"
          FROM ${lowStockSource(companyId)}
          WHERE s."onHand" <= s."threshold" AND s."onHand" > 0
          ORDER BY s."onHand" ASC
          LIMIT ${ATTENTION_LIMIT}`
      );
      const lowTotal = await tx.$queryRaw<{ count: bigint }[]>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count
          FROM ${lowStockSource(companyId)}
          WHERE s."onHand" <= s."threshold" AND s."onHand" > 0`
      );
      const openCounts = await tx.stockCount.count({
        where: { companyId, deletedAt: null, status: { in: ["DRAFT", "IN_PROGRESS"] } },
      });
      const pendingOps = await tx.stockOperation.count({
        where: { companyId, deletedAt: null, status: { in: ["DRAFT", "PENDING", "READY"] } },
      });

      return {
        outOfStock: {
          total: Number(outTotal[0]?.count ?? 0),
          items: outItems,
        },
        lowStock: {
          total: Number(lowTotal[0]?.count ?? 0),
          items: lowItems.map((row) => ({
            ...row,
            onHand: Number(row.onHand),
            threshold: Number(row.threshold),
          })),
        },
        openCounts,
        pendingOperations: pendingOps,
      };
    })
  )
);

// ---------------------------------------------------------------------------
// Per-location stock report
// ---------------------------------------------------------------------------
//
// The stock report above is one row per product-per-bin; this rolls the same
// stock_levels data up by storage location, which is the question an operator
// asks when deciding where to put a new delivery: how full is each location and
// what is it worth. Read-only, like every other report.
//
// Locations with nothing in them are still listed (LEFT JOIN semantics via a
// separate query), because "this location is empty" is itself the answer.

type LocationAggRow = {
  locationId: string;
  locationName: string;
  locationCode: string | null;
  warehouseId: string;
  warehouseName: string;
  productCount: bigint;
  totalQuantity: string;
  reservedQuantity: string;
  totalCost: string;
};

router.get(
  "/locations",
  requirePermission(Permissions.ViewReports, Permissions.ViewInventory),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = StockReportFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const term = input.search?.trim();

      // Aggregated in SQL rather than in JS: a company can hold far more stock
      // rows than the page size, and pulling them all to sum them here would
      // make the report's cost grow with the catalogue.
      // The tenant and soft-delete predicates live on the JOINs above (a LEFT
      // JOIN needs its conditions in the ON clause, or it silently becomes an
      // inner join). Only location-level filters belong in WHERE.
      const where = Prisma.sql`
        l."companyId" = ${companyId}::text
        AND l."deletedAt" IS NULL
        ${filter.warehouseId ? Prisma.sql`AND l."warehouseId" = ${filter.warehouseId}::text` : Prisma.empty}
        ${filter.categoryId ? Prisma.sql`AND p."categoryId" = ${filter.categoryId}::text` : Prisma.empty}
        ${filter.onlyInStock ? Prisma.sql`AND sl."onHand" <> 0` : Prisma.empty}
        ${
          term
            ? Prisma.sql`AND (l."name" ILIKE ${"%" + term + "%"} OR COALESCE(l."code", '') ILIKE ${"%" + term + "%"} OR w."name" ILIKE ${"%" + term + "%"})`
            : Prisma.empty
        }
      `;

      // LEFT JOINs so a location with no stock still appears: "this location is
      // empty" is itself the answer an operator wants from this report.
      const rows = await tx.$queryRaw<LocationAggRow[]>`
        SELECT l."id" AS "locationId", l."name" AS "locationName", l."code" AS "locationCode",
          w."id" AS "warehouseId", w."name" AS "warehouseName",
          COUNT(DISTINCT sl."productId")::bigint AS "productCount",
          COALESCE(SUM(sl."onHand"), 0)::text AS "totalQuantity",
          COALESCE(SUM(sl."reserved"), 0)::text AS "reservedQuantity",
          COALESCE(SUM(sl."onHand" * p."costPrice"), 0)::text AS "totalCost"
        FROM "storage_locations" l
        JOIN "warehouses" w ON w."id" = l."warehouseId"
        LEFT JOIN "stock_levels" sl ON sl."storageLocationId" = l."id" AND sl."companyId" = ${companyId}::text
        LEFT JOIN "products" p ON p."id" = sl."productId" AND p."deletedAt" IS NULL
        WHERE ${where}
        GROUP BY l."id", l."name", l."code", w."id", w."name"
        ORDER BY COALESCE(SUM(sl."onHand" * p."costPrice"), 0) DESC, l."name" ASC
        OFFSET ${(input.page - 1) * input.pageSize}
        LIMIT ${input.pageSize}
      `;

      const totalRows = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT l."id"
          FROM "storage_locations" l
          JOIN "warehouses" w ON w."id" = l."warehouseId"
          LEFT JOIN "stock_levels" sl ON sl."storageLocationId" = l."id" AND sl."companyId" = ${companyId}::text
          LEFT JOIN "products" p ON p."id" = sl."productId" AND p."deletedAt" IS NULL
          WHERE ${where}
          GROUP BY l."id"
        ) AS grouped
      `;

      return toPage(
        rows.map((row) => {
          const onHand = Number(row.totalQuantity);
          const reserved = Number(row.reservedQuantity);
          return {
            locationId: row.locationId,
            locationName: row.locationName,
            locationCode: row.locationCode,
            warehouseId: row.warehouseId,
            warehouseName: row.warehouseName,
            productCount: Number(row.productCount),
            quantityOnHand: onHand,
            reservedQuantity: reserved,
            availableQuantity: Math.max(0, onHand - reserved),
            totalCost: Math.round(Number(row.totalCost) * 100) / 100,
          };
        }),
        Number(totalRows[0]?.count ?? 0),
        input
      );
    });
  })
);

export { router as stockReportRoutes };
