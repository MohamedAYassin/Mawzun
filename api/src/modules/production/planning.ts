import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { parsePagination, toPage, type PaginationInput } from "../../shared/pagination.js";
import { scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { mergeRelations } from "../../shared/relations.js";

// ---------------------------------------------------------------------------
// Production planning
// ---------------------------------------------------------------------------
//
// Two read-only answers to "what do we need to make?" — the first from demand
// (sold but not in stock), the second from policy (below the minimum a
// warehouse should hold). Both are derived on read rather than stored, because
// a stored shortfall is a shortfall that is already out of date.

export const NeedsManufacturingFilterSchema = z.object({
  /** Hides lines already covered by an open batch. */
  onlyUnbatched: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export const DeficitFilterSchema = z.object({
  warehouseId: z.string().trim().min(1).optional(),
});

/**
 * A search term applied to the related product rather than the row itself.
 *
 * Prisma has no dotted path syntax in `where`, so a search across a relation
 * has to be written as a nested filter instead of a flat column list.
 */
function productSearch(search?: string) {
  const term = search?.trim();
  if (!term) return {};
  return {
    product: {
      OR: [
        { name: { contains: term, mode: "insensitive" as const } },
        { skuCode: { contains: term, mode: "insensitive" as const } },
      ],
    },
  };
}

const router = Router();
/**
 * Order lines flagged as needing manufacture, with what is actually on hand.
 *
 * The shortage is the gap between what was sold and what the warehouse can
 * supply today. It is computed against total on-hand across every location
 * because a batch is made once for the company, not once per bin.
 */
router.get(
  "/needs-manufacturing",
  requirePermission(Permissions.ViewProductionBatches, Permissions.ViewOrders),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = NeedsManufacturingFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Scalars + one relation at a time (see mergeRelations). Prisma would
      // otherwise fetch `product` and `order` CONCURRENTLY on one connection.
      const lines = await tx.orderItem.findMany({
        where: {
          companyId,
          needsManufacturing: true,
          ...(filter.onlyUnbatched ? { order: { productionBatchId: null } } : {}),
          ...productSearch(input.search),
        },
        select: { id: true, quantity: true },
        orderBy: { createdAt: "desc" },
        take: 2000,
      });
      type LineMerged = {
        product: { id: string; name: string; skuCode: string | null };
        order: { id: string; orderNumber: string; status: string; createdAt: Date; customer: { id: string; name: string; phoneNumber1: string } | null };
      };
      const linesWithRelations = await mergeRelations<typeof lines[number], LineMerged>(tx, lines, [
        (ids) =>
          tx.orderItem.findMany({
            where: { id: { in: ids } },
            select: { id: true, product: { select: { id: true, name: true, skuCode: true } } },
          }),
        (ids) =>
          tx.orderItem.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              order: {
                select: {
                  id: true,
                  orderNumber: true,
                  status: true,
                  createdAt: true,
                  customer: { select: { id: true, name: true, phoneNumber1: true } },
                },
              },
            },
          }),
      ]);

      const productIds = [...new Set(linesWithRelations.map((line) => line.product.id))];

      // Total on hand per product, summed across every location.
      const levels = await tx.stockLevel.groupBy({
        by: ["productId"],
        where: { companyId, productId: { in: productIds } },
        _sum: { onHand: true, reserved: true },
      });
      const onHand = new Map(levels.map((l) => [l.productId, Number(l._sum.onHand ?? 0)]));
      const reserved = new Map(levels.map((l) => [l.productId, Number(l._sum.reserved ?? 0)]));

      // Demand per product, so the shortage is against the whole backlog and
      // not against each order independently.
      const demand = new Map<string, number>();
      for (const line of linesWithRelations) {
        demand.set(line.product.id, (demand.get(line.product.id) ?? 0) + Number(line.quantity));
      }

      const entries = linesWithRelations.map((line) => {
        const available = onHand.get(line.product.id) ?? 0;
        return {
          orderItemId: line.id,
          orderId: line.order.id,
          orderNumber: line.order.orderNumber,
          orderStatus: line.order.status,
          orderCreatedAt: line.order.createdAt,
          customerName: line.order.customer?.name ?? null,
          customerPhone: line.order.customer?.phoneNumber1 ?? null,
          productId: line.product.id,
          productName: line.product.name,
          skuCode: line.product.skuCode,
          quantity: Number(line.quantity),
          totalDemand: demand.get(line.product.id) ?? Number(line.quantity),
          availableQuantity: available,
          reservedQuantity: reserved.get(line.product.id) ?? 0,
          shortageQuantity: Math.max(0, (demand.get(line.product.id) ?? 0) - available),
        };
      });

      const sorted = entries.sort((a, b) => b.shortageQuantity - a.shortageQuantity);
      return toPage(pageSliceManual(sorted, input), sorted.length, input);
    });
  })
);

