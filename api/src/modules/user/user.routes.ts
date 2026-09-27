import { Router } from "express";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { route } from "../../shared/route.js";
import { userController } from "./user.controller.js";

const router = Router();

router.use(requirePermission(Permissions.ManageUsers));

router.get("/", route(userController.list));
router.get("/check-permission", route(userController.checkPermission));
router.get("/:id", route(userController.detail));

router.post("/", route(userController.create, { status: 201, message: "تم إضافة المستخدم بنجاح." }));
router.patch("/:id", route(userController.update, { message: "تم تحديث المستخدم بنجاح." }));

// Soft delete. The owner is rejected by the service and by the database.
router.delete("/:id", route(userController.remove, { message: "تم حذف المستخدم بنجاح." }));

router.post(
  "/:id/reset-password",
  route(userController.resetPassword, { message: "تم إعادة تعيين كلمة المرور." })
);

router.post(
  "/roles/assign",
  route(userController.assignRoles, { message: "تم تحديث الأدوار بنجاح." })
);

export { router as userRoutes };
