import { AsyncLocalStorage } from "node:async_hooks";
import { db, type Db } from "./database.js";

export interface RequestContext {
  /** Null only for platform staff, who belong to no company. */
  companyId: string | null;
  userId: string;
  isPlatformAdmin: boolean;
  /** Effective permissions: everything for owners, otherwise from roles. */
  permissions: ReadonlySet<string>;
  /** True when the user is the company's single owner. */
  isCompanyOwner: boolean;
  /** The session behind this request (JWT sid) — lets /auth/me banner
   *  impersonation. Absent on internal constructions. */
  sessionId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The context for the request currently executing, if there is one. */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` with the company context applied to the database session.
 *
 * The settings are applied with `set_config(..., true)` — transaction-local.
 * That matters: with a connection pool, a session-level setting would be
 * applied to whichever connection happened to serve that one statement, and
 * the next query on a different connection would silently lose it. Scoping to
 * the transaction makes the guarantee hold for every statement inside.
 *
 * Services receive the transaction client and must not open their own
 * transaction; use savepoints if a nested unit of work is needed.
 */
export async function withCompanyScope<T>(
  ctx: RequestContext,
  fn: (tx: Db) => Promise<T>
): Promise<T> {
  return db.$transaction(
    (tx) =>
      applyContext(tx, ctx).then(() => storage.run(ctx, () => fn(tx))),
    { timeout: 30_000 }
  );
}

async function applyContext(tx: Db, ctx: RequestContext): Promise<void> {
  // One round-trip, not two: these are independent transaction-local settings,
  // and every request pays this cost before its handler runs.
  await tx.$executeRaw`
    SELECT
      set_config('app.company_id', ${ctx.companyId ?? ""}, true),
      set_config('app.is_platform_admin', ${ctx.isPlatformAdmin ? "true" : "false"}, true)
  `;
}

