import type { NextFunction, RequestHandler, Response } from "express";
import { dbAdmin } from "../config/database.js";
import type { RequestContext } from "../config/companyContext.js";
import { env } from "../config/env.js";
import { UnauthorizedError, ForbiddenError } from "../shared/errors.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { getAllPermissions } from "../constants/permissions.js";
import { checkLimit } from "../lib/rateLimit.js";

declare module "express-serve-static-core" {
  interface Request {
    ctx?: RequestContext;
    /** The row `authenticate` already loaded. /auth/me reuses it instead of
     *  re-querying the same user. Not a cache — it is the current request's
     *  own data, so it can never be stale. */
    principalRow?: unknown;
  }
}

/**
 * Resolves the bearer token into a usable request context.
 *
 * The lookup runs on the privileged client on purpose: at this point no company
 * is known yet, so row-level security would block the very query that tells us
 * which company to use. Everything after this point runs through `scoped()` and
 * is therefore sandboxed.
 */
export const authenticate: RequestHandler = async (req, res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError("توكن المصادقة مفقود.");
    }

    let payload;
    try {
      payload = verifyAccessToken(header.slice(7));
    } catch {
      throw new UnauthorizedError("توكن غير صالح أو منتهي الصلاحية.");
    }

    // Scalars first, then each relation as its own query — deliberately NOT
    // one select with both `company` and `roles`.
    //
    // Prisma fetches each relation with its own statement and issues them
    // CONCURRENTLY. On this client that is two statements racing, which pg warns
    // about today and rejects on pg 9 — and this middleware runs on EVERY
    // authenticated request, so it is the highest-traffic instance of the
    // problem in the codebase.
    //
    // Round-trips are unchanged: Prisma issued both statements anyway.
    const user = await dbAdmin.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        securityStamp: true,
        status: true,
        isPlatformAdmin: true,
        deletedAt: true,
        companyId: true,
        // Extra columns for /auth/me. They ride along in the SAME query, so
        // selecting them costs nothing — whereas re-querying them in the
        // handler cost 5 extra round-trips on the most-called endpoint.
        fullName: true,
        phoneNumber: true,
        avatarUrl: true,
        jobTitle: true,
        lastLoginAt: true,
      },
    });

    const companyRow = user
      ? await dbAdmin.user.findUnique({
          where: { id: payload.sub },
          select: {
            company: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                ownerId: true,
                // Onboarding state rides along here so /auth/me can report it
                // without a second query. It is one more column on a row this
                // request already fetches, not an extra round-trip.
                settings: { select: { onboardingCompletedAt: true, onboardingSkippedSteps: true } },
              },
            },
          },
        })
      : null;

    // Who is this caller? Decided here, BEFORE the roles query, because the
    // answer decides whether that query is needed at all.
    //
    // Owners and platform staff hold every permission implicitly — both
    // `resolvePermissions` (auth.service.ts) and the `granted` set below return
    // getAllPermissions() for them and never look at `roles`. Loading the
    // roles→role_permissions join for them was three tables of work whose
    // result was then discarded, on every single request from the account that
    // uses the app most.
    //
    // Non-owners still need it: their permissions ARE the union of their roles.
    const company = companyRow?.company ?? null;
    const holdsAllPermissions = !user ? false : Boolean(user.isPlatformAdmin || (company && company.ownerId === user.id));

    const rolesRow =
      user && !holdsAllPermissions
        ? await dbAdmin.user.findUnique({
            where: { id: payload.sub },
            select: { roles: { select: { role: { select: { permissions: { select: { permissionKey: true } } } } } } },
          })
        : null;

    const principalRow = user
      ? { ...user, company, roles: rolesRow?.roles ?? [] }
      : null;

    if (!principalRow || principalRow.deletedAt) {
      throw new UnauthorizedError("انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى.");
    }

    // A stamp mismatch means the password changed or sessions were revoked.
    if (principalRow.securityStamp !== payload.securityStamp) {
      throw new UnauthorizedError("انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى.");
    }

    if (principalRow.status !== "ACTIVE") {
      throw new UnauthorizedError("هذا الحساب معطل حالياً.");
    }

    // A suspended company is paused; a closed one is gone. Only ACTIVE may
    // reach the API. Checking just one of the two blocked states would let
    // the other through by omission.
    if (principalRow.company && (principalRow.company.status === "SUSPENDED" || principalRow.company.status === "CLOSED")) {
      throw new ForbiddenError(
        principalRow.company.status === "CLOSED"
          ? "تم إغلاق هذه الشركة، يرجى التواصل مع الدعم."
          : "تم تعليق الشركة، يرجى التواصل مع الدعم."
      );
    }

    const isCompanyOwner = principalRow.company ? principalRow.company.ownerId === principalRow.id : false;

    // Owners hold every permission implicitly. Platform staff do as well,
    // though their access to company data still requires switching context.
    //
    // `holdsAllPermissions` was computed above the roles query so that query
    // could be skipped for exactly these callers; recomputing it here would be
    // two sources of truth for one rule.
    const granted = holdsAllPermissions
      ? new Set(getAllPermissions())
      : new Set(principalRow.roles.flatMap((ur) => ur.role.permissions.map((p) => p.permissionKey)));

    const ctx: RequestContext = {
      companyId: principalRow.companyId,
      userId: principalRow.id,
      isPlatformAdmin: principalRow.isPlatformAdmin,
      isCompanyOwner,
      permissions: granted,
      sessionId: payload.sid,
    };

    req.ctx = ctx;
    // Keep the row we just loaded so /auth/me can build its Principal from it
    // instead of issuing the same five queries a second time. Same request,
    // same user, same data — re-reading it is pure waste.
    //
    // This must be `principalRow`, NOT `user`: `user` is only the scalar query,
    // and handing that over would silently drop company and roles from /auth/me.
    req.principalRow = principalRow;

    // Per-session throttle (per user, Redis-backed). Lives here rather than
    // as a separate layer so the router mount order — which routing.test.ts
    // pins down — never changes, and so the three self-authenticated auth
    // routes (me/logout/change-password) are covered too.
    if (!env.RATE_LIMIT_SESSION_DISABLED) {
      const decision = await checkLimit(
        `rl:session:${principalRow.id}`,
        env.RATE_LIMIT_SESSION_MAX,
        env.RATE_LIMIT_SESSION_WINDOW_MS
      );
      res.setHeader("RateLimit-Limit", env.RATE_LIMIT_SESSION_MAX);
      res.setHeader("RateLimit-Remaining", decision.remaining);
      if (decision.resetAt) {
        res.setHeader("RateLimit-Reset", Math.max(0, Math.ceil((decision.resetAt - Date.now()) / 1000)));
      }
      if (!decision.allowed) {
        res.status(429).json({
          success: false,
          message: "طلبات كثيرة جداً. انتظر دقيقة وحاول مجدداً.",
          data: null,
          code: "RATE_LIMITED",
        });
        return;
      }
    }

    next();
  } catch (err) {
    next(err);
  }
};
