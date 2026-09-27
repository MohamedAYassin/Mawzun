import type { Response } from "express";
import { randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Refresh-token cookie
// ---------------------------------------------------------------------------
//
// The refresh token is a long-lived credential, so it is delivered as a
// cookie with both protective flags set unconditionally:
//
//   HttpOnly — JavaScript (and therefore any XSS) cannot READ the cookie, only
//              the browser presents it automatically on requests.
//   Secure   — the browser only ever sends it over HTTPS; it is dropped on
//              plain HTTP. localhost counts as a trustworthy origin in every
//              modern browser, so local development over http:// still works.
//
// SameSite=Lax plus the auth-scoped path keep the cookie first-party and
// off every other request the app makes.

export const REFRESH_COOKIE = "mawzun_rt";

const COOKIE_BASE = {
  httpOnly: true,
  secure: true,
  // Production is cross-origin (app.* calls api.*), so Lax would accept the
  // cookie on login but never send it back on the fetch POST to
  // /auth/refresh — every session would die with the short access token and
  // bounce to /login. None requires Secure, already set. Local dev relays
  // through the frontend's same-origin proxy, so Lax is correct there.
  sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  // Production serves the API on its own origin, so the auth-scoped path keeps
  // the cookie off every other request. Local dev relays through the
  // frontend's same-origin proxy (a different path prefix), so the cookie
  // needs the root path there or the browser never sends it back.
  path: env.NODE_ENV === "production" ? "/api/v1/auth" : "/",
} as const;

/** Random value used when the caller has no real token to store (logout). */
export function emptyCookieValue(): string {
  return randomBytes(8).toString("hex");
}

export function setRefreshCookie(res: Response, token: string, maxAgeMinutes: number): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...COOKIE_BASE,
    maxAge: maxAgeMinutes * 60_000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.cookie(REFRESH_COOKIE, emptyCookieValue(), {
    ...COOKIE_BASE,
    maxAge: 0,
  });
}

/** Reads our cookie from the raw Cookie header (no cookie-parser dependency). */
export function readRefreshCookie(req: { headers: Record<string, unknown> }): string | null {
  const header = req.headers.cookie;
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === REFRESH_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
