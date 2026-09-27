import { Router } from "express";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { route } from "../../shared/route.js";
import { settingsService } from "./settings.service.js";
import { UpdateSettingsSchema } from "./settings.schemas.js";

const router = Router();

router.get(
  "/",
  requirePermission(Permissions.ManageSettings, Permissions.ViewProducts),
  route((req) => settingsService.get(req), { message: "تم جلب الإعدادات." })
);

router.patch(
  "/",
  requirePermission(Permissions.ManageSettings),
  route((req) => settingsService.update(req, UpdateSettingsSchema.parse(req.body)), {
    message: "تم تحديث الإعدادات بنجاح.",
  })
);

export { router as settingsRoutes };
