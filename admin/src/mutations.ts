// All write SQL for the admin worker. Every mutation runs in a sql.begin()
// transaction and writes an audit_logs row. The suspend/reactivate contract
// mirrors Backend company.service.ts setStatus (status + session revoke +
// audit, together). Gotchas applied: camelCase quoted columns, TEXT ids,
// notifications has NO updatedAt column (insert omits it).

import { sha256Hex, randomToken, uuidv7, SQL_UUID, type Sql } from "./db.js";
import type { TransactionSql } from "postgres";

/** The transaction handle postgres.js passes to sql.begin callbacks. */
type Tx = TransactionSql<Record<string, unknown>>;

const IMPERSONATION_UA_PREFIX = "IMPERSONATION by";

export interface AuditInput {
  actorId: string | null; // platform admin user id (company-less), if known
  companyId?: string | null;
  action?: string;
  entity?: string;
  entityId?: string | null;
  summary?: string;
  changes?: unknown;
  ipAddress?: string | null;
}

export async function writeAudit(sql: Tx, input: AuditInput): Promise<void> {
  await sql`
    INSERT INTO audit_logs (id, "companyId", "actorId", action, entity, "entityId", summary, changes, "ipAddress")
    VALUES (${uuidv7()}, ${input.companyId ?? null}, ${input.actorId}, ${input.action ?? "ADMIN_ACTION"}, ${input.entity ?? "Platform"},
      ${input.entityId ?? null}, ${input.summary ?? null}, ${input.changes === undefined ? null : JSON.stringify(input.changes)}, ${input.ipAddress ?? null})`;
}

/** The company-less platform admin user backing this worker's actions. */
export async function resolvePlatformAdminActor(sql: Sql): Promise<string | null> {
  const rows = (await sql`
    SELECT id FROM users WHERE "isPlatformAdmin" = true AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1`) as unknown as { id: string }[];
  return rows[0]?.id ?? null;
}

export type CompanyStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

/**
 * Company status change — mirrors Backend company.service.ts setStatus:
 * status + suspendedAt/suspensionReason (or activatedAt) + revoke ALL company
 * user sessions when blocking + audit row, in one transaction.
 * Returns revoked session count, or null when company not found.
 */
export async function setCompanyStatus(
  sql: Sql,
  id: string,
  status: CompanyStatus,
  reason: string | undefined,
  audit: AuditInput
): Promise<number | null> {
  return sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT id, name, status::text AS status FROM companies WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`) as unknown as { id: string; name: string; status: string }[];
    const company = rows[0];
    if (!company) return null;
    if (company.status === status) return 0;

    const blocking = status === "SUSPENDED" || status === "CLOSED";
    await tx`
      UPDATE companies SET
        status = ${status},
        "suspendedAt" = ${blocking ? new Date() : null},
        "suspensionReason" = ${blocking ? reason ?? null : null},
        "activatedAt" = ${status === "ACTIVE" ? new Date() : null},
        "updatedAt" = now()
      WHERE id = ${id}`;

    let revoked = 0;
    if (blocking) {
      const res = await tx`
        UPDATE sessions s SET "revokedAt" = now(), "updatedAt" = now()
        FROM users u
        WHERE s."userId" = u.id AND u."companyId" = ${id} AND s."revokedAt" IS NULL`;
      revoked = res.count;
    }

    await writeAudit(tx, {
      ...audit,
      companyId: id,
      action: "COMPANY_STATUS_CHANGED",
      entity: "Company",
      entityId: id,
      summary: `${company.name}: ${company.status} → ${status}${blocking && reason ? ` — ${reason}` : ""}`,
      changes: { before: { status: company.status }, after: { status }, reason: reason ?? null },
    });
    return revoked;
  });
}

export type UserStatus = "INVITED" | "ACTIVE" | "SUSPENDED";

/**
 * User status change: status + securityStamp bump (live access tokens carry
 * the stamp and die on next use) + revoke sessions + audit, in one transaction.
 */
export async function setUserStatus(
  sql: Sql,
  id: string,
  status: UserStatus,
  audit: AuditInput
): Promise<"ok" | "notfound" | "self" | "platform-admin" | "owner-protected" | "noop"> {
  return sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT id, email, status::text AS status, "isPlatformAdmin", "companyId",
        (EXISTS (SELECT 1 FROM companies c WHERE c."ownerId" = users.id AND c."deletedAt" IS NULL)) AS "isCompanyOwner"
      FROM users WHERE id = ${id} AND "deletedAt" IS NULL FOR UPDATE`) as unknown as { id: string; email: string; status: string; isPlatformAdmin: boolean; companyId: string | null; isCompanyOwner: boolean }[];
    const user = rows[0];
    if (!user) return "notfound";
    if (user.isPlatformAdmin) return "platform-admin";
    if (audit.actorId && user.id === audit.actorId) return "self";
    // The DB enforces owner usability (mawzun_assert_owner_usable): a company
    // owner cannot be suspended or soft-deleted while their company lives.
    // Pre-check so the admin gets a readable refusal, not a SQL error.
    if (user.isCompanyOwner && status === "SUSPENDED") return "owner-protected";
    if (user.status === status) return "noop";

    await tx`
      UPDATE users SET status = ${status}, "securityStamp" = ${randomToken(24)}, "updatedAt" = now()
      WHERE id = ${id}`;
    await tx`
      UPDATE sessions SET "revokedAt" = now(), "updatedAt" = now()
      WHERE "userId" = ${id} AND "revokedAt" IS NULL`;
    await writeAudit(tx, {
      ...audit,
      companyId: user.companyId,
      action: "USER_STATUS_CHANGED",
      entity: "User",
      entityId: id,
      summary: `${user.email}: ${user.status} → ${status}`,
      changes: { before: { status: user.status }, after: { status } },
    });
    return "ok";
  });
}

