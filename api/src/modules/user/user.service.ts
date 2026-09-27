import type { Db } from "../../config/database.js";
import { env } from "../../config/env.js";
import { scoped, type AuthedRequest } from "../../shared/request.js";
import { audit } from "../../shared/audit.js";
import { toPage } from "../../shared/pagination.js";
import {
  BadRequestError,
  CompanyOwnerProtectedError,
  ConflictError,
  NotFoundError,
} from "../../shared/errors.js";
import { hashPassword } from "../../utils/password.js";
import { newSecurityStamp } from "../../utils/tokens.js";
import { userRepository } from "./user.repository.js";
import type {
  BulkAssignRolesInput,
  CreateUserInput,
  ListUsersInput,
  UpdateUserInput,
} from "./user.schemas.js";

export const userService = {
  async list(req: AuthedRequest, input: ListUsersInput) {
    return scoped(req, async (tx) => {
      const [items, total] = await userRepository.list(tx, req.ctx.companyId!, input);
      return toPage(items, total, input);
    });
  },

  async detail(req: AuthedRequest, id: string) {
    return scoped(req, async (tx) => {
      const user = await userRepository.detail(tx, req.ctx.companyId!, id);
      if (!user) throw new NotFoundError("المستخدم غير موجود.");
      return user;
    });
  },

  async create(req: AuthedRequest, input: CreateUserInput) {
    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const existing = await userRepository.findByEmail(tx, input.email);
      if (existing) throw new ConflictError("هذا البريد الإلكتروني مستخدم بالفعل.");

      // Hard cap on added members; the owner never counts against it.
      const company = await tx.company.findUnique({
        where: { id: companyId },
        select: { ownerId: true },
      });
      const members = await tx.user.count({
        where: {
          companyId,
          deletedAt: null,
          ...(company?.ownerId ? { id: { not: company.ownerId } } : {}),
        },
      });
      if (members >= env.MAX_USERS_PER_COMPANY) {
        throw new ConflictError(
          `الحد الأقصى ${env.MAX_USERS_PER_COMPANY} مستخدمين لكل شركة. احذف مستخدماً غير نشط أولاً.`
        );
      }

      await assertRolesBelongToCompany(tx, companyId, input.roleIds);

      const created = await userRepository.create(tx, companyId, {
        email: input.email,
        passwordHash: await hashPassword(input.password),
        fullName: input.fullName,
        phoneNumber: input.phoneNumber ?? null,
        jobTitle: input.jobTitle ?? null,
        securityStamp: newSecurityStamp(),
        roleIds: input.roleIds,
      });

      await audit(tx, {
        action: "user.created",
        entity: "User",
        entityId: created.id,
        summary: `تم إضافة المستخدم ${created.fullName}.`,
      });

      return created;
    });
  },

  /**
   * Updates a member.
   *
   * The owner may not be suspended or deleted — a company must always have its
   * one super admin. Demoting them is allowed (they keep every permission
   * implicitly through `Company.ownerId` anyway), but their account cannot be
   * taken out of service.
   */
  async update(req: AuthedRequest, id: string, input: UpdateUserInput) {
    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const user = await userRepository.detail(tx, companyId, id);
      if (!user) throw new NotFoundError("المستخدم غير موجود.");

      const { ownerId } = await userRepository.ownerOf(tx, companyId);
      const isOwner = ownerId === id;

      if (isOwner && input.status && input.status !== "ACTIVE") {
        throw new CompanyOwnerProtectedError("لا يمكن تعطيل حساب مالك الشركة.");
      }

      if (input.roleIds) await assertRolesBelongToCompany(tx, companyId, input.roleIds);

      const updated = await userRepository.update(tx, companyId, id, {
        fullName: input.fullName,
        phoneNumber: input.phoneNumber,
        jobTitle: input.jobTitle,
        avatarUrl: input.avatarUrl,
        status: input.status,
        roleIds: input.roleIds,
      });

      await audit(tx, {
        action: "user.updated",
        entity: "User",
        entityId: id,
        summary: `تم تحديث بيانات المستخدم ${updated.fullName}.`,
        changes: input,
      });

      return updated;
    });
  },

  /**
   * Removes a member, unless they are the owner.
   *
   * The database would reject the delete anyway — `Company.ownerId` has
   * `onDelete: Restrict` — but the check here turns that into a readable error
   * instead of a foreign-key violation.
   */
  async remove(req: AuthedRequest, id: string) {
    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;

      const user = await userRepository.detail(tx, companyId, id);
      if (!user) throw new NotFoundError("المستخدم غير موجود.");

      const { ownerId } = await userRepository.ownerOf(tx, companyId);
      if (ownerId === id) {
        throw new CompanyOwnerProtectedError("لا يمكن حذف مالك الشركة.");
      }

      if (id === req.ctx.userId) {
        throw new BadRequestError("لا يمكنك حذف حسابك بنفسك.");
      }

      // Soft delete: inventory transactions and orders reference this user and
      // must keep their history intact.
      await userRepository.softDelete(tx, id);

      await audit(tx, {
        action: "user.deleted",
        entity: "User",
        entityId: id,
        summary: `تم حذف المستخدم ${user.fullName}.`,
      });

      return null;
    });
  },

  async resetPassword(req: AuthedRequest, id: string, newPassword: string) {
    return scoped(req, async (tx) => {
      const user = await userRepository.detail(tx, req.ctx.companyId!, id);
      if (!user) throw new NotFoundError("المستخدم غير موجود.");

      const updated = await userRepository.setPassword(
        tx,
        id,
        await hashPassword(newPassword),
        newSecurityStamp()
      );

      await audit(tx, {
        action: "user.passwordReset",
        entity: "User",
        entityId: id,
        summary: `تم إعادة تعيين كلمة مرور ${user.fullName}.`,
      });

      return updated;
    });
  },

  async assignRoles(req: AuthedRequest, input: BulkAssignRolesInput) {
    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      await assertRolesBelongToCompany(tx, companyId, input.roleIds);

      const { ownerId } = await userRepository.ownerOf(tx, companyId);
      const members = await tx.user.count({
        where: { id: { in: input.userIds }, companyId, deletedAt: null },
      });
      if (members !== input.userIds.length) {
        throw new BadRequestError("بعض المستخدمين غير موجودين في هذه الشركة.");
      }

      // The owner holds every permission regardless of roles, so leaving them
      // out of the assignment changes nothing functionally — but the UI should
      // still show them as the owner rather than as someone with no role.
      const targetIds = input.userIds.filter((id) => id !== ownerId);
      await userRepository.assignRoles(tx, targetIds, input.roleIds);

      await audit(tx, {
        action: "user.rolesAssigned",
        entity: "User",
        summary: `تم تحديث أدوار ${targetIds.length} مستخدم.`,
        changes: { userIds: targetIds, roleIds: input.roleIds },
      });

      return { updated: targetIds.length };
    });
  },
};

/**
 * A role id from another company must never be attachable. Row-level security
 * would stop the write, but checking first turns a policy violation into a
 * clear 400 and keeps the scoping visible in code.
 */
async function assertRolesBelongToCompany(
  tx: Db,
  companyId: string,
  roleIds: string[]
): Promise<void> {
  if (roleIds.length === 0) return;
  const found = await userRepository.countRolesInCompany(tx, companyId, roleIds);
  if (found !== roleIds.length) {
    throw new BadRequestError("أحد الأدوار المحددة غير موجود في هذه الشركة.");
  }
}
