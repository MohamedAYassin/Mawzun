import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

/**
 * The access token deliberately carries identity and nothing else.
 *
 * Permissions are NOT embedded: they are loaded from the database on every
 * request alongside the security-stamp check, so revoking a role takes effect
 * immediately rather than whenever the token happens to expire.
 */
export interface AccessTokenPayload {
  sub: string;
  sid: string;
  email: string;
  securityStamp: string;
  companyId: string | null;
  isPlatformAdmin: boolean;
}

export function signAccessToken(payload: AccessTokenPayload): { token: string; expiresAt: Date } {
  const minutes = env.JWT_ACCESS_MINUTES;
  const expiresAt = new Date(Date.now() + minutes * 60_000);

  const token = jwt.sign(
    {
      sub: payload.sub,
      sid: payload.sid,
      email: payload.email,
      securityStamp: payload.securityStamp,
      companyId: payload.companyId,
      isPlatformAdmin: payload.isPlatformAdmin,
    },
    env.JWT_KEY,
    {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      expiresIn: `${minutes}m`,
    }
  );

  return { token, expiresAt };
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_KEY, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  }) as jwt.JwtPayload;

  return {
    sub: String(decoded.sub ?? ""),
    sid: String(decoded.sid ?? ""),
    email: String(decoded.email ?? ""),
    securityStamp: String(decoded.securityStamp ?? ""),
    companyId: decoded.companyId == null ? null : String(decoded.companyId),
    isPlatformAdmin: decoded.isPlatformAdmin === true,
  };
}
