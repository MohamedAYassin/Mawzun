import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { env } from "../../config/env.js";
import { openToken } from "./secretbox.js";
import { backfillIngestOrder } from "./shopifyIngestLocal.js";
import { upsertShopifyProductLocal } from "./shopifyProductLocal.js";
import { notifyCompany } from "./notify.js";

// ---------------------------------------------------------------------------
// Sync errors
// ---------------------------------------------------------------------------
//
// Failures from pushing or pulling orders against an external store. They are
// kept as rows rather than just logged so the company can work through them:
// resolve when fixed, ignore when it is noise, retry when the cause was
// transient.

export const SyncErrorFilterSchema = z.object({
  status: z.enum(["PENDING", "RESOLVED", "IGNORED"]).optional(),
  storeId: z.string().trim().min(1).optional(),
  errorType: z.string().trim().min(1).max(100).optional(),
});

const SELECT = {
  id: true,
  storeId: true,
  storeName: true,
  errorType: true,
  externalId: true,
  errorMessage: true,
  status: true,
  retryCount: true,
  resolvedAt: true,
  createdAt: true,
  updatedAt: true,
  store: { select: { id: true, name: true, platform: true } },
} as const;

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewSyncErrors),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = SyncErrorFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.storeId ? { storeId: filter.storeId } : {}),
        ...(filter.errorType ? { errorType: filter.errorType } : {}),
        ...searchFilter(["storeName", "errorMessage", "externalId"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.syncError.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "retryCount", "storeName"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.syncError.count({ where });
      return toPage(items, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewSyncErrors),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const error = await tx.syncError.findFirst({
        where: { id: param(req, "id"), companyId: req.ctx.companyId! },
        select: { ...SELECT, rawJson: true },
      });
      if (!error) throw new NotFoundError("خطأ المزامنة غير موجود.");
      return error;
    })
  )
);

/**
 * Retry with teeth.
 *
 * Ported behaviour from upstream's log-replay: for order/product error types
 * where we know the external id, we re-fetch the payload live from the store's
 * Shopify Admin API and run it back through the same ingest semantics the
 * webhooks use (shopifyIngestLocal.backfillIngestOrder — idempotent, unmapped
 * SKUs re-recorded). Success RESOLVES the row; failure bumps retryCount and
 * leaves it PENDING. For error types without a fetchable payload (webhook
 * transport errors, inventory pushes) the row is re-marked for the worker's
 * next pass, exactly as before.
 *
 * Retryable order/product types: UNMAPPED_SKU, orders/create, orders/updated,
 * products/update. FULFILLMENT_NO_ORDER and CANCEL_AFTER_SHIP are also
 * re-fetchable (they only need the order id). Transport-level types
 * (INVENTORY_PUSH*, including INVENTORY_PUSH_RATE_LIMITED) have no single
 * payload — those resolve when the hourly cron pushes clean, so retry here just
 * resets the counter guard.
 */
const RETRYABLE_TYPES = new Set([
  "UNMAPPED_SKU",
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "orders/fulfilled",
  "products/update",
  "FULFILLMENT_NO_ORDER",
  "CANCEL_AFTER_SHIP",
]);

