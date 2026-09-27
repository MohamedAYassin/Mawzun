import { Router } from "express";
import type { Db } from "../../config/database.js";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// ---------------------------------------------------------------------------
// Dashboard cards
// ---------------------------------------------------------------------------
//
// Five summary payloads, one per home-screen card. Each is a handful of
// aggregates rather than a loaded table: the previous implementation pulled
// every row into memory to count it, which meant the dashboard got slower in
// proportion to how much data the company had.

/** The order statuses that count as "past confirmation and still in flight". */
const CONFIRMED_STATUSES = ["CONFIRMED", "ON_THE_WAY", "DELIVERED"] as const;

const router = Router();
router.get(
  "/products",
  requirePermission(Permissions.ViewReports, Permissions.ViewProducts),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const total = await tx.product.count({ where: { companyId, deletedAt: null } });
      const active = await tx.product.count({ where: { companyId, deletedAt: null, isActive: true } });
      const lowStock = await countLowStock(tx, companyId);
      const outOfStock = await countOutOfStock(tx, companyId);

      return {
        totalProducts: total,
        activeProducts: active,
        lowStockProducts: lowStock,
        outOfStockProducts: outOfStock,
      };
    })
  )
);

router.get(
  "/inventory",
  requirePermission(Permissions.ViewReports, Permissions.ViewInventory),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const totals = await tx.stockLevel.aggregate({
        where: { companyId },
        _sum: { onHand: true, reserved: true },
      });
      const value = await inventoryValue(tx, companyId);
      const movements = await tx.inventoryTransaction.groupBy({
        by: ["transactionType"],
        where: { companyId },
        _sum: { quantity: true },
      });

      const sum = (types: string[]) =>
        movements
          .filter((row) => types.includes(row.transactionType))
          .reduce((total, row) => total + Number(row._sum.quantity ?? 0), 0);

      const onHand = Number(totals._sum.onHand ?? 0);
      const reserved = Number(totals._sum.reserved ?? 0);

      return {
        totalQuantity: onHand,
        availableQuantity: Math.max(0, onHand - reserved),
        reservedQuantity: reserved,
        totalValue: value,
        totalIn: sum([
          "OPENING",
          "PURCHASE",
          "RETURN_IN",
          "TRANSFER_IN",
          "ADJUSTMENT_IN",
          "PRODUCTION_IN",
        ]),
        totalOut: sum([
          "SALE",
          "RETURN_OUT",
          "TRANSFER_OUT",
          "ADJUSTMENT_OUT",
          "PRODUCTION_OUT",
          "SCRAP",
        ]),
      };
    })
  )
);

router.get(
  "/orders",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const sales = await tx.order.aggregate({
        where: { companyId, deletedAt: null, type: "SALE" },
        _sum: { orderActualPrice: true },
        _count: { _all: true },
      });
      const returns = await tx.order.aggregate({
        where: { companyId, deletedAt: null, type: "RETURN" },
        _sum: { orderActualPrice: true },
      });
      const items = await tx.orderItem.aggregate({ where: { companyId }, _sum: { quantity: true } });
      const delivered = await tx.order.count({ where: { companyId, deletedAt: null, status: "DELIVERED" } });

      const orderCount = sales._count._all;
      const totalAmount = Number(sales._sum.orderActualPrice ?? 0);
      const returnedAmount = Number(returns._sum.orderActualPrice ?? 0);

      return {
        orderCount,
        totalAmount,
        totalQuantity: Number(items._sum.quantity ?? 0),
        averageOrderPrice: orderCount ? totalAmount / orderCount : 0,
        deliveredCount: delivered,
        totalReturnedAmount: returnedAmount,
        netRevenue: totalAmount - returnedAmount,
      };
    })
  )
);

