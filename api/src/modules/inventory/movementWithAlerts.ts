import type { Db } from "../../config/database.js";
import { NotificationCategory } from "../../generated/prisma/enums.js";
import { applyMovement, type MovementInput, type MovementContext } from "./stockEngine.js";

// ---------------------------------------------------------------------------
// Movement + low-stock notification
// ---------------------------------------------------------------------------
//
// A wrapper around `applyMovement` that also fires the company's low-stock
// notifications when a movement crosses (or returns from) a threshold.
//
// Three thresholds, each set by the operator for a reason, each producing its
// own notification:
//   • reorder-point minStockLevel  → "أعد الطلب"  (reorder now)
//   • reorder-point maxStockLevel  → "المخزون تجاوز الحد الأقصى" (overstocked)
//   • companySettings.defaultLowStockThreshold → "المخزون منخفض" (generic low)
//
// Anti-spam: notifications fire on the *transition*, not the state. Before
// inserting, we look for an unread notification of the same kind for the same
// product+location and skip if one exists — a product that sits low for a
// week nags exactly once, and reading the notification (or restocking) resets
// the nag. Crossing back above the threshold never notifies; only a fresh
// crossing does, because the previous notification will have been marked read
// or will have been superseded.

interface ThresholdRow {
  warehouseId: string;
  minStockLevel: number | { toString(): string };
  maxStockLevel: number | { toString(): string };
}

export interface LowStockOutcome {
  /** Threshold notifications created by this movement, if any. */
  notified: Array<{ kind: string; title: string; message: string }>;
}

const REORDER_POINT_SELECT = {
  warehouseId: true,
  minStockLevel: true,
  maxStockLevel: true,
} as const;

/**
 * True when an unread notification of the same low-stock kind already exists
 * for this product (company-wide). The message carries the location/warehouse
 * detail, so one live notification covers every location that is still low.
 */
