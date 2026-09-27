import { Router } from "express";
import { apiKeyRoutes } from "./apiKeys.js";
import { notificationRoutes } from "./notifications.js";
import { sessionRoutes } from "./sessions.js";
import { storeRoutes } from "./stores.js";
import { syncErrorRoutes } from "./syncErrors.js";
import { uploadRoutes } from "./uploads.js";

const router = Router();

router.use("/api-keys", apiKeyRoutes);
router.use("/notifications", notificationRoutes);
router.use("/sessions", sessionRoutes);
router.use("/stores", storeRoutes);
router.use("/sync-errors", syncErrorRoutes);
router.use("/", uploadRoutes);

// Historical order backfill for a Shopify store (owner-triggered, bounded).
import { Router as _R } from "express";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { param, scoped } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { backfillStoreOrders, BackfillSchema } from "./shopifyBackfill.js";
import { exportProductsToStore, ExportProductsSchema } from "./shopifyProductExport.js";

const storesRouter = _R();
storesRouter.post(
  "/:id/backfill",
  requirePermission(Permissions.ManageStores),
  route(async (req) =>
    scoped(req, async (tx) => {
      const input = BackfillSchema.parse({ storeId: param(req, "id"), since: req.body?.since });
      if (!req.ctx.companyId) {
        // Company context middleware guarantees this for company-scoped routes;
        // the check just satisfies the type and guards platform-level callers.
        throw new Error("Company context is required for backfill.");
      }
      const summary = await backfillStoreOrders(tx, req.ctx.companyId, input);
      return summary;
    })
  )
);

// Product export to a Shopify store (Mawzun → Shopify).
//
// Gated on UpdateProduct rather than ManageStores: this changes the catalogue,
// not the store connection, so it belongs to whoever may edit products. The
// Shopify feature switch is enforced inside exportProductsToStore.
storesRouter.post(
  "/:id/export-products",
  requirePermission(Permissions.UpdateProduct),
  route(async (req) =>
    scoped(req, async (tx) => {
      const { productIds } = ExportProductsSchema.parse(req.body);
      if (!req.ctx.companyId) {
        throw new Error("Company context is required for product export.");
      }
      return exportProductsToStore(tx, req.ctx.companyId, param(req, "id"), productIds);
    })
  )
);
router.use("/stores", storesRouter);

export { router as systemRoutes };