import { param, type AuthedRequest } from "../../shared/request.js";
import { roleService } from "./role.service.js";
import { CreateRoleSchema, ListRolesSchema, UpdateRoleSchema } from "./role.schemas.js";

export const roleController = {
  catalogue() {
    return roleService.catalogue();
  },

  list(req: AuthedRequest) {
    return roleService.list(req, ListRolesSchema.parse(req.query));
  },

  detail(req: AuthedRequest) {
    return roleService.detail(req, param(req, "id"));
  },

  create(req: AuthedRequest) {
    return roleService.create(req, CreateRoleSchema.parse(req.body));
  },

  update(req: AuthedRequest) {
    return roleService.update(req, param(req, "id"), UpdateRoleSchema.parse(req.body));
  },

  remove(req: AuthedRequest) {
    return roleService.remove(req, param(req, "id"));
  },
};
