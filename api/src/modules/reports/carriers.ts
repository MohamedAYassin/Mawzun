import { Router } from "express";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { RangeSchema } from "./orders.js";
import { Prisma } from "../../generated/prisma/client.js";

// ---------------------------------------------------------------------------
// Carrier performance
// ---------------------------------------------------------------------------
//
// These need conditional aggregation — counting delivered orders and returned
// orders in the same pass — which Prisma's groupBy cannot express. Raw SQL is
// used deliberately here, and it still runs inside the request's company
// scope, so row-level security applies to it exactly as it does to any other
// query.

const router = Router();
function rangeFilter(from?: Date, to?: Date) {
  return Prisma.join(
    [
      from ? Prisma.sql`AND o."createdAt" >= ${from}` : Prisma.empty,
      to ? Prisma.sql`AND o."createdAt" <= ${to}` : Prisma.empty,
    ],
    " "
  );
}

/** Orders that were actually handed to a carrier. */
function carrierScope(companyId: string, extra: Prisma.Sql = Prisma.empty) {
  return Prisma.sql`
    FROM "orders" o
    JOIN "carriers" c ON c."id" = o."carrierId"
    WHERE o."companyId" = ${companyId}::text
      AND o."deletedAt" IS NULL
      AND o."type" = 'SALE'
      AND o."carrierId" IS NOT NULL
      ${extra}
  `;
}

router.get(
  "/most-used",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = RangeSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const rows = await tx.$queryRaw<
        { carrierId: string; carrierName: string; ordersCount: bigint }[]
      >`
        SELECT c."id" AS "carrierId", MIN(c."name") AS "carrierName", COUNT(*)::bigint AS "ordersCount"
        ${carrierScope(req.ctx.companyId!, rangeFilter(query.from, query.to))}
        GROUP BY c."id"
        ORDER BY "ordersCount" DESC
      `;

      const total = rows.reduce((sum, row) => sum + Number(row.ordersCount ?? 0), 0);
      return {
        carriers: rows.map((row) => {
          const count = Number(row.ordersCount ?? 0);
          return {
            carrierId: row.carrierId,
            carrierName: row.carrierName,
            ordersCount: count,
            percentage: total ? round((count / total) * 100) : 0,
          };
        }),
      };
    });
  })
);

/**
 * Average days from booking to delivery.
 *
 * Measured on `deliveredAt` rather than `updatedAt`: the latter moves for
 * reasons that have nothing to do with shipping, which made the old figure
 * drift every time someone edited an old order.
 */
router.get(
  "/fastest",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = RangeSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const rows = await tx.$queryRaw<
        {
          carrierId: string;
          carrierName: string;
          averageDeliveryDays: string | number | null;
          deliveredOrders: bigint;
        }[]
      >`
        SELECT
          c."id" AS "carrierId",
          MIN(c."name") AS "carrierName",
          AVG(EXTRACT(EPOCH FROM (o."deliveredAt" - o."createdAt")) / 86400.0) AS "averageDeliveryDays",
          COUNT(*)::bigint AS "deliveredOrders"
        ${carrierScope(
          req.ctx.companyId!,
          Prisma.join(
            [
              Prisma.sql`AND o."status" = 'DELIVERED'`,
              Prisma.sql`AND o."deliveredAt" IS NOT NULL`,
              rangeFilter(query.from, query.to),
            ],
            " "
          )
        )}
        GROUP BY c."id"
        ORDER BY "averageDeliveryDays" ASC NULLS LAST
      `;

      return {
        carriers: rows.map((row) => ({
          carrierId: row.carrierId,
          carrierName: row.carrierName,
          averageDeliveryDays: row.averageDeliveryDays === null ? null : round(Number(row.averageDeliveryDays)),
          deliveredOrders: Number(row.deliveredOrders ?? 0),
        })),
      };
    });
  })
);

