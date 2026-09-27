// All read SQL for the admin worker. Raw postgres.js over Hyperdrive.
// Raw-SQL rules that bite here: camelCase quoted columns everywhere,
// company ids are TEXT (no uuid casts), sql.unsafe only for constant fragments.

import type { Sql } from "./db.js";

export interface StatsRow {
  companiesTotal: number;
  companiesActive: number;
  companiesSuspended: number;
  companiesClosed: number;
  signups30d: number;
  usersTotal: number;
  usersSuspended: number;
  activeSessions: number;
  productsTotal: number;
  ordersTotal: number;
  orders7d: number;
  storesTotal: number;
  syncErrorsPending: number;
}

export async function loadStats(sql: Sql): Promise<StatsRow> {
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*) FROM companies WHERE "deletedAt" IS NULL) AS "companiesTotal",
      (SELECT COUNT(*) FROM companies WHERE "deletedAt" IS NULL AND status = 'ACTIVE') AS "companiesActive",
      (SELECT COUNT(*) FROM companies WHERE "deletedAt" IS NULL AND status = 'SUSPENDED') AS "companiesSuspended",
      (SELECT COUNT(*) FROM companies WHERE "deletedAt" IS NULL AND status = 'CLOSED') AS "companiesClosed",
      (SELECT COUNT(*) FROM companies WHERE "deletedAt" IS NULL AND "createdAt" > now() - interval '30 days') AS "signups30d",
      (SELECT COUNT(*) FROM users WHERE "deletedAt" IS NULL) AS "usersTotal",
      (SELECT COUNT(*) FROM users WHERE "deletedAt" IS NULL AND status = 'SUSPENDED') AS "usersSuspended",
      (SELECT COUNT(*) FROM sessions WHERE "revokedAt" IS NULL AND "expiresAt" > now()) AS "activeSessions",
      (SELECT COUNT(*) FROM products WHERE "deletedAt" IS NULL) AS "productsTotal",
      (SELECT COUNT(*) FROM orders WHERE "deletedAt" IS NULL) AS "ordersTotal",
      (SELECT COUNT(*) FROM orders WHERE "deletedAt" IS NULL AND "createdAt" > now() - interval '7 days') AS "orders7d",
      (SELECT COUNT(*) FROM stores WHERE "deletedAt" IS NULL) AS "storesTotal",
      (SELECT COUNT(*) FROM sync_errors WHERE status = 'PENDING') AS "syncErrorsPending"`;
  return row as unknown as StatsRow;
}

export interface CompanyListRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  ownerName: string | null;
  ownerEmail: string | null;
  userCount: number;
  productCount: number;
  orders7d: number;
  createdAt: Date;
}

export async function loadCompanies(sql: Sql, search: string, status: string): Promise<CompanyListRow[]> {
  const like = `%${search.toLowerCase()}%`;
  const statusFilter = ["ACTIVE", "SUSPENDED", "CLOSED"].includes(status) ? status : null;
  return (await sql`
    SELECT c.id, c.name, c.slug, c.status,
      ou."fullName" AS "ownerName", ou.email AS "ownerEmail",
      (SELECT COUNT(*) FROM users u WHERE u."companyId" = c.id AND u."deletedAt" IS NULL) AS "userCount",
      (SELECT COUNT(*) FROM products p WHERE p."companyId" = c.id AND p."deletedAt" IS NULL) AS "productCount",
      (SELECT COUNT(*) FROM orders o WHERE o."companyId" = c.id AND o."deletedAt" IS NULL AND o."createdAt" > now() - interval '7 days') AS "orders7d",
      c."createdAt"
    FROM companies c
    LEFT JOIN users ou ON ou.id = c."ownerId"
    WHERE c."deletedAt" IS NULL
      AND (${search} = '' OR lower(c.name) LIKE ${like} OR lower(c.slug) LIKE ${like} OR lower(COALESCE(ou.email, '')) LIKE ${like})
      AND (${statusFilter}::text IS NULL OR c.status::text = ${statusFilter})
    ORDER BY c."createdAt" DESC
    LIMIT 200`) as unknown as CompanyListRow[];
}

export async function loadCompany(sql: Sql, id: string): Promise<CompanyListRow | null> {
  const rows = (await sql`
    SELECT c.id, c.name, c.slug, c.status,
      ou."fullName" AS "ownerName", ou.email AS "ownerEmail",
      (SELECT COUNT(*) FROM users u WHERE u."companyId" = c.id AND u."deletedAt" IS NULL) AS "userCount",
      (SELECT COUNT(*) FROM products p WHERE p."companyId" = c.id AND p."deletedAt" IS NULL) AS "productCount",
      (SELECT COUNT(*) FROM orders o WHERE o."companyId" = c.id AND o."deletedAt" IS NULL AND o."createdAt" > now() - interval '7 days') AS "orders7d",
      c."createdAt"
    FROM companies c LEFT JOIN users ou ON ou.id = c."ownerId"
    WHERE c.id = ${id} AND c."deletedAt" IS NULL`) as unknown as CompanyListRow[];
  return rows[0] ?? null;
}

export interface CompanyDetail {
  legalName: string | null;
  email: string | null;
  phoneNumber: string | null;
  countryCode: string | null;
  currencyCode: string;
  suspensionReason: string | null;
  suspendedAt: Date | null;
}

export async function loadCompanyDetail(sql: Sql, id: string): Promise<CompanyDetail | null> {
  const rows = (await sql`
    SELECT "legalName", email, "phoneNumber", "countryCode", "currencyCode",
      "suspensionReason", "suspendedAt"
    FROM companies WHERE id = ${id} AND "deletedAt" IS NULL`) as unknown as CompanyDetail[];
  return rows[0] ?? null;
}

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  status: string;
  isPlatformAdmin: boolean;
  isOwner: boolean;
  companyId: string | null;
  companyName: string | null;
  roles: string;
  lastLoginAt: Date | null;
  sessionCount: number;
  createdAt: Date;
}

export async function loadUsers(sql: Sql, search: string, status: string, companyId?: string): Promise<UserRow[]> {
  const like = `%${search.toLowerCase()}%`;
  const statusFilter = ["INVITED", "ACTIVE", "SUSPENDED"].includes(status) ? status : null;
  return (await sql`
    SELECT u.id, u.email, u."fullName", u.status::text AS status, u."isPlatformAdmin",
      (c.id IS NOT NULL AND c."ownerId" = u.id) AS "isOwner",
      u."companyId", c.name AS "companyName",
      COALESCE((SELECT string_agg(r.name, ', ' ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur."roleId" WHERE ur."userId" = u.id), '') AS roles,
      u."lastLoginAt",
      (SELECT COUNT(*) FROM sessions s WHERE s."userId" = u.id AND s."revokedAt" IS NULL AND s."expiresAt" > now()) AS "sessionCount",
      u."createdAt"
    FROM users u
    LEFT JOIN companies c ON c.id = u."companyId"
    WHERE u."deletedAt" IS NULL
      AND (${search} = '' OR lower(u.email) LIKE ${like} OR lower(u."fullName") LIKE ${like} OR lower(c.name) LIKE ${like})
      AND (${statusFilter}::text IS NULL OR u.status::text = ${statusFilter})
      AND (${companyId ?? null}::text IS NULL OR u."companyId" = ${companyId ?? null})
    ORDER BY c."createdAt" DESC NULLS LAST, u."createdAt"
    LIMIT 300`) as unknown as UserRow[];
}

export interface AuditRow {
  id: string;
  createdAt: Date;
  actorEmail: string | null;
  companyName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string | null;
  ipAddress: string | null;
}

export async function loadAudit(sql: Sql, search: string, limit = 150): Promise<AuditRow[]> {
  const like = `%${search.toLowerCase()}%`;
  return (await sql`
    SELECT a.id, a."createdAt", au.email AS "actorEmail", c.name AS "companyName",
      a.action, a.entity, a."entityId", a.summary, a."ipAddress"
    FROM audit_logs a
    LEFT JOIN users au ON au.id = a."actorId"
    LEFT JOIN companies c ON c.id = a."companyId"
    WHERE (${search} = '' OR lower(a.action) LIKE ${like} OR lower(a.entity) LIKE ${like}
      OR lower(COALESCE(a.summary, '')) LIKE ${like} OR lower(COALESCE(au.email, '')) LIKE ${like})
    ORDER BY a."createdAt" DESC
    LIMIT ${limit}`) as unknown as AuditRow[];
}

export interface SyncErrorRow {
  id: string;
  createdAt: Date;
  companyId: string;
  companyName: string;
  storeName: string;
  errorType: string;
  externalId: string;
  errorMessage: string;
  status: string;
  retryCount: number;
}

export async function loadSyncErrors(sql: Sql, status: string): Promise<SyncErrorRow[]> {
  const statusFilter = ["PENDING", "RESOLVED", "IGNORED"].includes(status) ? status : "PENDING";
  return (await sql`
    SELECT se.id, se."createdAt", se."companyId", c.name AS "companyName",
      se."storeName", se."errorType", se."externalId", se."errorMessage",
      se.status::text AS status, se."retryCount"
    FROM sync_errors se
    JOIN companies c ON c.id = se."companyId"
    WHERE se.status::text = ${statusFilter}
    ORDER BY se."createdAt" DESC
    LIMIT 200`) as unknown as SyncErrorRow[];
}

export interface StoreRow {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  platform: string;
  storeUrl: string;
  isActive: boolean;
  lastSyncedAt: Date | null;
  errorCount: number;
}

export async function loadStores(sql: Sql): Promise<StoreRow[]> {
  return (await sql`
    SELECT s.id, s."companyId", c.name AS "companyName", s.name, s.platform::text AS platform,
      s."storeUrl", s."isActive", s."lastSyncedAt",
      (SELECT COUNT(*) FROM sync_errors se WHERE se."storeId" = s.id AND se.status = 'PENDING') AS "errorCount"
    FROM stores s
    JOIN companies c ON c.id = s."companyId"
    WHERE s."deletedAt" IS NULL
    ORDER BY s."lastSyncedAt" ASC NULLS FIRST
    LIMIT 200`) as unknown as StoreRow[];
}

export interface ApiKeyRow {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export async function loadApiKeys(sql: Sql): Promise<ApiKeyRow[]> {
  return (await sql`
    SELECT k.id, k."companyId", c.name AS "companyName", k.name, k."keyPrefix",
      k."isActive", k."lastUsedAt", k."expiresAt", k."revokedAt", k."createdAt"
    FROM api_keys k
    JOIN companies c ON c.id = k."companyId"
    WHERE k."deletedAt" IS NULL
    ORDER BY k."createdAt" DESC
    LIMIT 200`) as unknown as ApiKeyRow[];
}

export interface NotificationRow {
  id: string;
  createdAt: Date;
  companyName: string;
  userEmail: string | null;
  title: string;
  message: string;
  category: string;
  link: string | null;
  isRead: boolean;
}

export async function loadNotifications(sql: Sql): Promise<NotificationRow[]> {
  return (await sql`
    SELECT n.id, n."createdAt", c.name AS "companyName", u.email AS "userEmail",
      n.title, n.message, n.category::text AS category, n.link, n."isRead"
    FROM notifications n
    JOIN companies c ON c.id = n."companyId"
    LEFT JOIN users u ON u.id = n."userId"
    ORDER BY n."createdAt" DESC
    LIMIT 100`) as unknown as NotificationRow[];
}

export interface SearchResult {
  kind: "company" | "user" | "order";
  id: string;
  label: string;
  sub: string;
  href: string;
}

export async function globalSearch(sql: Sql, q: string): Promise<SearchResult[]> {
  if (!q || q.length < 2) return [];
  const like = `%${q.toLowerCase()}%`;
  const [companies, users, orders] = await Promise.all([
    sql`SELECT id, name, slug FROM companies WHERE "deletedAt" IS NULL AND (lower(name) LIKE ${like} OR lower(slug) LIKE ${like}) LIMIT 5`,
    sql`SELECT u.id, u.email, u."fullName", c.name AS "companyName" FROM users u LEFT JOIN companies c ON c.id = u."companyId"
        WHERE u."deletedAt" IS NULL AND (lower(u.email) LIKE ${like} OR lower(u."fullName") LIKE ${like}) LIMIT 5`,
    sql`SELECT o.id, o."orderNumber", o."companyId", c.name AS "companyName" FROM orders o JOIN companies c ON c.id = o."companyId"
        WHERE o."deletedAt" IS NULL AND (lower(o."orderNumber") LIKE ${like}) LIMIT 5`,
  ]);
  return [
    ...(companies as unknown as { id: string; name: string; slug: string }[]).map((r) => ({
      kind: "company" as const, id: r.id, label: r.name, sub: r.slug, href: `/companies/${r.id}`,
    })),
    ...(users as unknown as { id: string; email: string; fullName: string; companyName: string | null }[]).map((r) => ({
      kind: "user" as const, id: r.id, label: r.fullName, sub: `${r.email}${r.companyName ? " · " + r.companyName : ""}`, href: `/users?q=${encodeURIComponent(r.email)}`,
    })),
    ...(orders as unknown as { id: string; orderNumber: string; companyName: string }[]).map((r) => ({
      kind: "order" as const, id: r.id, label: `Order ${r.orderNumber}`, sub: r.companyName, href: `/companies`,
    })),
  ];
}

export interface ImpersonationRow {
  sessionId: string;
  userId: string;
  userEmail: string;
  userName: string;
  startedAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  impersonatedBy: string | null;
}

export async function loadActiveImpersonations(sql: Sql): Promise<ImpersonationRow[]> {
  return (await sql`
    SELECT s.id AS "sessionId", u.id AS "userId", u.email AS "userEmail", u."fullName" AS "userName",
      s."createdAt" AS "startedAt", s."expiresAt", s."revokedAt" AS "endedAt", s."impersonatedBy"
    FROM sessions s JOIN users u ON u.id = s."userId"
    WHERE s."impersonatedBy" IS NOT NULL AND s."revokedAt" IS NULL AND s."expiresAt" > now()
    ORDER BY s."createdAt" DESC
    LIMIT 50`) as unknown as ImpersonationRow[];
}

export interface ErrorBreadcrumbRow {
  id: string;
  createdAt: Date;
  source: string;
  message: string;
  route: string | null;
  method: string | null;
  status: number | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string | null;
  companyId: string | null;
  body: string | null;
}

/**
 * Reads breadcrumbs from the dedicated logs database when available
 * (logsSql non-null), else from the main application database (dev / not yet
 * provisioned). Never throws: a broken logs DB renders an empty trail rather
 * than failing the whole page.
 *
 * The extended columns are read with a LEGACY FALLBACK, and that is not
 * defensive padding. The logs database gets its shape from the Backend's
 * schema-on-write, so between deploying this change and the first breadcrumb
 * being written, an existing logs database still has the OLD columns. Selecting
 * a column that is not there throws — and the catch below turns that into an
 * empty list, which on this page reads as "no errors recorded". An observability
 * page that silently reports a clean bill of health because its own query failed
 * is worse than one that shows less detail, so it degrades to the old column set
 * instead.
 */
export async function loadErrorBreadcrumbs(logsSql: Sql | null, mainSql: Sql, limit = 50): Promise<ErrorBreadcrumbRow[]> {
  const full = (sql: Sql) =>
    sql`
      SELECT id, "createdAt", source, message, route, method, status, "requestId",
             "ipAddress", "userAgent", "userId", "companyId", body
      FROM error_log
      ORDER BY "createdAt" DESC
      LIMIT ${limit}` as unknown as Promise<ErrorBreadcrumbRow[]>;

  // Pre-migration shape: same rows, no context columns.
  const legacy = (sql: Sql) =>
    sql`
      SELECT id, "createdAt", source, message, route, method, status, "requestId",
             NULL AS "ipAddress", NULL AS "userAgent", NULL AS "userId",
             NULL AS "companyId", NULL AS body
      FROM error_log
      ORDER BY "createdAt" DESC
      LIMIT ${limit}` as unknown as Promise<ErrorBreadcrumbRow[]>;

  const attempt = async (sql: Sql): Promise<ErrorBreadcrumbRow[]> => {
    try {
      return await full(sql);
    } catch {
      // Either the columns are not there yet, or the query failed for another
      // reason; the legacy shape distinguishes the two. If it also fails, the
      // caller gets an empty trail and the page still renders.
      try {
        return await legacy(sql);
      } catch {
        return [];
      }
    }
  };

  return attempt(logsSql ?? mainSql);
}
