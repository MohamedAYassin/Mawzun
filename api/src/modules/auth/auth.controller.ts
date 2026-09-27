import type { Response } from "express";
import type { AuthedRequest } from "../../shared/request.js";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "./refreshCookie.js";
import { UnauthorizedError } from "../../shared/errors.js";
import { env } from "../../config/env.js";
import {
  changePassword,
  loadImpersonatedBy,
  loadPrincipal,
  login,
  logout,
  refresh,
  revokeAllSessions,
  signup,
  toPrincipal,
  type AuthResult,
  type Principal,
} from "./auth.service.js";
import {
  ChangePasswordSchema,
  LoginSchema,
  LogoutSchema,
  RefreshSchema,
  SignupSchema,
} from "./auth.schemas.js";

function clientMeta(req: { headers: Record<string, unknown>; ip?: string }) {
  return {
    userAgent:
      typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    ipAddress: req.ip ?? undefined,
  };
}

/**
 * Controllers only translate transport into domain calls: parse the body, hand
 * it to the service, return the result. Every response envelope is produced by
 * the route wrapper, so the shapes cannot drift between endpoints.
 */
/**
 * Issue-and-set: stores the fresh refresh token as an HttpOnly cookie before
 * the envelope is written. The token still travels in the body for non-cookie
 * API clients; browsers are expected to ignore it.
 */
async function issueWithCookie(
  res: Response,
  promise: Promise<AuthResult>,
  rememberMinutes: number
): Promise<AuthResult> {
  const result = await promise;
  setRefreshCookie(res, result.tokens.refreshToken, rememberMinutes);
  return result;
}

export const authController = {
  signup(req: AuthedRequest, res: Response): Promise<AuthResult> {
    return issueWithCookie(
      res,
      signup(SignupSchema.parse(req.body), clientMeta(req)),
      env.JWT_REFRESH_MINUTES
    );
  },

  login(req: AuthedRequest, res: Response): Promise<AuthResult> {
    const { rememberMe } = LoginSchema.parse(req.body);
    return issueWithCookie(
      res,
      login(LoginSchema.parse(req.body), clientMeta(req)),
      rememberMe ? env.JWT_REFRESH_REMEMBER_MINUTES : env.JWT_REFRESH_MINUTES
    );
  },

  refresh(req: AuthedRequest, res: Response): Promise<AuthResult> {
    // `?? {}` because the body is genuinely optional: the credential normally
    // arrives as the HttpOnly cookie, and the most natural way to call this is
    // a bare POST with no body at all. Without it, `parse(undefined)` fails and
    // a body-less refresh is reported as a malformed request. logout() below
    // does the same thing.
    const bodyToken = RefreshSchema.parse(req.body ?? {}).refreshToken;
    const cookieToken = readRefreshCookie(req);
    const token = bodyToken ?? cookieToken ?? "";
    if (!token) {
      // 401, not 422: the request is well formed — there is simply no credential
      // on it (no cookie, no body token). 422 would report every ordinary
      // session expiry as a validation error, which is the wrong signal for
      // clients and for monitoring. A malformed *body* still fails earlier, in
      // RefreshSchema.parse above.
      throw new UnauthorizedError("توكن التحديث مطلوب.");
    }
    // The rotated token must replace the cookie, or the browser keeps sending
    // the revoked one and the next refresh logs the user out. Max age covers
    // the longest session; the server row (not the cookie) is the source of
    // truth for expiry.
    return issueWithCookie(
      res,
      refresh(token, clientMeta(req)),
      env.JWT_REFRESH_REMEMBER_MINUTES
    );
  },

  async logout(req: AuthedRequest, res: Response): Promise<null> {
    const body = LogoutSchema.parse(req.body ?? {});
    const cookieToken = readRefreshCookie(req);
    if (body.allSessions) {
      await revokeAllSessions(req.ctx.userId);
    } else {
      await logout(body.refreshToken ?? cookieToken ?? undefined, req.ctx.userId);
    }
    clearRefreshCookie(res);
    return null;
  },

  async me(req: AuthedRequest): Promise<Principal> {
    if (!req.ctx) throw new UnauthorizedError();
    // `authenticate` already loaded this exact row (same user, same request) and
    // stashed it on req.principalRow. Rebuilding the Principal from it avoids
    // re-querying user + company + roles + permissions — 5 round-trips that
    // would return data we are already holding.
    //
    // The session lookup is still needed: impersonatedBy is a property of the
    // SESSION, not the user, and authenticate does not read it. That is 1
    // round-trip instead of 6.
    if (req.principalRow) {
      const impersonatedBy = req.ctx.sessionId
        ? await loadImpersonatedBy(req.ctx.sessionId)
        : null;
      return toPrincipal(req.principalRow as never, impersonatedBy);
    }
    // Fallback for any caller that did not come through `authenticate`.
    return loadPrincipal(req.ctx.userId, req.ctx.sessionId);
  },

  changePassword(req: AuthedRequest): Promise<AuthResult> {
    return changePassword(req.ctx.userId, ChangePasswordSchema.parse(req.body), clientMeta(req));
  },
};
