import { z } from "zod";
import { env } from "../../config/env.js";
import { isPermissionKey } from "../../constants/permissions.js";

const permissionKey = z
  .string()
  .refine(isPermissionKey, "مفتاح صلاحية غير معروف.");

export const CreateRoleSchema = z.object({
  name: z.string().trim().min(2, "اسم الدور قصير جداً.").max(100),
  description: z.string().trim().max(500).nullish(),
  permissionKeys: z.array(permissionKey).default([]),
});

export const UpdateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(500).nullish(),
    permissionKeys: z.array(permissionKey).optional(),
  })
  .strict();

export const ListRolesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(env.PAGINATION_MAX_PAGE_SIZE).default(10),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

export type CreateRoleInput = z.infer<typeof CreateRoleSchema>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
export type ListRolesInput = z.infer<typeof ListRolesSchema>;