router.get(
  "/success-rate",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = RangeSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const rows = await tx.$queryRaw<
        {
          carrierId: string;
          carrierName: string;
          confirmedOrders: bigint;
          deliveredOrders: bigint;
          returnedOrders: bigint;
        }[]
      >`
        SELECT
          c."id" AS "carrierId",
          MIN(c."name") AS "carrierName",
          COUNT(*) FILTER (WHERE o."status" IN ('CONFIRMED', 'ON_THE_WAY', 'DELIVERED'))::bigint AS "confirmedOrders",
          COUNT(*) FILTER (WHERE o."status" = 'DELIVERED')::bigint AS "deliveredOrders",
          COUNT(*) FILTER (WHERE o."status" IN ('RETURNED', 'RETURNED_TO_WAREHOUSE'))::bigint AS "returnedOrders"
        ${carrierScope(req.ctx.companyId!, rangeFilter(query.from, query.to))}
        GROUP BY c."id"
        ORDER BY "confirmedOrders" DESC
      `;

      return {
        carriers: rows.map((row) => {
          const confirmed = Number(row.confirmedOrders ?? 0);
          const delivered = Number(row.deliveredOrders ?? 0);
          return {
            carrierId: row.carrierId,
            carrierName: row.carrierName,
            confirmedOrders: confirmed,
            deliveredOrders: delivered,
            returnedOrders: Number(row.returnedOrders ?? 0),
            successPercentage: confirmed ? round((delivered / confirmed) * 100) : 0,
          };
        }),
      };
    });
  })
);

router.get(
  "/cost-stats",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = RangeSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const rows = await tx.$queryRaw<
        {
          carrierId: string;
          carrierName: string;
          totalShippingCost: string | number | null;
          ordersCount: bigint;
        }[]
      >`
        SELECT
          c."id" AS "carrierId",
          MIN(c."name") AS "carrierName",
          SUM(o."shippingCost") AS "totalShippingCost",
          COUNT(*)::bigint AS "ordersCount"
        ${carrierScope(req.ctx.companyId!, rangeFilter(query.from, query.to))}
        GROUP BY c."id"
        ORDER BY "totalShippingCost" DESC
      `;

      return {
        carriers: rows.map((row) => {
          const total = Number(row.totalShippingCost ?? 0);
          const count = Number(row.ordersCount ?? 0);
          return {
            carrierId: row.carrierId,
            carrierName: row.carrierName,
            totalShippingCost: round(total),
            averageShippingCost: count ? round(total / count) : 0,
            ordersCount: count,
          };
        }),
      };
    });
  })
);

/** Where a given carrier succeeds and where it struggles. */
router.get(
  "/:carrierId/city-success-rate",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const query = RangeSchema.parse(req.query);
    const carrierId = param(req, "carrierId");

    return scoped(req, async (tx) => {
      const rows = await tx.$queryRaw<
        {
          cityId: string | null;
          cityName: string | null;
          confirmedOrders: bigint;
          deliveredOrders: bigint;
          returnedOrders: bigint;
        }[]
      >`
        SELECT
          ci."id" AS "cityId",
          MIN(ci."name") AS "cityName",
          COUNT(*) FILTER (WHERE o."status" IN ('CONFIRMED', 'ON_THE_WAY', 'DELIVERED'))::bigint AS "confirmedOrders",
          COUNT(*) FILTER (WHERE o."status" = 'DELIVERED')::bigint AS "deliveredOrders",
          COUNT(*) FILTER (WHERE o."status" IN ('RETURNED', 'RETURNED_TO_WAREHOUSE'))::bigint AS "returnedOrders"
        FROM "orders" o
        LEFT JOIN "cities" ci ON ci."id" = o."cityId"
        WHERE o."companyId" = ${req.ctx.companyId!}::text
          AND o."deletedAt" IS NULL
          AND o."type" = 'SALE'
          AND o."carrierId" = ${carrierId}::text
          ${rangeFilter(query.from, query.to)}
        GROUP BY ci."id"
        ORDER BY "confirmedOrders" DESC
      `;

      return {
        cities: rows.map((row) => {
          const confirmed = Number(row.confirmedOrders ?? 0);
          const delivered = Number(row.deliveredOrders ?? 0);
          return {
            cityId: row.cityId,
            cityName: row.cityName ?? "غير محدد",
            confirmedOrders: confirmed,
            deliveredOrders: delivered,
            returnedOrders: Number(row.returnedOrders ?? 0),
            successPercentage: confirmed ? round((delivered / confirmed) * 100) : 0,
          };
        }),
      };
    });
  })
);

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export { router as carrierReportRoutes };
