import { Router } from "express";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission, requirePlatformAdmin } from "../../middleware/authorize.js";
import { route } from "../../shared/route.js";
import { companyController, platformCompanyController } from "./company.controller.js";

// Authentication and the company-context check are applied once, for the whole
// API, in createApiRouter — these routers declare only their permissions.

const router = Router();

// A company is a bucket for data, not a workspace the user switches between,
// so there is no "list my companies" endpoint — there is exactly one.
// Reading your own company needs no permission beyond belonging to it.
router.get("/", route(companyController.getProfile));
router.patch(
  "/",
  requirePermission(Permissions.ManageSettings),
  route(companyController.updateProfile, { message: "تم تحديث بيانات الشركة." })
);

export { router as companyRoutes };

// The platform back-office lives under its own prefix because it is the one
// surface that legitimately sees across companies.
export const platformRouter = Router();

platformRouter.use(requirePlatformAdmin());

platformRouter.get("/companies", route(platformCompanyController.list));
platformRouter.patch(
  "/companies/:id/status",
  route(platformCompanyController.setStatus, { message: "تم تحديث حالة الشركة." })
);
