// Live verification of the cleanup worker's sweeps.
//
// Runs against the real local database through the REAL worker code (the same
// modules the Worker bundle uses), with seeded rows on both sides of every
// boundary. The point is to prove the boundary, not the SQL: each case inserts
// a row just inside the retention window and one just outside, then asserts
// exactly one of them survives.
//
// Usage: node verify-sweeps.mjs
// Safe to re-run: every fixture is stamped and removed in a finally block.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { runAllSweeps } from "./src/sweeps.ts";
import { assertCanSeeAllCompanies } from "./src/db.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

// Reuse the Backend's own credential so the test connects exactly as
// production does (owner role, RLS bypassed).
const backendEnv = readFileSync(resolve(HERE, "../api/.env"), "utf8");
const line = backendEnv.match(/^DIRECT_DATABASE_URL="?([^"\n]+)"?/m);
if (!line) throw new Error("DIRECT_DATABASE_URL not found in api/.env");
const url = line[1].replace(/\?schema=\w+$/, "");

const sql = postgres(url, { max: 2, prepare: false });

const RUN = `cln-${Date.now()}`;
const DAY = 86_400_000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

// Retention config used by the assertions (matches wrangler.jsonc defaults).
const CFG = {
  SESSION_RETENTION_DAYS: 45,
  PASSWORD_RESET_RETENTION_DAYS: 1,
  NOTIFICATION_RETENTION_DAYS: 14,
  SYNC_ERROR_RETENTION_DAYS: 90,
  AUDIT_LOG_RETENTION_DAYS: 365,
};

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A real company + user to hang rows off (FKs are NOT NULL on most tables).
const [company] = await sql`
  SELECT id FROM companies ORDER BY "createdAt" LIMIT 1`;
if (!company) throw new Error("no company in the database to attach fixtures to");
const companyId = company.id;

const [user] = await sql`
  SELECT id FROM users WHERE "companyId" = ${companyId} LIMIT 1`;
if (!user) throw new Error("no user for the fixture company");
const userId = user.id;

// Platform admin context is needed to INSERT/read across the RLS policies when
// connected as a non-owner — harmless as owner.
await sql`SELECT set_config('app.is_platform_admin', 'true', false)`;

const created = { sessions: [], resets: [], notifications: [], syncErrors: [], auditLogs: [] };

