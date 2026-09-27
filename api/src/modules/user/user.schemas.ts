import { z } from "zod";
import { env } from "../../config/env.js";
import { isPermissionKey } from "../../constants/permissions.js";

const email = z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح.").max(320);

export const CreateUserSchema = z.object({
  fullName: z.string().trim().min(2, "الاسم قصير جداً.").max(200),
  email,
  password: z
    .string()
    .min(8, "كلمة المرور يجب ألا تقل عن ٨ أحرف.")
    .max(128, "كلمة المرور طويلة جداً."),
  phoneNumber: z.string().trim().max(50).nullish(),
  jobTitle: z.string().trim().max(120).nullish(),
  roleIds: z.array(z.string()).default([]),
});

export const UpdateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(200).optional(),
    phoneNumber: z.string().trim().max(50).nullish(),
    jobTitle: z.string().trim().max(120).nullish(),
    avatarUrl: z.string().trim().max(2000).nullish(),
    status: z.enum(["INVITED", "ACTIVE", "SUSPENDED"]).optional(),
    roleIds: z.array(z.string()).optional(),
  })
  .strict();

export const ListUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(env.PAGINATION_MAX_PAGE_SIZE).default(10),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  status: z.enum(["INVITED", "ACTIVE", "SUSPENDED"]).optional(),
  roleId: z.string().optional(),
});

export const ResetUserPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, "كلمة المرور يجب ألا تقل عن ٨ أحرف.")
    .max(128, "كلمة المرور طويلة جداً."),
});

export const BulkAssignRolesSchema = z.object({
  userIds: z.array(z.string()).min(1, "يجب اختيار مستخدم واحد على الأقل."),
  roleIds: z.array(z.string()),
});

export const CheckPermissionSchema = z.object({
  permission: z.string().refine(isPermissionKey, "مفتاح صلاحية غير معروف."),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type ListUsersInput = z.infer<typeof ListUsersSchema>;
export type BulkAssignRolesInput = z.infer<typeof BulkAssignRolesSchema>;

