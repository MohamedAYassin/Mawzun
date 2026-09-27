import { Router } from "express";
import { z } from "zod";
import type { Db } from "../../config/database.js";
import { Prisma } from "../../generated/prisma/client.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { parsePagination } from "../../shared/pagination.js";
import { scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { CONFIRMED_STATUSES } from "./overview.js";

// ---------------------------------------------------------------------------
// Order analytics
// ---------------------------------------------------------------------------

export const RangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const TopSchema = z.object({
  top: z.coerce.number().int().min(1).max(50).default(5),
});

export const GraphSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

/** Builds the `createdAt` filter shared by every order report. */
function createdAtRange(query: { from?: Date; to?: Date }) {
  if (!query.from && !query.to) return {};
  return {
    createdAt: {
      ...(query.from ? { gte: query.from } : {}),
      ...(query.to ? { lte: query.to } : {}),
    },
  };
}

type Range = ReturnType<typeof createdAtRange>;

/** Sale orders inside the range. Returns never count as revenue. */
function saleWhere(companyId: string, range: Range) {
  return { companyId, deletedAt: null, type: "SALE" as const, ...range };
}

const router = Router();
/** Headline numbers plus the two "best" callouts the dashboard shows. */
router.get(
  "/totals",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = { ...RangeSchema.parse(req.query), ...parsePagination(req.query) };
    const range = createdAtRange(query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const where = saleWhere(companyId, range);

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const amounts = await tx.order.aggregate({ where, _sum: { orderActualPrice: true } });
      const orderCount = await tx.order.count({ where });
      const quantities = await tx.orderItem.aggregate({
        where: { companyId, order: where },
        _sum: { quantity: true },
      });
      const returns = await tx.order.aggregate({
        where: { companyId, deletedAt: null, type: "RETURN", ...range },
        _sum: { orderActualPrice: true },
      });
      const byCategory = await categoryQuantities(tx, companyId, where);
      const byEmployee = await employeeOrderCounts(tx, companyId, where);

      const totalAmount = Number(amounts._sum.orderActualPrice ?? 0);
      const totalQuantity = Number(quantities._sum.quantity ?? 0);
      const returnedAmount = Number(returns._sum.orderActualPrice ?? 0);

      return {
        totalAmount,
        orderCount,
        totalQuantity,
        averageOrderPrice: orderCount ? totalAmount / orderCount : 0,
        averageItemsPerOrder: orderCount ? totalQuantity / orderCount : 0,
        totalReturnedAmount: returnedAmount,
        netRevenue: totalAmount - returnedAmount,
        topCategory: byCategory[0] ?? null,
        topEmployee: byEmployee[0] ?? null,
      };
    });
  })
);

/**
 * A daily series, bucketed in the database.
 *
 * `date_trunc` and `generate_series` do in one query what the previous version
 * did by loading every order in the range into an array. The series generator
 * also fills days with no orders, which a plain GROUP BY cannot do and which
 * is the whole point of a chart with a continuous axis.
 */
router.get(
  "/graph",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = GraphSchema.parse(req.query);
    const to = query.to ?? new Date();
    const from =
      query.from ?? new Date(to.getTime() - (query.days - 1) * 24 * 60 * 60 * 1000);
    from.setHours(0, 0, 0, 0);

    return scoped(req, async (tx) => {
      // The bucket unit travels as a bound parameter rather than a string
      // literal repeated inside the template. Prisma rewrites tagged-template
      // placeholders, and a literal that appears more than once ('day' here)
      // came back renumbered on its later occurrences, which turned the
      // series join into a text = uuid comparison and 500'd the endpoint.
      const DAY = "day";
      const rows = await tx.$queryRaw<
        { day: Date; value: string | number | null; count: bigint }[]
      >`
        SELECT
          series.day::date AS day,
          COALESCE(SUM(o."orderActualPrice"), 0) AS value,
          COUNT(o."id")::bigint AS count
        FROM generate_series(
          date_trunc(${DAY}::text, ${from}::timestamp),
          date_trunc(${DAY}::text, ${to}::timestamp),
          interval '1 day'
        ) AS series(day)
        LEFT JOIN "orders" o
          ON date_trunc(${DAY}::text, o."createdAt") = series.day
          AND o."companyId" = ${req.ctx.companyId!}::text
          AND o."deletedAt" IS NULL
          AND o."type" = 'SALE'
        GROUP BY series.day
        ORDER BY series.day ASC
      `;

      return {
        from,
        to,
        points: rows.map((row) => ({
          date: row.day,
          value: Number(row.value ?? 0),
          count: Number(row.count ?? 0),
        })),
      };
    });
  })
);

