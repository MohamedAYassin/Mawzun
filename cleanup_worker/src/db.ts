// PostgreSQL access for the cleanup worker.
//
// Every Mawzun service shares one database; this worker never calls another
// service. It deletes rows that have outlived their retention window, and
// nothing else.
//
// Bindings required:
//   DATABASE_URL  — the shared Postgres connection string (Hyperdrive in
//                   production; resolved live from Heroku's Platform API when
//                   the binding is absent, exactly like the other Workers)
//
// Column names: Prisma creates camelCase quoted identifiers ("companyId",
// "expiresAt", …) — every query must quote them exactly.

import postgres from "postgres";

// Workerd forbids sharing I/O objects across request contexts, so the client
// is created per invocation and closed by the caller.
export type Sql = ReturnType<typeof postgres>;

// Hyperdrive path (production): the binding speaks the Postgres wire protocol
// over Cloudflare's internal network — pooled at the edge, no TLS fight, no
// per-query socket storm.
export function makeHyperdriveSql(hd: Hyperdrive): Sql {
  return postgres(hd.connectionString, { max: 2, prepare: false });
}

export function makeSql(databaseUrl: string, env: { DATABASE_SSL?: string }): Sql {
  // postgres.js forwards unknown URL query params as Postgres startup GUCs;
  // `?schema=public` (a node-postgres-ism in the shared DATABASE_URL) becomes
  // an invalid `schema` parameter. Convert it to the driver's search_path.
  // Same for `sslmode`/`ssl`: Heroku URLs carry `?sslmode=require`, which would
  // also be forwarded as an invalid GUC — read it as the TLS signal, then strip it.
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get("schema") || undefined;
  parsed.searchParams.delete("schema");
  const sslMode = (parsed.searchParams.get("sslmode") ?? parsed.searchParams.get("ssl") ?? "").toLowerCase();
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("ssl");
  // Managed Postgres (Heroku/Supabase/Hyperdrive) requires TLS; local dev does not.
  const ssl = env.DATABASE_SSL === "1" || sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full"
    ? "require"
    : env.DATABASE_SSL === "0"
      ? false
      : sslMode === "disable" || sslMode === "allow" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
        ? false
        : "require";
  return postgres(parsed.toString(), {
    max: 2,
    prepare: false, // required behind Hyperdrive
    ...(schema ? { connection: { search_path: schema } } : {}),
    ssl,
  });
}

/**
 * Verifies this connection can actually SEE every company's rows.
 *
 * This is the guard that keeps the worker from being a convincing liar.
 *
 * Row-level security is enabled on every table this worker touches, and each
 * policy scopes rows to `current_setting('app.company_id')` — a setting a
 * background job has no way to know, because it is not acting for one company.
 * A connection subject to those policies therefore sees ZERO rows, so every
 * DELETE would report "0 deleted" and look like a clean run while the database
 * grew forever.
 *
 * The migration that makes this work in production is
 * `20260901000000_disable_force_rls_for_managed_postgres`: FORCE is off, so a
 * role that OWNS the tables bypasses its own policies. Hyperdrive is fed the
 * owner credential (Backend/scripts/sync-hyperdrive.mjs pushes DATABASE_URL),
 * which is why this worker can see across tenants at all.
 *
 * So the check is: does the current role bypass RLS, either because it is a
 * superuser/BYPASSRLS role or because it owns the tables? If not, fail loudly
 * rather than run a sweep that silently does nothing.
 */
export async function assertCanSeeAllCompanies(sql: Sql): Promise<void> {
  const rows = await sql`
    SELECT current_user AS role,
           (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass,
           pg_get_userbyid(c.relowner) AS owner,
           c.relforcerowsecurity AS forced
    FROM pg_class c
    WHERE c.oid = 'notifications'::regclass`;
  const r = rows[0] as unknown as { role: string; bypass: boolean; owner: string; forced: boolean } | undefined;
  if (!r) throw new Error("could not read role information for the notifications table");

  const seesEverything = r.bypass || (r.role === r.owner && !r.forced);
  if (!seesEverything) {
    throw new Error(
      `cleanup worker is connected as "${r.role}", which is subject to row-level security ` +
        `(owner is "${r.owner}", FORCE RLS is ${r.forced ? "on" : "off"}). ` +
        `Every sweep would silently match zero rows. Point this worker at the database ` +
        `owner credential — the same one Hyperdrive is given.`
    );
  }
}

/** Deletes rows older than `days` and returns how many went. */
export async function sweep(
  sql: Sql,
  label: string,
  days: number,
  run: (cutoff: Date) => Promise<number>
): Promise<SweepResult> {
  if (days <= 0) return { label, skipped: true, deleted: 0, days };
  const cutoff = new Date(Date.now() - days * 86_400_000);
  try {
    const deleted = await run(cutoff);
    return { label, skipped: false, deleted, days };
  } catch (err) {
    // One failing sweep must not abort the rest: they are independent tables
    // and a partial run is strictly better than none. The error is reported
    // so it is not silently swallowed.
    return { label, skipped: false, deleted: 0, days, error: String(err) };
  }
}

export interface SweepResult {
  label: string;
  skipped: boolean;
  deleted: number;
  days: number;
  error?: string;
}
