// What actually gets cleaned, and why each rule is safe.
//
// Every sweep is a DELETE against rows that no longer serve their purpose.
// The interesting part of each one is not the SQL but the boundary: which rows
// are provably dead versus which are still load-bearing. Those boundaries are
// documented per rule because guessing wrong here either loses data or leaves
// the table growing forever.

import type { Sql, SweepResult } from "./db";
import { sweep } from "./db";

export interface RetentionConfig {
  SESSION_RETENTION_DAYS: number;
  PASSWORD_RESET_RETENTION_DAYS: number;
  NOTIFICATION_RETENTION_DAYS: number;
  SYNC_ERROR_RETENTION_DAYS: number;
  AUDIT_LOG_RETENTION_DAYS: number;
}

export async function runAllSweeps(sql: Sql, cfg: RetentionConfig): Promise<SweepResult[]> {
  const results: SweepResult[] = [];

  // ── Sessions ──────────────────────────────────────────────────────────────
  // Two kinds of dead session: revoked (logged out, rotated on refresh, or
  // killed by a password change) and expired (past expiresAt).
  //
  // Retention is deliberately LONGER than the longest refresh token (30 days
  // for remember-me). Reason: `refresh()` treats a revoked token that arrives
  // again as proof of theft and revokes every session for that user
  // (auth.service.ts). If the revoked row were already deleted, the same
  // stolen token would instead fail with "invalid session" — the alarm never
  // fires. Keeping revoked rows past the token's own lifetime preserves that
  // detection for as long as the token could possibly be replayed.
  results.push(
    await sweep(sql, "sessions (revoked)", cfg.SESSION_RETENTION_DAYS, async (cutoff) => {
      const rows = await sql`
        DELETE FROM sessions
        WHERE "revokedAt" IS NOT NULL
          AND "revokedAt" < ${cutoff}
        RETURNING id`;
      return rows.length;
    })
  );

  results.push(
    await sweep(sql, "sessions (expired)", cfg.SESSION_RETENTION_DAYS, async (cutoff) => {
      const rows = await sql`
        DELETE FROM sessions
        WHERE "expiresAt" < ${cutoff}
        RETURNING id`;
      return rows.length;
    })
  );

  // ── Password reset tokens ─────────────────────────────────────────────────
  // Single-use links. A used row only records "this link is spent", and an
  // expired one is dead on arrival (the verify path checks both `usedAt` and
  // `expiresAt` before honouring a token). Nothing references these rows, so
  // they are pure residue once past their own expiry.
  results.push(
    await sweep(sql, "password_reset_tokens", cfg.PASSWORD_RESET_RETENTION_DAYS, async (cutoff) => {
      const rows = await sql`
        DELETE FROM password_reset_tokens
        WHERE "expiresAt" < ${cutoff}
           OR ("usedAt" IS NOT NULL AND "usedAt" < ${cutoff})
        RETURNING id`;
      return rows.length;
    })
  );

  // ── Notifications ─────────────────────────────────────────────────────────
  // READ rows only.
  //
  // Unread rows are never touched, for two reasons that both matter:
  //   1. They are the user's inbox — an unread alert has not been delivered
  //      to anyone's attention yet, so age alone does not make it disposable.
  //   2. The low-stock anti-spam keys (`action`, e.g.
  //      "low-stock:reorder:<productId>:<warehouseId>") suppress duplicate
  //      alerts only while an UNREAD row with that key exists. Deleting unread
  //      rows would make the same low-stock condition re-alert on every stock
  //      movement.
  // A read notification has been seen; two weeks later it is history.
  results.push(
    await sweep(sql, "notifications (read)", cfg.NOTIFICATION_RETENTION_DAYS, async (cutoff) => {
      const rows = await sql`
        DELETE FROM notifications
        WHERE "isRead" = true
          AND "createdAt" < ${cutoff}
        RETURNING id`;
      return rows.length;
    })
  );

  // ── Sync errors ───────────────────────────────────────────────────────────
  // Only terminal states. PENDING rows are an open problem someone still has to
  // act on (the Stores screen shows them, and the retry endpoint re-fetches from
  // Shopify), so age does not make them deletable — a months-old unresolved
  // import failure is exactly the thing you must not silently drop.
  results.push(
    await sweep(sql, "sync_errors (resolved/ignored)", cfg.SYNC_ERROR_RETENTION_DAYS, async (cutoff) => {
      const rows = await sql`
        DELETE FROM sync_errors
        WHERE status IN ('RESOLVED', 'IGNORED')
          AND "createdAt" < ${cutoff}
        RETURNING id`;
      return rows.length;
    })
  );

  // ── Audit logs ────────────────────────────────────────────────────────────
  // The record of who did what. Oldest retention of the set, and the one most
  // likely to be wanted for a dispute — hence a full year by default.
  results.push(
    await sweep(sql, "audit_logs", cfg.AUDIT_LOG_RETENTION_DAYS, async (cutoff) => {
      const rows = await sql`
        DELETE FROM audit_logs
        WHERE "createdAt" < ${cutoff}
        RETURNING id`;
      return rows.length;
    })
  );

  // ── Deliberately NOT swept ────────────────────────────────────────────────
  //
  // api_keys — soft-deleted rows (`deletedAt`) are a security audit trail:
  //   "this key existed and was revoked". They are already excluded from every
  //   query (`deletedAt: null`), so they cost nothing at runtime, and a key's
  //   history is exactly what you want after an incident. Deleting them would
  //   also break the FK from nothing — they are referenced by no table, so
  //   there is no cascade reason either.
  //
  // product_images (and the R2 objects behind them) — soft-deleting a product
  //   only stamps `deletedAt`; the image rows survive, because
  //   `POST /products/:id/restore` sets it back to null and the product returns
  //   with its images intact. Sweeping them would destroy files the user can
  //   legitimately bring back. Hard delete is what removes an object, and that
  //   is a user action, not a retention decision.
  //
  // error_log / status pings — already self-pruning (newest 200 rows; 48h raw
  //   with 90 days of rollups). A sweep here would duplicate existing logic.
  //
  // orders / inventory / accounting — business records. A retention window for
  //   financial data is the company's decision under its own jurisdiction, not
  //   a default this worker should impose.

  return results;
}
