import type { Db } from "../../config/database.js";
import type { InventoryTransactionType } from "../../generated/prisma/enums.js";
import { BadRequestError } from "../../shared/errors.js";

// The single place where stock is allowed to change.
//
// Every path that moves stock — a stock operation, a purchase receipt, an order
// fulfilment, a count correction — goes through `applyMovement`. That matters
// because a movement is two writes that must never diverge: the running
// `StockLevel` balance and the immutable `InventoryTransaction` ledger row. If
// any caller updated one without the other, the ledger would stop reconciling
// with the quantities on screen, and there would be no way to find out when or
// why.

export interface MovementInput {
  productId: string;
  storageLocationId: string;
  /** Signed: positive adds to stock, negative removes it. */
  quantity: number;
  type: InventoryTransactionType;
  unitCost?: number;
  reason?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  referenceNumber?: string | null;
  /** Set false only for corrections that must be allowed to go negative. */
  enforceNonNegative?: boolean;
}

export interface MovementContext {
  companyId: string;
  actorId: string | null;
}

export async function applyMovement(
  tx: Db,
  ctx: MovementContext,
  input: MovementInput
): Promise<{ balanceAfter: number }> {
  if (input.quantity === 0) {
    throw new BadRequestError("كمية الحركة يجب ألا تكون صفراً.");
  }

  const level = await tx.stockLevel.upsert({
    where: {
      productId_storageLocationId: {
        productId: input.productId,
        storageLocationId: input.storageLocationId,
      },
    },
    create: {
      companyId: ctx.companyId,
      productId: input.productId,
      storageLocationId: input.storageLocationId,
      onHand: 0,
      reserved: 0,
    },
    update: {},
    select: { id: true, onHand: true },
  });

  const current = Number(level.onHand);
  const next = current + input.quantity;

  // Only movements that PUSH the balance below zero are dangerous: a negative
  // balance created earlier must stay climbable — restocks and returns that
  // improve it (e.g. -7 → -6) are legitimate and must not be blocked.
  if (input.quantity < 0 && next < 0 && input.enforceNonNegative !== false) {
    const settings = await tx.companySettings.findUnique({
      where: { companyId: ctx.companyId },
      select: { allowNegativeStock: true },
    });

    if (!settings?.allowNegativeStock) {
      const product = await tx.product.findUnique({
        where: { id: input.productId },
        select: { name: true, trackStock: true },
      });

      if (product?.trackStock !== false) {
        throw new BadRequestError(
          `الكمية المتاحة من "${product?.name ?? "المنتج"}" غير كافية (${current}).`
        );
      }
    }
  }

  const updated = await tx.stockLevel.update({
    where: { id: level.id },
    data: { onHand: next },
    select: { onHand: true },
  });

  await tx.inventoryTransaction.create({
    data: {
      companyId: ctx.companyId,
      productId: input.productId,
      storageLocationId: input.storageLocationId,
      transactionType: input.type,
      quantity: input.quantity,
      balanceAfter: Number(updated.onHand),
      unitCost: input.unitCost ?? 0,
      reason: input.reason ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      referenceNumber: input.referenceNumber ?? null,
      actorId: ctx.actorId,
    },
  });

  return { balanceAfter: Number(updated.onHand) };
}

/**
 * Resolves where goods land when a caller does not name a bin.
 *
 * Receipts (purchase orders, production output) name a product but not a
 * location, so the default warehouse's first active bin stands in. Returns
 * null when the company has no default warehouse or it has no bins, which
 * callers turn into a "set up a warehouse first" error rather than guessing.
 */
export async function defaultStorageLocation(tx: Db, companyId: string): Promise<string | null> {
  const location = await tx.storageLocation.findFirst({
    where: {
      companyId,
      isActive: true,
      deletedAt: null,
      warehouse: { isDefault: true, deletedAt: null },
    },
    orderBy: [{ code: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return location?.id ?? null;
}

