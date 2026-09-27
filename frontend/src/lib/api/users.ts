import { http, type Page } from "./http";

// Members of the caller's own company.
//
// A user row here is always a member of the caller's company; the backend
// scopes every query from the authenticated context and never trusts a
// companyId supplied by the client.

export type UserStatus = "INVITED" | "ACTIVE" | "SUSPENDED";
export type RoleKind = "OWNER" | "ADMIN" | "STAFF" | "CUSTOM";

export interface UserRoleRef {
  id: string;
  name: string;
  kind: RoleKind;
  isSystem: boolean;
}

export interface CompanyUser {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  status: UserStatus;
  isPlatformAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  roles: UserRoleRef[];
}

export interface ListUsersQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: UserStatus;
  roleId?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface CreateUserInput {
  fullName: string;
  email: string;
  /** Minimum 8 characters, enforced by the backend. */
  password: string;
  phoneNumber?: string | null;
  jobTitle?: string | null;
  roleIds?: string[];
}

export interface UpdateUserInput {
  fullName?: string;
  phoneNumber?: string | null;
  jobTitle?: string | null;
  avatarUrl?: string | null;
  status?: UserStatus;
  roleIds?: string[];
}

export const usersApi = {
  list: (query: ListUsersQuery = {}) => http.get<Page<CompanyUser>>("/users", query),

  /**
   * Adds a member to the caller's company.
   *
   * This is *not* registration. Registration mints a new company and its
   * owner; this creates a user inside the company that already exists. Calling
   * signup here would silently create a second, unrelated company.
   */
  create: (input: CreateUserInput) => http.post<CompanyUser>("/users", input),

  update: (id: string, input: UpdateUserInput) => http.patch<CompanyUser>(`/users/${id}`, input),

  /**
   * Soft-deletes a member.
   *
   * The backend refuses with code COMPANY_OWNER_PROTECTED when the target is
   * the company's owner — a company must always have its super admin.
   */
  remove: (id: string) => http.delete<null>(`/users/${id}`),

  resetPassword: (id: string, newPassword: string) =>
    http.post<CompanyUser>(`/users/${id}/reset-password`, { newPassword }),

};