router.post(
  "/:id/retry",
  requirePermission(Permissions.ManageSyncErrors),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const error = await tx.syncError.findFirst({
        where: { id, companyId: req.ctx.companyId! },
        select: {
          id: true, status: true, retryCount: true, storeName: true,
          errorType: true, externalId: true, storeId: true,
          store: { select: { id: true, platform: true, shopifyShopDomain: true, shopifyAccessToken: true, isActive: true, deletedAt: true } },
        },
      });
      if (!error) throw new NotFoundError("خطأ المزامنة غير موجود.");

      if (error.status !== "PENDING") {
        throw new ConflictError("لا يمكن إعادة محاولة خطأ تم حله أو تجاهله.");
      }
      if (error.retryCount >= 10) {
        throw new BadRequestError(
          "تم الوصول للحد الأقصى من المحاولات. راجع إعدادات المتجر قبل إعادة المحاولة."
        );
      }

      let outcome: "reingested" | "requeued" = "requeued";

      const store = error.store;
      const canRefetch =
        store &&
        store.platform === "SHOPIFY" &&
        store.isActive &&
        store.deletedAt === null &&
        error.externalId &&
        RETRYABLE_TYPES.has(error.errorType) &&
        env.SHOPIFY_WEBHOOK_BASE_URL !== undefined; // integration switch on

      if (canRefetch) {
        const isProduct = error.errorType === "products/update";
        // Order-shaped errors carry the Shopify order id in externalId —
        // except products/update, where externalId is the product id.
        const shopifyId = Number(error.externalId);
        if (Number.isFinite(shopifyId) && shopifyId > 0) {
          const token = await openToken(store.shopifyAccessToken, env.APP_SECRET);
          const api = `https://${store.shopifyShopDomain}/admin/api/2026-01`;
          const path = isProduct ? `/products/${shopifyId}.json` : `/orders/${shopifyId}.json`;
          const res = await fetch(`${api}${path}`, {
            headers: { "X-Shopify-Access-Token": token },
          });
          if (res.ok) {
            const body = (await res.json()) as Record<string, unknown>;
            const payload = Object.values(body)[0] as Record<string, unknown>;
            if (isProduct) {
              // Product errors: re-run the upsert directly (local mirror of the
              // worker's SQL — must stay identical).
              await upsertShopifyProductLocal(tx, req.ctx.companyId!, payload as never);
              outcome = "reingested";
            } else {
              const result = await backfillIngestOrder(
                tx, req.ctx.companyId!, store.id, error.storeName,
                payload as never
              );
              // duplicate = the order exists now (fixed elsewhere) → resolve.
              outcome = result.action === "unmapped" ? "requeued" : "reingested";
            }
          } else if (res.status === 404) {
            // The order/product no longer exists on Shopify — nothing to retry.
            throw new ConflictError("لم يعد هذا العنصر موجوداً على Shopify.");
          } else {
            throw new BadRequestError(`فشل الاتصال بـ Shopify (${res.status}). حاول مرة أخرى.`);
          }
        }
      }

      const updated = await tx.syncError.update({
        where: { id },
        data: {
          retryCount: { increment: 1 },
          ...(outcome === "reingested" ? { status: "RESOLVED", resolvedAt: new Date() } : {}),
        },
        select: SELECT,
      });

      await audit(tx, {
        action: outcome === "reingested" ? "syncError.reingested" : "syncError.retried",
        entity: "SyncError",
        entityId: id,
        summary:
          outcome === "reingested"
            ? `تمت إعادة مزامنة ${error.storeName} بنجاح (المحاولة ${updated.retryCount}).`
            : `إعادة محاولة مزامنة ${error.storeName} (المحاولة ${updated.retryCount}).`,
      });

      await notifyCompany(tx, req.ctx.companyId!, {
        action: `sync-retry:${id}`,
        title: outcome === "reingested" ? "تمت إعادة المزامنة بنجاح" : "فشلت إعادة المزامنة",
        message:
          outcome === "reingested"
            ? `تمت إعادة معالجة الخطأ من ${error.storeName} وحله تلقائياً.`
            : `لم تُحل المشكلة بعد من ${error.storeName} — راجع تفاصيل الخطأ.`,
        link: "/dashboard/sync-errors",
      }).catch(() => { /* best-effort */ });

      return { ...updated, outcome };
    })
  )
);

router.post(
  "/:id/resolve",
  requirePermission(Permissions.ManageSyncErrors),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const error = await tx.syncError.findFirst({
        where: { id, companyId: req.ctx.companyId! },
        select: { id: true, status: true, storeName: true },
      });
      if (!error) throw new NotFoundError("خطأ المزامنة غير موجود.");
      if (error.status === "RESOLVED") throw new ConflictError("الخطأ محلول بالفعل.");

      const updated = await tx.syncError.update({
        where: { id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
        select: SELECT,
      });

      await audit(tx, {
        action: "syncError.resolved",
        entity: "SyncError",
        entityId: id,
        summary: `تم حل خطأ مزامنة ${error.storeName}.`,
      });

      return updated;
    })
  )
);

router.post(
  "/:id/ignore",
  requirePermission(Permissions.ManageSyncErrors),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const error = await tx.syncError.findFirst({
        where: { id, companyId: req.ctx.companyId! },
        select: { id: true, status: true, storeName: true },
      });
      if (!error) throw new NotFoundError("خطأ المزامنة غير موجود.");
      if (error.status === "IGNORED") throw new ConflictError("الخطأ متجاهل بالفعل.");

      const updated = await tx.syncError.update({
        where: { id },
        data: { status: "IGNORED", resolvedAt: new Date() },
        select: SELECT,
      });

      await audit(tx, {
        action: "syncError.ignored",
        entity: "SyncError",
        entityId: id,
        summary: `تم تجاهل خطأ مزامنة ${error.storeName}.`,
      });

      return updated;
    })
  )
);

/** Clears the whole backlog, for the morning after a broken integration. */
router.post(
  "/resolve-all",
  requirePermission(Permissions.ManageSyncErrors),
  route(async (req: AuthedRequest) => {
    const body = z
      .object({ storeId: z.string().trim().min(1).optional() })
      .parse(req.body ?? {});

    return scoped(req, async (tx) => {
      const result = await tx.syncError.updateMany({
        where: {
          companyId: req.ctx.companyId!,
          status: "PENDING",
          ...(body.storeId ? { storeId: body.storeId } : {}),
        },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });

      await audit(tx, {
        action: "syncError.resolvedAll",
        entity: "SyncError",
        summary: `تم حل ${result.count} خطأ مزامنة دفعة واحدة.`,
        changes: body,
      });

      return { updated: result.count };
    });
  })
);

export { router as syncErrorRoutes };