export async function forceLogoutUser(
  sql: Sql,
  id: string,
  audit: AuditInput
): Promise<"ok" | "notfound" | number> {
  return sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT id, email, "companyId" FROM users WHERE id = ${id} AND "deletedAt" IS NULL`) as unknown as { id: string; email: string; companyId: string | null }[];
    const user = rows[0];
    if (!user) return "notfound";
    const res = await tx`
      UPDATE sessions SET "revokedAt" = now(), "updatedAt" = now()
      WHERE "userId" = ${id} AND "revokedAt" IS NULL`;
    await writeAudit(tx, {
      ...audit,
      companyId: user.companyId,
      action: "USER_FORCE_LOGOUT",
      entity: "User",
      entityId: id,
      summary: `${user.email}: ${res.count} session(s) revoked`,
    });
    return res.count;
  });
}

export async function revokeApiKey(
  sql: Sql,
  id: string,
  audit: AuditInput
): Promise<"ok" | "notfound" | "noop"> {
  return sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT k.id, k.name, k."companyId", k."revokedAt" FROM api_keys k
      WHERE k.id = ${id} AND k."deletedAt" IS NULL FOR UPDATE`) as unknown as { id: string; name: string; companyId: string; revokedAt: Date | null }[];
    const key = rows[0];
    if (!key) return "notfound";
    if (key.revokedAt) return "noop";
    await tx`UPDATE api_keys SET "revokedAt" = now(), "updatedAt" = now() WHERE id = ${id}`;
    await writeAudit(tx, {
      ...audit,
      companyId: key.companyId,
      action: "API_KEY_REVOKED",
      entity: "ApiKey",
      entityId: id,
      summary: `${key.name}: revoked`,
    });
    return "ok";
  });
}

export interface SendNotificationInput {
  companyId: string;
  userId: string | null;
  title: string;
  message: string;
  category: "GENERAL" | "ORDER" | "INVENTORY" | "SYSTEM";
  link: string | null;
  emailCopy: boolean;
}

/** Send one notification; returns the notification row id (or null if company/user invalid). */
export async function sendNotification(
  sql: Sql,
  input: SendNotificationInput,
  audit: AuditInput
): Promise<string | null> {
  return sql.begin(async (tx) => {
    const companyRows = (await tx`
      SELECT id, name FROM companies WHERE id = ${input.companyId} AND "deletedAt" IS NULL`) as unknown as { id: string; name: string }[];
    const company = companyRows[0];
    if (!company) return null;
    if (input.userId) {
      const userRows = (await tx`
        SELECT id FROM users WHERE id = ${input.userId} AND "companyId" = ${input.companyId} AND "deletedAt" IS NULL`) as unknown as { id: string }[];
      if (!userRows[0]) return null;
    }
    const id = uuidv7();
    await tx`
      INSERT INTO notifications (id, "companyId", "userId", title, message, category, link)
      VALUES (${id}, ${input.companyId}, ${input.userId}, ${input.title}, ${input.message}, ${input.category}, ${input.link})`;
    await writeAudit(tx, {
      ...audit,
      companyId: input.companyId,
      action: "NOTIFICATION_SENT",
      entity: "Notification",
      entityId: id,
      summary: `${company.name}${input.userId ? " (user)" : " (company-wide)"}: ${input.title}${input.emailCopy ? " + email copy" : ""}`,
      changes: { title: input.title, category: input.category, link: input.link, emailCopy: input.emailCopy },
    });
    return id;
  });
}

