import { Router } from "express";
import { authenticate } from "../middleware/authenticate.js";
import { requireCompanyContext } from "../middleware/authorize.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { companyRoutes, platformRouter } from "../modules/company/company.routes.js";
import { userRoutes } from "../modules/user/user.routes.js";
import { roleRoutes } from "../modules/role/role.routes.js";
import { settingsRoutes } from "../modules/settings/settings.routes.js";
import { onboardingRoutes } from "../modules/onboarding/onboarding.routes.js";
import { catalogRoutes } from "../modules/catalog/catalog.routes.js";
import { inventoryRoutes } from "../modules/inventory/inventory.routes.js";
import { salesRoutes } from "../modules/sales/sales.routes.js";
import { purchasingRoutes } from "../modules/purchasing/purchasing.routes.js";
import { productionRoutes } from "../modules/production/production.routes.js";
import { shippingRoutes } from "../modules/shipping/shipping.routes.js";
import { systemRoutes } from "../modules/system/system.routes.js";
import { reportRoutes } from "../modules/reports/reports.routes.js";

/**
 * Assembles the versioned API.
 *
 * Every domain owns its own router and is mounted here exactly once. Adding a
 * domain means adding one line, not threading a controller through three
 * directories.
 *
 * Order is the security boundary, so it is stated here rather than repeated
 * (and drifted) in twenty-nine files:
 *
 *   1. `/auth` — mounted first and *not* authenticated. Signup and login are
 *      how a session starts, so demanding a bearer token here would make the
 *      API impossible to enter. The three routes inside it that do need a
 *      session (me, logout, change-password) declare `authenticate`
 *      themselves.
 *   2. `authenticate` — everything mounted after this has a resolved context.
 *      It runs once per request instead of once per router.
 *   3. `/platform` — platform staff hold a session but belong to no company,
 *      so they are served before the company-context guard.
 *   4. `requireCompanyContext` — everything mounted after this is
 *      company-scoped. A caller with no company is rejected here, before any
 *      service can run `where: { companyId: null }` and quietly match the
 *      wrong rows.
 *
 * Domain routers therefore declare only their *permissions*, never their
 * authentication.
 */
export function createApiRouter(): Router {
  const router = Router();

  // No session yet.
  router.use("/auth", authRoutes);

  // A session, but not necessarily a company.
  router.use(authenticate);
  router.use("/platform", platformRouter);

  // From here on, the caller must belong to a company.
  router.use(requireCompanyContext());

  router.use("/company", companyRoutes);
  router.use("/users", userRoutes);
  router.use("/roles", roleRoutes);
  router.use("/settings", settingsRoutes);
  router.use("/onboarding", onboardingRoutes);

  router.use("/catalog", catalogRoutes);
  router.use("/inventory", inventoryRoutes);
  router.use("/sales", salesRoutes);
  router.use("/purchasing", purchasingRoutes);
  router.use("/production", productionRoutes);
  router.use("/shipping", shippingRoutes);
  router.use("/system", systemRoutes);
  router.use("/reports", reportRoutes);

  return router;
}
