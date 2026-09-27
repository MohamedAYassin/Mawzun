import { param, type AuthedRequest } from "../../shared/request.js";
import { userService } from "./user.service.js";
import {
  BulkAssignRolesSchema,
  CheckPermissionSchema,
  CreateUserSchema,
  ListUsersSchema,
  ResetUserPasswordSchema,
  UpdateUserSchema,
} from "./user.schemas.js";

export const userController = {
  list(req: AuthedRequest) {
    return userService.list(req, ListUsersSchema.parse(req.query));
  },

  detail(req: AuthedRequest) {
    return userService.detail(req, param(req, "id"));
  },

  create(req: AuthedRequest) {
    return userService.create(req, CreateUserSchema.parse(req.body));
  },

  update(req: AuthedRequest) {
    return userService.update(req, param(req, "id"), UpdateUserSchema.parse(req.body));
  },

  remove(req: AuthedRequest) {
    return userService.remove(req, param(req, "id"));
  },

  resetPassword(req: AuthedRequest) {
    return userService.resetPassword(
      req,
      param(req, "id"),
      ResetUserPasswordSchema.parse(req.body).newPassword
    );
  },

  assignRoles(req: AuthedRequest) {
    return userService.assignRoles(req, BulkAssignRolesSchema.parse(req.body));
  },

  /**
   * Lets the UI ask about a single permission without fetching the full list.
   * Owners and platform staff always get `true`.
   */
  checkPermission(req: AuthedRequest) {
    const { permission } = CheckPermissionSchema.parse(req.query);
    return { permission, granted: req.ctx.permissions.has(permission) };
  },
};