/** Broadcast a notification to every non-closed, non-deleted company. Single INSERT...SELECT. */
export async function broadcastNotification(
  sql: Sql,
  input: Omit<SendNotificationInput, "companyId" | "userId" | "emailCopy">,
  audit: AuditInput
): Promise<number> {
  return sql.begin(async (tx) => {
    // Per-row ids: a parameterized uuid fragment is evaluated ONCE for the
    // whole statement (same id per row → pkey violation), so the id expression
    // must be an UNSAFE constant fragment — constants only, never user input
    // (skill rule 2b). Title/message/link stay parameterized.
    const res = await tx.unsafe(
      `INSERT INTO notifications (id, "companyId", "userId", title, message, category, link)
       SELECT ${SQL_UUID}, c.id, NULL, $1, $2, $3::"NotificationCategory", $4
       FROM companies c WHERE c."deletedAt" IS NULL AND c.status::text <> 'CLOSED'`,
      [input.title, input.message, input.category, input.link]
    );
    await writeAudit(tx, {
      ...audit,
      action: "BROADCAST_SENT",
      entity: "Notification",
      summary: `Broadcast to ${res.count} companies: ${input.title}`,
      changes: { title: input.title, category: input.category, link: input.link, companies: res.count },
    });
    return res.count;
  });
}

export interface ImpersonationTarget {
  result: "ok" | "notfound" | "platform-admin" | "suspended" | "already-active";
  refreshToken?: string;
  sessionId?: string;
  userName?: string;
}

/**
 * Mint an impersonation session for the target user. The refresh token is
 * returned ONCE to the admin, who uses it on the impersonation landing page
 * (exchanged via POST /auth/refresh {refreshToken} — accepted in body).
 * The session row is marked with an IMPERSONATION-by userAgent so the audit
 * view can list every live/ended impersonation and the Backend can recognize it.
 */
export async function startImpersonation(
  sql: Sql,
  targetUserId: string,
  adminEmail: string,
  audit: AuditInput
): Promise<ImpersonationTarget> {
  return sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT id, email, "fullName", status::text AS status, "isPlatformAdmin", "companyId"
      FROM users WHERE id = ${targetUserId} AND "deletedAt" IS NULL FOR UPDATE`) as unknown as { id: string; email: string; fullName: string; status: string; isPlatformAdmin: boolean; companyId: string | null }[];
    const user = rows[0];
    if (!user) return { result: "notfound" };
    if (user.isPlatformAdmin) return { result: "platform-admin" };
    if (user.status !== "ACTIVE") return { result: "suspended" };

    const live = (await tx`
      SELECT id FROM sessions WHERE "userId" = ${user.id} AND "impersonatedBy" IS NOT NULL
        AND "revokedAt" IS NULL AND "expiresAt" > now() LIMIT 1`) as unknown as { id: string }[];
    if (live[0]) return { result: "already-active" };

    const refreshToken = randomToken(48);
    const tokenHash = await sha256Hex(refreshToken);
    const sessionId = uuidv7();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
    await tx`
      INSERT INTO sessions (id, "updatedAt", "userId", "refreshToken", "expiresAt", "userAgent", "ipAddress", "impersonatedBy")
      VALUES (${sessionId}, now(), ${user.id}, ${tokenHash}, ${expiresAt}, ${`${IMPERSONATION_UA_PREFIX} ${adminEmail}`}, ${audit.ipAddress ?? null}, ${adminEmail})`;
    await writeAudit(tx, {
      ...audit,
      companyId: user.companyId,
      action: "IMPERSONATION_STARTED",
      entity: "User",
      entityId: user.id,
      summary: `Admin ${audit.ipAddress ?? ""} started impersonation of ${user.email} (session ${sessionId})`,
    });
    return { result: "ok", refreshToken, sessionId, userName: user.fullName };
  });
}

export async function endImpersonation(
  sql: Sql,
  sessionId: string,
  audit: AuditInput
): Promise<"ok" | "notfound"> {
  return sql.begin(async (tx) => {
    const rows = (await tx`
      SELECT s.id, s."userId", s."createdAt", u.email, u."companyId" FROM sessions s
      JOIN users u ON u.id = s."userId"
      WHERE s.id = ${sessionId} AND s."impersonatedBy" IS NOT NULL AND s."revokedAt" IS NULL FOR UPDATE`) as unknown as { id: string; userId: string; createdAt: Date; email: string; companyId: string | null }[];
    const session = rows[0];
    if (!session) return "notfound";
    await tx`UPDATE sessions SET "revokedAt" = now(), "updatedAt" = now() WHERE id = ${sessionId}`;
    await writeAudit(tx, {
      ...audit,
      companyId: session.companyId,
      action: "IMPERSONATION_ENDED",
      entity: "User",
      entityId: session.userId,
      summary: `Impersonation of ${session.email} ended (started ${session.createdAt.toISOString()})`,
    });
    return "ok";
  });
}