router.get(
  "/status-distribution",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const range = createdAtRange(RangeSchema.parse(req.query));

    return scoped(req, async (tx) => {
      const rows = await tx.order.groupBy({
        by: ["status"],
        where: saleWhere(req.ctx.companyId!, range),
        _count: { _all: true },
      });

      const total = rows.reduce((sum, row) => sum + row._count._all, 0);
      return {
        totalOrders: total,
        statuses: rows
          .map((row) => ({
            status: row.status,
            count: row._count._all,
            percentage: total ? round((row._count._all / total) * 100) : 0,
          }))
          .sort((a, b) => b.count - a.count),
      };
    });
  })
);

router.get(
  "/source-distribution",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const range = createdAtRange(RangeSchema.parse(req.query));

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const rows = await tx.order.groupBy({
        by: ["orderSourceId"],
        where: saleWhere(companyId, range),
        _count: { _all: true },
      });
      const sources = await tx.orderSource.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, name: true },
      });

      const names = new Map(sources.map((source) => [source.id, source.name]));
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);

      return {
        totalOrders: total,
        sources: rows
          .map((row) => ({
            sourceId: row.orderSourceId,
            sourceName: row.orderSourceId ? (names.get(row.orderSourceId) ?? null) : null,
            count: row._count._all,
            percentage: total ? round((row._count._all / total) * 100) : 0,
          }))
          .sort((a, b) => b.count - a.count),
      };
    });
  })
);

/** How much of what was confirmed actually reached the customer. */
router.get(
  "/confirmed",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const range = createdAtRange(RangeSchema.parse(req.query));

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const confirmed = await tx.order.aggregate({
        where: {
          ...saleWhere(companyId, range),
          status: { in: [...CONFIRMED_STATUSES] },
        },
        _sum: { orderActualPrice: true },
        _count: { _all: true },
      });
      const delivered = await tx.order.count({
        where: { ...saleWhere(companyId, range), status: "DELIVERED" },
      });

      const count = confirmed._count._all;
      return {
        count,
        totalAmount: Number(confirmed._sum.orderActualPrice ?? 0),
        deliveredCount: delivered,
        deliveryPercentage: count ? round((delivered / count) * 100) : 0,
      };
    });
  })
);

// ---------------------------------------------------------------------------
// Top-N rankings
// ---------------------------------------------------------------------------

router.get(
  "/top-products",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = { ...RangeSchema.parse(req.query), ...TopSchema.parse(req.query) };
    const range = createdAtRange(query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const rows = await tx.orderItem.groupBy({
        by: ["productId"],
        where: { companyId, order: saleWhere(companyId, range) },
        _sum: { quantity: true, unitPrice: true, unitCost: true },
      });

      if (rows.length === 0) return { products: [] };

      const products = await tx.product.findMany({
        where: { id: { in: rows.map((row) => row.productId) } },
        select: { id: true, name: true, skuCode: true },
      });
      const names = new Map(products.map((product) => [product.id, product]));

      const total = rows.reduce((sum, row) => sum + Number(row._sum.quantity ?? 0), 0);

      return {
        products: rows
          .map((row) => {
            const quantity = Number(row._sum.quantity ?? 0);
            const revenue = Number(row._sum.unitPrice ?? 0);
            const cost = Number(row._sum.unitCost ?? 0);
            return {
              productId: row.productId,
              productName: names.get(row.productId)?.name ?? null,
              skuCode: names.get(row.productId)?.skuCode ?? null,
              totalQuantity: quantity,
              revenue,
              cost,
              grossProfit: round(revenue - cost),
              percentage: total ? round((quantity / total) * 100) : 0,
            };
          })
          .sort((a, b) => b.totalQuantity - a.totalQuantity)
          .slice(0, query.top),
      };
    });
  })
);

