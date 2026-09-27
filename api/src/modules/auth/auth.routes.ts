import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { route, routeWithRes } from "../../shared/route.js";
import { authController } from "./auth.controller.js";
import {
  forgotPassword,
  forgotPasswordCheck,
  resetPassword,
} from "./passwordReset.controller.js";

const router = Router();

// Registration is the only endpoint that mints a company. There is no separate
// "create company" call and there never should be — the company exists so data
// has somewhere to live, not so the user can curate workspaces.
router.post("/signup", routeWithRes(authController.signup, { status: 201, message: "تم إنشاء الحساب بنجاح." }));

router.post("/login", routeWithRes(authController.login, { message: "تم تسجيل الدخول بنجاح." }));

// Refresh is deliberately unauthenticated: the access token has expired, so
// requiring it would make rotation impossible. The refresh token itself is the
// credential.
router.post("/refresh", routeWithRes(authController.refresh, { message: "تم تحديث الجلسة." }));

// Password reset. Public: the requester has no session by definition. The
// check endpoint lets the form warn a tenant before they submit; the submit
// endpoint emails owners a 24h link and deliberately sends tenants nothing.
router.post("/forgot-password/check", forgotPasswordCheck);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

router.post("/logout", authenticate, routeWithRes(authController.logout));

router.get("/me", authenticate, route(authController.me));

router.post(
  "/change-password",
  authenticate,
  route(authController.changePassword, { message: "تم تغيير كلمة المرور بنجاح." })
);

export { router as authRoutes };
