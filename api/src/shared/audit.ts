import type { Db } from "../config/database.js";
import { getContext } from "../config/companyContext.js";

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  summary?: string | null;
  changes?: unknown;
  /**
   * Explicit attribution, for actions taken outside a company-scoped request.
   *
   * Platform administration is the case that needs it: the actor has no
   * company of their own, and the row being changed belongs to somebody else's
   * company. Both ids are therefore supplied by the caller — which is safe
   * here, because they are read from server-side rows and from the
   * authenticated principal, never from the request body.
   */
  companyId?: string | null;
  actorId?: string | null;
}

/**
 * Appends to the audit trail.
 *
 * `companyId` and `actorId` come from the request context rather than being
 * passed by callers, so a caller cannot accidentally attribute an action to
 * the wrong company. When there is no context — a background job, for instance
 * — the entry is still written, just without an actor.
 */
export async function audit(tx: Db, input: AuditInput): Promise<void> {
  const ctx = getContext();

  await tx.auditLog.create({
    data: {
      companyId: input.companyId !== undefined ? input.companyId : (ctx?.companyId ?? null),
      actorId: input.actorId !== undefined ? input.actorId : (ctx?.userId ?? null),
      action: input.action,
      entity: input.entity,
      entityId: input.entityId ?? null,
      summary: input.summary ?? null,
      changes: input.changes === undefined ? undefined : (input.changes as object),
    },
  });
}