router.get(
  "/top-categories",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = { ...RangeSchema.parse(req.query), ...TopSchema.parse(req.query) };

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const rows = await tx.$queryRaw<
        { categoryId: string | null; categoryName: string | null; quantity: string | number | null }[]
      >`
        SELECT c."id" AS "categoryId", c."name" AS "categoryName", SUM(oi."quantity") AS quantity
        FROM "order_items" oi
        JOIN "orders" o ON o."id" = oi."orderId"
        JOIN "products" p ON p."id" = oi."productId"
        LEFT JOIN "categories" c ON c."id" = p."categoryId"
        WHERE o."companyId" = ${companyId}::text
          AND o."deletedAt" IS NULL
          AND o."type" = 'SALE'
          ${query.from ? Prisma.sql`AND o."createdAt" >= ${query.from}` : Prisma.empty}
          ${query.to ? Prisma.sql`AND o."createdAt" <= ${query.to}` : Prisma.empty}
        GROUP BY c."id", c."name"
        ORDER BY quantity DESC
        LIMIT ${query.top}
      `;

      const total = rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);

      return {
        categories: rows.map((row) => {
          const quantity = Number(row.quantity ?? 0);
          return {
            categoryId: row.categoryId,
            categoryName: row.categoryName ?? "بدون تصنيف",
            totalQuantity: quantity,
            percentage: total ? round((quantity / total) * 100) : 0,
          };
        }),
      };
    });
  })
);

/** Sales attributed to whoever booked the order. */
router.get(
  "/top-employees",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = { ...RangeSchema.parse(req.query), ...TopSchema.parse(req.query) };
    const range = createdAtRange(query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const rows = await tx.order.groupBy({
        by: ["createdById"],
        where: saleWhere(companyId, range),
        _count: { _all: true },
        _sum: { orderActualPrice: true },
      });
      const users = await tx.user.findMany({
        where: { companyId },
        select: { id: true, fullName: true },
      });

      const names = new Map(users.map((user) => [user.id, user.fullName]));
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);

      return {
        employees: rows
          .filter((row) => row.createdById !== null)
          .map((row) => ({
            employeeId: row.createdById,
            employeeName: names.get(row.createdById!) ?? null,
            orderCount: row._count._all,
            totalAmount: Number(row._sum.orderActualPrice ?? 0),
            percentage: total ? round((row._count._all / total) * 100) : 0,
          }))
          .sort((a, b) => b.orderCount - a.orderCount)
          .slice(0, query.top),
      };
    });
  })
);

router.get(
  "/top-return-reasons",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = { ...RangeSchema.parse(req.query), ...TopSchema.parse(req.query) };
    const range = createdAtRange(query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const rows = await tx.order.groupBy({
        by: ["cancelReasonId"],
        where: {
          companyId,
          deletedAt: null,
          type: { in: ["RETURN", "EXCHANGE"] },
          ...range,
        },
        _count: { _all: true },
      });
      const reasons = await tx.cancelReason.findMany({
        where: { companyId, deletedAt: null },
        select: { id: true, name: true },
      });

      const names = new Map(reasons.map((reason) => [reason.id, reason.name]));
      const total = rows.reduce((sum, row) => sum + row._count._all, 0);

      return {
        totalOrders: total,
        reasons: rows
          .map((row) => ({
            reasonId: row.cancelReasonId,
            reasonName: row.cancelReasonId ? (names.get(row.cancelReasonId) ?? null) : null,
            count: row._count._all,
            percentage: total ? round((row._count._all / total) * 100) : 0,
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, query.top),
      };
    });
  })
);

/**
 * Confirmation rate per product.
 *
 * Order lines are counted once per distinct order, so a product appearing on
 * the same order twice does not inflate its own confirmation rate.
 */
router.get(
  "/product-confirmation",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = { ...RangeSchema.parse(req.query), ...TopSchema.parse(req.query) };

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const rows = await tx.$queryRaw<
        {
          productId: string;
          productName: string | null;
          skuCode: string | null;
          orders: bigint;
          confirmed: bigint;
        }[]
      >`
        SELECT
          oi."productId" AS "productId",
          MIN(p."name") AS "productName",
          MIN(p."skuCode") AS "skuCode",
          COUNT(DISTINCT oi."orderId")::bigint AS orders,
          COUNT(DISTINCT CASE WHEN o."status" IN ('CONFIRMED', 'ON_THE_WAY', 'DELIVERED')
            THEN oi."orderId" END)::bigint AS confirmed
        FROM "order_items" oi
        JOIN "orders" o ON o."id" = oi."orderId"
        JOIN "products" p ON p."id" = oi."productId"
        WHERE o."companyId" = ${companyId}::text
          AND o."deletedAt" IS NULL
          AND o."type" = 'SALE'
          ${query.from ? Prisma.sql`AND o."createdAt" >= ${query.from}` : Prisma.empty}
          ${query.to ? Prisma.sql`AND o."createdAt" <= ${query.to}` : Prisma.empty}
        GROUP BY oi."productId"
        ORDER BY orders DESC
        LIMIT ${query.top}
      `;

      return {
        products: rows.map((row) => {
          const orders = Number(row.orders ?? 0);
          const confirmed = Number(row.confirmed ?? 0);
          return {
            productId: row.productId,
            productName: row.productName,
            skuCode: row.skuCode,
            totalOrders: orders,
            confirmedOrders: confirmed,
            confirmationPercentage: orders ? round((confirmed / orders) * 100) : 0,
          };
        }),
      };
    });
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

