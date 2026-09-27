import { Router } from "express";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { route } from "../../shared/route.js";
import { onboardingService } from "./onboarding.service.js";
import { CompleteOnboardingSchema } from "./onboarding.schemas.js";

const router = Router();

/**
 * Whether this company still needs the wizard. The app calls it on load.
 *
 * Guarded by ViewProducts rather than ManageSettings because the answer is not
 * a secret and every member needs it: the router only shows the wizard to the
 * owner, but a staff member's client still asks so it knows not to render a
 * "finish setup" banner. Requiring an admin permission here would make the
 * status unknown for staff and force the UI to guess.
 */
router.get(
  "/",
  requirePermission(Permissions.ViewProducts),
  route((req) => onboardingService.status(req), { message: "تم جلب حالة التهيئة." })
);

/**
 * Records the wizard's answers and marks onboarding done.
 *
 * ManageSettings, not ViewProducts: this writes the company's currency, tax
 * rates and order numbering — the same fields the settings screen owns, and
 * the same permission that guards them.
 */
router.post(
  "/complete",
  requirePermission(Permissions.ManageSettings),
  route((req) => onboardingService.complete(req, CompleteOnboardingSchema.parse(req.body)), {
    message: "تم إكمال التهيئة بنجاح.",
  })
);

export { router as onboardingRoutes };
