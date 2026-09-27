import type { RequestContext } from "../../src/config/companyContext.js";
import type { AuthedRequest } from "../../src/shared/request.js";
import { getAllPermissions } from "../../src/constants/permissions.js";

/**
 * Builds the minimum object a service needs.
 *
 * Services take an `AuthedRequest`, but they only ever read `req.ctx` from it
 * (through `scoped()`). Faking an Express request here would mean faking
 * sockets, headers and a response object for no benefit, so this casts a
 * context-only object instead. If a service ever reaches for another property
 * the compiler will not catch it — the tests will, because the property will be
 * undefined.
 */
export function asRequest(ctx: RequestContext): AuthedRequest {
  return { ctx } as AuthedRequest;
}

export interface CtxOptions {
  companyId: string | null;
  userId: string;
  isPlatformAdmin?: boolean;
  isCompanyOwner?: boolean;
  permissions?: string[];
}

export function makeContext(opts: CtxOptions): RequestContext {
  return {
    companyId: opts.companyId,
    userId: opts.userId,
    isPlatformAdmin: opts.isPlatformAdmin ?? false,
    isCompanyOwner: opts.isCompanyOwner ?? false,
    permissions: new Set(opts.permissions ?? getAllPermissions()),
  };
}

/**
 * A caller with no company at all — what a platform administrator looks like.
 *
 * This is the shape that used to slip through `requirePermission` and reach
 * company-scoped services with a null companyId.
 */
export function platformContext(userId: string): RequestContext {
  return {
    companyId: null,
    userId,
    isPlatformAdmin: true,
    isCompanyOwner: false,
    permissions: new Set(getAllPermissions()),
  };
}