router.get(
  "/purchases",
  requirePermission(Permissions.ViewReports, Permissions.ViewPurchaseOrders),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const received = await tx.purchaseOrder.aggregate({
        where: { companyId, deletedAt: null, status: { in: ["RECEIVED", "PARTIALLY_RECEIVED"] } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      });
      const pending = await tx.purchaseOrder.aggregate({
        where: { companyId, deletedAt: null, status: { in: ["DRAFT", "ORDERED"] } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      });
      const cancelled = await tx.purchaseOrder.count({ where: { companyId, deletedAt: null, status: "CANCELLED" } });

      return {
        receivedCount: received._count._all,
        receivedAmount: Number(received._sum.totalAmount ?? 0),
        pendingCount: pending._count._all,
        pendingAmount: Number(pending._sum.totalAmount ?? 0),
        cancelledCount: cancelled,
      };
    })
  )
);

router.get(
  "/shipping",
  requirePermission(Permissions.ViewReports, Permissions.ViewOrders),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const groups = await tx.order.groupBy({
        by: ["status"],
        where: { companyId, deletedAt: null, type: "SALE" },
        _count: { _all: true },
        _sum: { orderActualPrice: true, shippingCost: true },
      });

      const by = (status: string) =>
        groups.find((row) => row.status === status) ?? {
          _count: { _all: 0 },
          _sum: { orderActualPrice: null, shippingCost: null },
        };

      const delivered = by("DELIVERED");
      const returned = by("RETURNED");
      const notDelivered = by("NOT_DELIVERED");

      return {
        totalShipments:
          delivered._count._all + returned._count._all + notDelivered._count._all,
        deliveredCount: delivered._count._all,
        deliveredAmount: Number(delivered._sum.orderActualPrice ?? 0),
        returnedCount: returned._count._all,
        returnedAmount: Number(returned._sum.orderActualPrice ?? 0),
        notDeliveredCount: notDelivered._count._all,
        totalShippingCost: groups.reduce(
          (total, row) => total + Number(row._sum.shippingCost ?? 0),
          0
        ),
      };
    })
  )
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Products at or below the level a company considers low.
 *
 * A product with a reorder point is measured against its own minimum; one
 * without falls back to the company-wide default threshold. Both are counted
 * in SQL because the alternative is loading every product and every stock
 * level to compare them in the application.
 */
async function countLowStock(tx: Db, companyId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "products" p
    WHERE p."companyId" = ${companyId}::text
      AND p."deletedAt" IS NULL
      AND p."isActive" = true
      AND COALESCE((
        SELECT SUM(sl."onHand") FROM "stock_levels" sl WHERE sl."productId" = p."id"
      ), 0) <= COALESCE((
        SELECT MIN(rp."minStockLevel") FROM "reorder_points" rp WHERE rp."productId" = p."id"
      ), (
        SELECT cs."defaultLowStockThreshold" FROM "company_settings" cs WHERE cs."companyId" = p."companyId"
      ), 0)
  `;
  return Number(rows[0]?.count ?? 0);
}

async function countOutOfStock(tx: Db, companyId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "products" p
    WHERE p."companyId" = ${companyId}::text
      AND p."deletedAt" IS NULL
      AND p."isActive" = true
      AND p."trackStock" = true
      AND NOT EXISTS (
        SELECT 1 FROM "stock_levels" sl
        WHERE sl."productId" = p."id" AND sl."onHand" > 0
      )
  `;
  return Number(rows[0]?.count ?? 0);
}

/** Stock valued at cost. A join aggregate Prisma's query API cannot express. */
async function inventoryValue(tx: Db, companyId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: string | number | null }[]>`
    SELECT COALESCE(SUM(sl."onHand" * p."costPrice"), 0) AS value
    FROM "stock_levels" sl
    JOIN "products" p ON p."id" = sl."productId"
    WHERE sl."companyId" = ${companyId}::text
  `;
  return Number(rows[0]?.value ?? 0);
}

export { router as overviewRoutes, CONFIRMED_STATUSES };
