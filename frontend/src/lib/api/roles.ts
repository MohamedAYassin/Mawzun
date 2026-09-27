import { http, type Page } from "./http";

// Roles: named bundles of permissions defined per company.
//
// Three ship with every company — OWNER, ADMIN, STAFF — and are flagged
// `isSystem` so the UI can refuse to delete them. The rest are custom.
//
// Note that the OWNER role is decoration: the actual owner holds every
// permission through `Company.ownerId`, whether or not the row is attached to
// them. It exists so the role list is honest about what the owner can do.

export type RoleKind = "OWNER" | "ADMIN" | "STAFF" | "CUSTOM";

export interface Role {
  id: string;
  name: string;
  description: string | null;
  kind: RoleKind;
  /** Seeded with the company; the UI must not offer to delete these. */
  isSystem: boolean;
  createdAt: string;
  permissions: { permissionKey: string }[];
  _count: { users: number };
}

export interface ListRolesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  permissionKeys: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  permissionKeys?: string[];
}

export const rolesApi = {
  list: (query: ListRolesQuery = {}) => http.get<Page<Role>>("/roles", query),

  /** Every permission the platform defines, for rendering the grant matrix. */
  catalogue: () => http.get<string[]>("/roles/permissions"),

  create: (input: CreateRoleInput) => http.post<Role>("/roles", input),

  update: (id: string, input: UpdateRoleInput) => http.patch<Role>(`/roles/${id}`, input),

  remove: (id: string) => http.delete<null>(`/roles/${id}`),
};
