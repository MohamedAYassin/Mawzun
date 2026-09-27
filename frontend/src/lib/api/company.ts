import { http, type Page } from "./http";
import type { CompanySettings } from "./settings";

// The company: the SaaS isolation boundary and the aggregate root.
//
// Identity (name, legal name, tax number, address) lives on Company and is
// edited here. Operational options (invoice prefixes, stock rules, shipping
// costs) live on CompanySettings — see settings.ts. The split matters: identity
// is who the company *is*, settings are how it chooses to *work*, and mixing
// them is what produced the old scope/key/value settings table.

export type CompanyStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

export interface CompanyProfile {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  taxNumber: string | null;
  commercialNo: string | null;
  email: string | null;
  phoneNumber: string | null;
  website: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  postalCode: string | null;
  currencyCode: string;
  timeZone: string;
  locale: string;
  fiscalYearStartMonth: number;
  status: CompanyStatus;
  activatedAt: string | null;
  createdAt: string;
  /** The single owner. Never nullable — a company always has exactly one. */
  owner: { id: string; fullName: string; email: string };
  /** The typed operational options row, returned alongside the identity. */
  settings: CompanySettings;
  _count: { users: number; products: number; orders: number };
}

export interface UpdateCompanyInput {
  name?: string;
  legalName?: string | null;
  taxNumber?: string | null;
  commercialNo?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  website?: string | null;
  addressLine?: string | null;
  city?: string | null;
  region?: string | null;
  countryCode?: string | null;
  postalCode?: string | null;
  currencyCode?: string;
  timeZone?: string;
  locale?: string;
  fiscalYearStartMonth?: number;
}

/**
 * What `PATCH /company` returns.
 *
 * The identity columns only. Declaring the full profile here would let a
 * screen read `settings` or `_count` off an update result, and those are
 * simply absent from the response.
 */
export type CompanyIdentity = Pick<
  CompanyProfile,
  | "id"
  | "name"
  | "slug"
  | "legalName"
  | "taxNumber"
  | "commercialNo"
  | "email"
  | "phoneNumber"
  | "website"
  | "addressLine"
  | "city"
  | "region"
  | "countryCode"
  | "postalCode"
  | "currencyCode"
  | "timeZone"
  | "locale"
  | "fiscalYearStartMonth"
  | "status"
>;

export const companyApi = {
  /** The caller's own company. There is exactly one, so there is no list. */
  profile: () => http.get<CompanyProfile>("/company"),

  update: (input: UpdateCompanyInput) => http.patch<CompanyIdentity>("/company", input),
};

// ---------------------------------------------------------------------------
// Platform back-office
// ---------------------------------------------------------------------------
//
// Only platform staff — users whose companyId is null — may call these. The
// backend rejects anyone else with a 403, and the company-scoped routes are
// refused for platform staff in turn: the two surfaces do not overlap.

export interface CompanyDirectoryEntry {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  createdAt: string;
  owner: { id: string; fullName: string; email: string; lastLoginAt: string | null };
  _count: { users: number; products: number; orders: number };
}

export interface ListCompaniesQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: CompanyStatus;
}

/**
 * What a status change returns: the fields that changed, and nothing else.
 *
 * Narrower than a directory row on purpose. The backend answers with the
 * company's new state plus *why*, because that pair is what the operator needs
 * to confirm — counts and owner would be a second read for no reason.
 */
export interface CompanyStatusChange {
  id: string;
  name: string;
  slug: string;
  status: CompanyStatus;
  suspendedAt: string | null;
  /** Only ever set for SUSPENDED; cleared on the way back to service. */
  suspensionReason: string | null;
}

/** Suspending or closing a company without saying why is refused server-side. */
export const BLOCKING_STATUSES = ["SUSPENDED", "CLOSED"] as const;

export const platformApi = {
  /** Every company on the installation. Platform staff only. */
  listCompanies: (query: ListCompaniesQuery = {}) =>
    http.get<Page<CompanyDirectoryEntry>>("/platform/companies", query),

  /**
   * Activates, suspends or closes a company.
   *
   * Suspending ends the company's live sessions and locks its members out at
   * the authentication layer, which is the heaviest thing the platform can do
   * to a customer — so the reason is part of the contract, not a nicety.
   */
  setCompanyStatus: (id: string, status: CompanyStatus, reason?: string) =>
    http.patch<CompanyStatusChange>(`/platform/companies/${id}/status`, { status, reason }),
};
