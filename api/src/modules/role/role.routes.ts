import { Router } from "express";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { route } from "../../shared/route.js";
import { roleController } from "./role.controller.js";

const router = Router();

// Reading roles is allowed to anyone who can manage users, so the user editor
// can render the role picker. Changing them needs the roles permission.
router.get("/", requirePermission(Permissions.ManageRoles, Permissions.ManageUsers), route(roleController.list));
router.get("/permissions", requirePermission(Permissions.ManageRoles, Permissions.ManageUsers), route(roleController.catalogue));
router.get("/:id", requirePermission(Permissions.ManageRoles, Permissions.ManageUsers), route(roleController.detail));

router.post("/", requirePermission(Permissions.ManageRoles), route(roleController.create, { status: 201, message: "تم إنشاء الدور بنجاح." }));
router.patch("/:id", requirePermission(Permissions.ManageRoles), route(roleController.update, { message: "تم تحديث الدور بنجاح." }));
router.delete("/:id", requirePermission(Permissions.ManageRoles), route(roleController.remove, { message: "تم حذف الدور بنجاح." }));

export { router as roleRoutes };