async function categoryQuantities(tx: Db, companyId: string, where: Record<string, unknown>) {
  const rows = await tx.orderItem.groupBy({
    by: ["productId"],
    where: { companyId, order: where },
    _sum: { quantity: true },
  });
  if (rows.length === 0) return [];

  const products = await tx.product.findMany({
    where: { id: { in: rows.map((row) => row.productId) } },
    select: { id: true, categoryId: true, category: { select: { name: true } } },
  });
  const categoryOf = new Map(products.map((product) => [product.id, product]));

  const totals = new Map<string, { categoryId: string | null; categoryName: string; quantity: number }>();
  for (const row of rows) {
    const product = categoryOf.get(row.productId);
    const key = product?.categoryId ?? "__none__";
    const entry = totals.get(key) ?? {
      categoryId: product?.categoryId ?? null,
      categoryName: product?.category?.name ?? "بدون تصنيف",
      quantity: 0,
    };
    entry.quantity += Number(row._sum.quantity ?? 0);
    totals.set(key, entry);
  }

  return [...totals.values()].sort((a, b) => b.quantity - a.quantity);
}

async function employeeOrderCounts(tx: Db, companyId: string, where: Record<string, unknown>) {
  const rows = await tx.order.groupBy({
    by: ["createdById"],
    where,
    _count: { _all: true },
    _sum: { orderActualPrice: true },
  });

  const users = await tx.user.findMany({
    where: { companyId },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((user) => [user.id, user.fullName]));

  return rows
    .filter((row) => row.createdById !== null)
    .map((row) => ({
      employeeId: row.createdById,
      employeeName: names.get(row.createdById!) ?? null,
      orderCount: row._count._all,
      totalAmount: Number(row._sum.orderActualPrice ?? 0),
    }))
    .sort((a, b) => b.orderCount - a.orderCount);
}

// ---------------------------------------------------------------------------
// Needs-attention queue
// ---------------------------------------------------------------------------
//
// One payload for the sales command page: every order state that requires a
// human, with counts only — the rows themselves live behind the links to the
// orders list. A stuck ON_THE_WAY order is one whose ship date is more than a
// week old; anything younger is still a normal delivery.
router.get(
  "/attention",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000);
      const base = { companyId, deletedAt: null, type: "SALE" } as const;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const fresh = await tx.order.aggregate({
        where: { ...base, status: "NEW" },
        _count: { _all: true },
        _sum: { orderActualPrice: true },
        _min: { createdAt: true },
      });
      const counts = await tx.order.groupBy({
        by: ["status"],
        where: {
          ...base,
          status: { in: ["NO_ANSWER", "POSTPONED", "CONFIRMED", "ON_THE_WAY"] },
        },
        _count: { _all: true },
      });
      const stuck = await tx.order.count({
        where: { ...base, status: "ON_THE_WAY", shippedAt: { lt: weekAgo } },
      });

      const count = (status: string) =>
        counts.find((row) => row.status === status)?._count._all ?? 0;

      return {
        newOrders: {
          count: fresh._count._all,
          value: Number(fresh._sum.orderActualPrice ?? 0),
          oldestCreatedAt: fresh._min.createdAt,
        },
        noAnswer: { count: count("NO_ANSWER") },
        postponed: { count: count("POSTPONED") },
        confirmed: { count: count("CONFIRMED") },
        onTheWay: { count: count("ON_THE_WAY") },
        stuckOnTheWay: { count: stuck, olderThanDays: 7 },
      };
    })
  )
);

export { router as orderReportRoutes };