async function hasUnread(
  tx: Db,
  companyId: string,
  action: string,
  productId: string
): Promise<boolean> {
  const row = await tx.notification.findFirst({
    where: {
      companyId,
      userId: null,
      category: NotificationCategory.INVENTORY,
      isRead: false,
      action,
      productId,
    },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Creates one company-wide unread notification. `action` doubles as the
 * anti-spam key; `link` sends the reader straight to the filtered screen.
 */
async function notify(
  tx: Db,
  companyId: string,
  input: { action: string; title: string; message: string; productId: string }
): Promise<void> {
  await tx.notification.create({
    data: {
      companyId,
      userId: null,
      title: input.title,
      message: input.message,
      category: NotificationCategory.INVENTORY,
      link: `/dashboard/alerts?tab=low-stock`,
      action: input.action,
      productId: input.productId,
    },
  });
}

export async function applyMovementWithAlerts(
  tx: Db,
  ctx: MovementContext,
  input: MovementInput
): Promise<{ balanceAfter: number } & LowStockOutcome> {
  const result = await applyMovement(tx, ctx, input);
  const notified: LowStockOutcome["notified"] = [];

  // Notifications are company-wide (userId: null) and best-effort: a failure
  // here must never roll back the stock movement that produced it.
  try {
    const productId = input.productId;

    // --- Reorder-point thresholds (per warehouse) -------------------------
    const reorderPoints = (await tx.reorderPoint.findMany({
      where: { companyId: ctx.companyId, productId },
      select: REORDER_POINT_SELECT,
    })) as ThresholdRow[];

    if (reorderPoints.length > 0) {
      const balances = await tx.stockLevel.groupBy({
        by: ["storageLocationId"],
        where: { companyId: ctx.companyId, productId },
        _sum: { onHand: true },
      });
      const locations = await tx.storageLocation.findMany({
        where: { id: { in: balances.map((b) => b.storageLocationId) } },
        select: { id: true, warehouseId: true },
      });
      const locationWarehouse = new Map(locations.map((l) => [l.id, l.warehouseId]));

      const perWarehouse = new Map<string, number>();
      for (const b of balances) {
        const wh = locationWarehouse.get(b.storageLocationId);
        if (!wh) continue;
        perWarehouse.set(wh, (perWarehouse.get(wh) ?? 0) + Number(b._sum.onHand ?? 0));
      }

      const productName = (
        await tx.product.findUnique({
          where: { id: productId },
          select: { name: true },
        })
      )?.name ?? "المنتج";

      for (const rp of reorderPoints) {
        const onHand = perWarehouse.get(rp.warehouseId) ?? 0;
        const min = Number(rp.minStockLevel);
        const max = Number(rp.maxStockLevel);

        // Below reorder min → "أعد الطلب" (once while unread).
        if (onHand <= min) {
          const action = `low-stock:reorder:${productId}:${rp.warehouseId}`;
          if (!(await hasUnread(tx, ctx.companyId, action, productId))) {
            await notify(tx, ctx.companyId, {
              action,
              productId,
              title: "مخزون منخفض — أعد الطلب",
              message: `${productName}: وصل إلى ${onHand} وحدة (الحد الأدنى ${min}). أعد الطلب الآن.`,
            });
            notified.push({ kind: "reorder", title: "مخزون منخفض — أعد الطلب", message: productName });
          }
        }

        // Back above the min → auto-resolve the live reorder alert so the
        // next crossing re-notifies instead of being swallowed by the old row.
        if (onHand > min) {
          await tx.notification.updateMany({
            where: {
              companyId: ctx.companyId,
              userId: null,
              isRead: false,
              action: `low-stock:reorder:${productId}:${rp.warehouseId}`,
            },
            data: { isRead: true, readAt: new Date() },
          });
        }

        // Above reorder max → overstock (once while unread).
        if (max > 0 && onHand >= max) {
          const action = `low-stock:overstock:${productId}:${rp.warehouseId}`;
          if (!(await hasUnread(tx, ctx.companyId, action, productId))) {
            await notify(tx, ctx.companyId, {
              action,
              productId,
              title: "المخزون تجاوز الحد الأقصى",
              message: `${productName}: بلغ ${onHand} وحدة (الحد الأقصى ${max}) في أحد المستودعات.`,
            });
            notified.push({ kind: "overstock", title: "المخزون تجاوز الحد الأقصى", message: productName });
          }
        }
      }
    }

    // --- Company-wide generic low threshold -------------------------------
    // Only meaningful for companies that did not set per-product reorder
    // points for this product; otherwise the reorder rules above are the
    // finer contract and the generic alert would duplicate them.
    if (reorderPoints.length === 0 && input.quantity < 0) {
      const settings = await tx.companySettings.findUnique({
        where: { companyId: ctx.companyId },
        select: { defaultLowStockThreshold: true },
      });
      const threshold = Number(settings?.defaultLowStockThreshold ?? 0);
      if (threshold > 0) {
        const totals = await tx.stockLevel.groupBy({
          by: ["productId"],
          where: { companyId: ctx.companyId, productId },
          _sum: { onHand: true },
        });
        const onHand = Number(totals[0]?._sum.onHand ?? 0);
        if (onHand <= threshold) {
          const action = `low-stock:default:${productId}`;
          if (!(await hasUnread(tx, ctx.companyId, action, productId))) {
            const productName = (
              await tx.product.findUnique({
                where: { id: productId },
                select: { name: true },
              })
            )?.name ?? "المنتج";
            await notify(tx, ctx.companyId, {
              action,
              productId,
              title: "مخزون منخفض",
              message: `${productName}: وصل إلى ${onHand} وحدة (الحد الأدنى العام ${threshold}).`,
            });
            notified.push({ kind: "default-low", title: "مخزون منخفض", message: productName });
          }
        }
      }
    }
  } catch (err) {
    console.error("low-stock notification failed (movement kept):", err);
  }

  return { ...result, notified };
}

export { applyMovement };