/**
 * Products sitting below the minimum their warehouse should hold.
 *
 * Per warehouse, because a reorder point is set per warehouse: a product can
 * be healthy in the main store and starving in the branch.
 */
router.get(
  "/deficits",
  requirePermission(Permissions.ViewProductionBatches, Permissions.ViewInventory),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = DeficitFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      // Scalars + one relation at a time (see mergeRelations).
      const points = await tx.reorderPoint.findMany({
        where: {
          companyId,
          ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
          product: { deletedAt: null, ...productSearch(input.search).product },
        },
        select: {
          id: true,
          minStockLevel: true,
          maxStockLevel: true,
          reorderQuantity: true,
        },
        take: 2000,
      });
      type PointMerged = {
        product: { id: string; name: string; skuCode: string | null };
        warehouse: { id: string; name: string };
      };
      const pointsWithRelations = await mergeRelations<typeof points[number], PointMerged>(tx, points, [
        (ids) =>
          tx.reorderPoint.findMany({
            where: { id: { in: ids } },
            select: { id: true, product: { select: { id: true, name: true, skuCode: true } } },
          }),
        (ids) =>
          tx.reorderPoint.findMany({
            where: { id: { in: ids } },
            select: { id: true, warehouse: { select: { id: true, name: true } } },
          }),
      ]);

      if (pointsWithRelations.length === 0) return toPage([], 0, input);

      // Stock per product per warehouse. StockLevel is keyed by location, so
      // it is summed up to the warehouse before it can be compared.
      const levels = await tx.stockLevel.groupBy({
        by: ["productId", "storageLocationId"],
        where: {
          companyId,
          productId: { in: pointsWithRelations.map((p) => p.product.id) },
          ...(filter.warehouseId
            ? { storageLocation: { warehouseId: filter.warehouseId } }
            : {}),
        },
        _sum: { onHand: true },
      });

      const locationIds = [...new Set(levels.map((l) => l.storageLocationId))];
      const locations = await tx.storageLocation.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, warehouseId: true },
      });
      const warehouseOf = new Map(locations.map((l) => [l.id, l.warehouseId]));

      const available = new Map<string, number>();
      for (const level of levels) {
        const key = `${level.productId}:${warehouseOf.get(level.storageLocationId) ?? ""}`;
        available.set(key, (available.get(key) ?? 0) + Number(level._sum.onHand ?? 0));
      }

      const entries = pointsWithRelations
        .map((point) => {
          const onHand = available.get(`${point.product.id}:${point.warehouse.id}`) ?? 0;
          const minimum = Number(point.minStockLevel);
          return {
            productId: point.product.id,
            productName: point.product.name,
            skuCode: point.product.skuCode,
            warehouseId: point.warehouse.id,
            warehouseName: point.warehouse.name,
            minStockLevel: minimum,
            maxStockLevel: Number(point.maxStockLevel),
            reorderQuantity: Number(point.reorderQuantity),
            availableQuantity: onHand,
            deficit: Math.max(0, minimum - onHand),
          };
        })
        .filter((entry) => entry.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit);

      return toPage(pageSliceManual(entries, input), entries.length, input);
    });
  })
);

/**
 * Slices an in-memory list.
 *
 * Both of these endpoints aggregate before they can be ranked by the very
 * number they are sorted on, so the page is cut here rather than in SQL.
 */
function pageSliceManual<T>(items: T[], input: PaginationInput): T[] {
  const start = (input.page - 1) * input.pageSize;
  return items.slice(start, start + input.pageSize);
}

export { router as productionPlanningRoutes };