try {
  // --- sessions: 4 rows — revoked-old, revoked-new, expired-old, live ------
  const mkSession = async (label, expiresAt, revokedAt) => {
    const [row] = await sql`
      INSERT INTO sessions (id, "userId", "refreshToken", "expiresAt", "revokedAt", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${userId}, ${`${RUN}-${label}`}, ${expiresAt}, ${revokedAt}, now(), now())
      RETURNING id`;
    created.sessions.push(row.id);
    return row.id;
  };
  const sRevokedOld = await mkSession("s-revoked-old", daysAgo(-10), daysAgo(60));
  const sRevokedNew = await mkSession("s-revoked-new", daysAgo(-10), daysAgo(1));
  const sExpiredOld = await mkSession("s-expired-old", daysAgo(60), null);
  const sLive = await mkSession("s-live", daysAgo(-5), null);

  // --- password reset tokens: used-old, used-new, live --------------------
  const mkReset = async (label, expiresAt, usedAt) => {
    const [row] = await sql`
      INSERT INTO password_reset_tokens (id, "userId", "tokenHash", "expiresAt", "usedAt", "createdAt")
      VALUES (gen_random_uuid()::text, ${userId}, ${`${RUN}-${label}`.slice(0, 64)}, ${expiresAt}, ${usedAt}, now())
      RETURNING id`;
    created.resets.push(row.id);
    return row.id;
  };
  // NOTE: `expiresAt` must be in the FUTURE for the two "inside retention"
  // cases. A token that is merely recent but already expired is dead on
  // arrival and the sweep deletes it on purpose — using it here would assert
  // the wrong thing (this fixture bug caught a real ambiguity the first run).
  const rUsedOld = await mkReset("r-used-old", daysAgo(5), daysAgo(3));
  const rUsedNew = await mkReset("r-used-new", daysAgo(-2), daysAgo(0.2));
  const rLive = await mkReset("r-live", daysAgo(-2), null);
  const rExpiredUnused = await mkReset("r-expired-unused", daysAgo(5), null);

  // --- notifications: read-old, read-new, unread-old (the anti-spam key) ---
  const mkNotif = async (label, isRead, createdAt) => {
    const [row] = await sql`
      INSERT INTO notifications (id, "companyId", "userId", title, message, category, "isRead", "createdAt", action)
      VALUES (gen_random_uuid()::text, ${companyId}, ${userId}, ${`${RUN} ${label}`}, '', 'GENERAL', ${isRead}, ${createdAt}, ${`${RUN}:${label}`})
      RETURNING id`;
    created.notifications.push(row.id);
    return row.id;
  };
  const nReadOld = await mkNotif("n-read-old", true, daysAgo(30));
  const nReadNew = await mkNotif("n-read-new", true, daysAgo(2));
  const nUnreadOld = await mkNotif("n-unread-old", false, daysAgo(30));

  // --- sync errors: resolved-old, resolved-new, pending-old ----------------
  const mkSyncErr = async (label, status, createdAt) => {
    const [row] = await sql`
      INSERT INTO sync_errors (id, "companyId", "storeName", "errorType", "errorMessage", status, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${companyId}, ${`${RUN} store`}, ${`${RUN}_TYPE`}, 'fixture', ${status}, ${createdAt}, now())
      RETURNING id`;
    created.syncErrors.push(row.id);
    return row.id;
  };
  const eResolvedOld = await mkSyncErr("e-resolved-old", "RESOLVED", daysAgo(200));
  const eResolvedNew = await mkSyncErr("e-resolved-new", "RESOLVED", daysAgo(10));
  const ePendingOld = await mkSyncErr("e-pending-old", "PENDING", daysAgo(200));

  // --- audit logs: old, new ------------------------------------------------
  const mkAudit = async (label, createdAt) => {
    const [row] = await sql`
      INSERT INTO audit_logs (id, "companyId", "actorId", action, entity, summary, "createdAt")
      VALUES (gen_random_uuid()::text, ${companyId}, ${userId}, ${`${RUN}.${label}`}, 'fixture', 'fixture', ${createdAt})
      RETURNING id`;
    created.auditLogs.push(row.id);
    return row.id;
  };
  const aOld = await mkAudit("a-old", daysAgo(500));
  const aNew = await mkAudit("a-new", daysAgo(10));

  // -------------------------------------------------------------------------
  // Run the real sweeps
  // -------------------------------------------------------------------------
  console.log("\n=== running the real sweeps (src/sweeps.ts) ===\n");
  await assertCanSeeAllCompanies(sql);
  console.log("  visibility guard: PASS (role sees every company)\n");

  const results = await runAllSweeps(sql, CFG);
  for (const r of results) {
    console.log(`  ${r.label.padEnd(34)} deleted=${r.deleted}${r.error ? "  ERROR: " + r.error : ""}`);
  }

  // -------------------------------------------------------------------------
  // Assertions: the rows on the wrong side of each boundary
  // -------------------------------------------------------------------------
  const alive = async (table, id) => {
    const rows = await sql`SELECT 1 FROM ${sql(table)} WHERE id = ${id}`;
    return rows.length > 0;
  };

  console.log("\n=== boundaries ===\n");

  check("revoked session past retention deleted", !(await alive("sessions", sRevokedOld)));
  check("revoked session inside retention kept", await alive("sessions", sRevokedNew));
  check("expired session past retention deleted", !(await alive("sessions", sExpiredOld)));
  check("live session untouched", await alive("sessions", sLive));

  check("used reset token past retention deleted", !(await alive("password_reset_tokens", rUsedOld)));
  check("used reset token inside retention kept", await alive("password_reset_tokens", rUsedNew));
  check("live reset token untouched", await alive("password_reset_tokens", rLive));
  check("expired unused reset token deleted (dead on arrival)", !(await alive("password_reset_tokens", rExpiredUnused)));

  check("READ notification past retention deleted", !(await alive("notifications", nReadOld)));
  check("READ notification inside retention kept", await alive("notifications", nReadNew));
  check("UNREAD notification kept (anti-spam key)", await alive("notifications", nUnreadOld));

  check("RESOLVED sync error past retention deleted", !(await alive("sync_errors", eResolvedOld)));
  check("RESOLVED sync error inside retention kept", await alive("sync_errors", eResolvedNew));
  check("PENDING sync error kept (open problem)", await alive("sync_errors", ePendingOld));

  check("audit log past retention deleted", !(await alive("audit_logs", aOld)));
  check("audit log inside retention kept", await alive("audit_logs", aNew));

  // -------------------------------------------------------------------------
  // The visibility guard must actually refuse a blind connection
  // -------------------------------------------------------------------------
  console.log("\n=== visibility guard (the anti-silent-failure check) ===\n");
  const restricted = readFileSync(resolve(HERE, "../api/.env"), "utf8").match(/^DATABASE_URL="?([^"\n]+)"?/m);
  if (restricted) {
    const restrictedSql = postgres(restricted[1].replace(/\?schema=\w+$/, ""), { max: 1, prepare: false });
    try {
      let threw = false;
      try {
        await assertCanSeeAllCompanies(restrictedSql);
      } catch (e) {
        threw = /row-level security|silently match zero rows/.test(String(e));
      }
      check("guard REFUSES the RLS-restricted role", threw);
    } finally {
      await restrictedSql.end({ timeout: 1 }).catch(() => {});
    }
  } else {
    check("guard REFUSES the RLS-restricted role", false, "DATABASE_URL not found to test with");
  }
} finally {
  // Remove every fixture, including the ones the sweep already deleted.
  const ids = created;
  await sql`DELETE FROM sessions WHERE id = ANY(${ids.sessions})`.catch(() => {});
  await sql`DELETE FROM password_reset_tokens WHERE id = ANY(${ids.resets})`.catch(() => {});
  await sql`DELETE FROM notifications WHERE id = ANY(${ids.notifications})`.catch(() => {});
  await sql`DELETE FROM sync_errors WHERE id = ANY(${ids.syncErrors})`.catch(() => {});
  await sql`DELETE FROM audit_logs WHERE id = ANY(${ids.auditLogs})`.catch(() => {});
  const leftover =
    (await sql`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE ${RUN + "%"}`)[0].n;
  console.log(`\ncleanup: fixtures removed (leftover audit rows: ${leftover})`);
  await sql.end({ timeout: 1 }).catch(() => {});
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
