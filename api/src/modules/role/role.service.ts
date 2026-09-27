import type { AuthedRequest } from "../../shared/request.js";
import { scoped } from "../../shared/request.js";
import { audit } from "../../shared/audit.js";
import { toPage } from "../../shared/pagination.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors.js";
import { getAllPermissions } from "../../constants/permissions.js";
import { roleRepository } from "./role.repository.js";
import type { CreateRoleInput, ListRolesInput, UpdateRoleInput } from "./role.schemas.js";

export const roleService = {
  /** The full catalogue, so the UI can render every permission it can grant. */
  catalogue() {
    return getAllPermissions();
  },

  async list(req: AuthedRequest, input: ListRolesInput) {
    return scoped(req, async (tx) => {
      const [items, total] = await roleRepository.list(tx, req.ctx.companyId!, input);
      return toPage(items, total, input);
    });
  },

  async detail(req: AuthedRequest, id: string) {
    return scoped(req, async (tx) => {
      const role = await roleRepository.detail(tx, req.ctx.companyId!, id);
      if (!role) throw new NotFoundError("الدور غير موجود.");
      return role;
    });
  },

  async create(req: AuthedRequest, input: CreateRoleInput) {
    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const duplicate = await roleRepository.existsByName(tx, companyId, input.name);
      if (duplicate) throw new ConflictError("يوجد دور بنفس الاسم بالفعل.");

      const created = await roleRepository.create(tx, companyId, {
        name: input.name,
        description: input.description ?? null,
        permissionKeys: input.permissionKeys,
      });

      await audit(tx, {
        action: "role.created",
        entity: "Role",
        entityId: created.id,
        summary: `تم إنشاء الدور ${created.name}.`,
      });

      return created;
    });
  },

  async update(req: AuthedRequest, id: string, input: UpdateRoleInput) {
    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const role = await roleRepository.detail(tx, companyId, id);
      if (!role) throw new NotFoundError("الدور غير موجود.");

      if (input.name) {
        const duplicate = await roleRepository.existsByName(tx, companyId, input.name, id);
        if (duplicate) throw new ConflictError("يوجد دور بنفس الاسم بالفعل.");
      }

      const updated = await roleRepository.update(tx, id, {
        name: input.name,
        description: input.description,
        permissionKeys: input.permissionKeys,
      });

      await audit(tx, {
        action: "role.updated",
        entity: "Role",
        entityId: id,
        summary: `تم تحديث الدور ${updated.name}.`,
        changes: input,
      });

      return updated;
    });
  },

  /**
   * Deletes a role.
   *
   * The three roles seeded with every company are protected: the owner role is
   * what makes the one-super-admin invariant visible in the UI, and removing
   * the admin or staff roles would leave existing members with nothing.
   */
  async remove(req: AuthedRequest, id: string) {
    return scoped(req, async (tx) => {
      const role = await roleRepository.detail(tx, req.ctx.companyId!, id);
      if (!role) throw new NotFoundError("الدور غير موجود.");

      if (role.isSystem) {
        throw new BadRequestError("لا يمكن حذف الأدوار الأساسية للشركة.");
      }

      await roleRepository.remove(tx, id);

      await audit(tx, {
        action: "role.deleted",
        entity: "Role",
        entityId: id,
        summary: `تم حذف الدور ${role.name}.`,
      });

      return null;
    });
  },
};
