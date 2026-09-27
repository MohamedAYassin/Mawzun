import type { NextFunction, RequestHandler, Response } from "express";
import type { RequestContext } from "../config/companyContext.js";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.js";

function ensureContext(req: { ctx?: RequestContext | undefined }): RequestContext {
  if (!req.ctx) throw new UnauthorizedError("لم يتم تسجيل الدخول.");
  return req.ctx;
}

/**
 * Allows the request only if the caller holds the permission.
 *
 * There is deliberately no "platform admin bypass" here. Platform staff are
 * granted every permission at authentication time, so they satisfy this check
 * on merit. Short-circuiting on `isPlatformAdmin` used to let them through
 * *company-scoped* routes too, where `ctx.companyId` is null — the service
 * would then run `where: { companyId: null }`, which Prisma compiles to
 * `companyId IS NULL` and which returns a silently truncated result instead of
 * an honest denial. Keeping one rule (permissions) instead of two makes that
 * class of bug impossible.
 */
export function requirePermission(...permissions: string[]): RequestHandler {
  return (req, _res: Response, next: NextFunction) => {
    try {
      const ctx = ensureContext(req);
      const allowed = permissions.some((p) => ctx.permissions.has(p));
      if (!allowed) {
        throw new ForbiddenError(`ليس لديك الصلاحية الكافية: ${permissions.join(" أو ")}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Guards the boundary between company-scoped routes and platform routes.
 *
 * Platform staff have `companyId === null` by design — they administer the
 * installation rather than belong to one of its companies. They are therefore
 * not entitled to call endpoints that operate on "my company", and every
 * service behind those endpoints legitimately assumes a non-null companyId.
 *
 * Without this, `req.ctx.companyId!` lies: the assertion passes at compile
 * time and the null reaches the query. This turns that into a 403 at the
 * edge, before any service runs.
 */
export function requireCompanyContext(): RequestHandler {
  return (req, _res: Response, next: NextFunction) => {
    try {
      const ctx = ensureContext(req);
      if (!ctx.companyId) {
        throw new ForbiddenError(
          "هذا الإجراء يتطلب الانتماء إلى شركة. حسابات إدارة المنصة تستخدم مسارات المنصة."
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Allows only platform staff. */
export function requirePlatformAdmin(): RequestHandler {
  return (req, _res: Response, next: NextFunction) => {
    try {
      const ctx = ensureContext(req);
      if (!ctx.isPlatformAdmin) {
        throw new ForbiddenError("هذا الإجراء متاح لإدارة المنصة فقط.");
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
