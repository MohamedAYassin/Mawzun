// Session identity: the events that tell the app the cache is stale, and the
// comparison that decides when to fire them.
//
// WHY THIS IS ITS OWN MODULE
//
// It lives apart from `http.ts` so it can be imported and tested directly.
// `http.ts` reads `import.meta.env` at module scope, which only exists inside a
// Vite bundle — so anything defined there is unreachable from a plain Node
// check, and the check ends up re-implementing the logic it means to verify.
// That is the failure mode this split avoids: `verify-session-cache.mjs`
// imports these functions, so changing them changes the test result.

/** Fired when the session ends. The app clears the cache and redirects. */
export const SESSION_EXPIRED_EVENT = "mawzun:session-expired";

/**
 * Fired when the session changes hands — a different person is now signed in.
 *
 * Distinct from `session-expired` because the app must NOT redirect: the user
 * just logged in successfully. Only the cached data is stale.
 */
export const SESSION_CHANGED_EVENT = "mawzun:session-changed";

/** Tells the app the session is gone so it can send the user to login. */
export function announceSessionExpired(): void {
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

/** Tells the app the identity changed, so cached data must be dropped. */
export function announceSessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

/**
 * The `sub` claim of a JWT, or null if it cannot be read.
 *
 * Deliberately does NOT verify the signature. This is used only to notice that
 * a *different* token arrived, never to make a trust decision — the server
 * verifies the signature on every request. A forged token would at worst cause
 * a cache clear, which is harmless.
 */
export function subjectOf(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // base64url -> base64, then decode. `atob` exists in browsers and Node 16+;
    // this only ever runs from a token write, which is client-side.
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as { sub?: unknown };
    return typeof parsed.sub === "string" ? parsed.sub : null;
  } catch {
    return null;
  }
}

/**
 * Whether replacing `previous` with `next` means a different person is signed
 * in.
 *
 * Returns false when either side is unreadable: an unparseable token is not
 * evidence of a change, and treating it as one would clear the cache on every
 * refresh for no reason. A refresh of the same user keeps the same `sub`, so
 * this correctly stays false and the cache is preserved.
 */
export function identityChanged(previous: string | null, next: string | null): boolean {
  const before = subjectOf(previous);
  const after = subjectOf(next);
  if (before === null || after === null) return false;
  return before !== after;
}
