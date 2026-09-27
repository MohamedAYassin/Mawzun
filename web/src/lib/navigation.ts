import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";

// Navigation for the page components.
//
// Every screen in `src/pages` takes a `navigate(path)` callback rather than
// importing the router, which is what let them work under the old manual
// `window.history.pushState` switch. Now that TanStack Router owns navigation,
// this module is the seam: the callback the pages receive is the router's own
// navigate, so a click goes through the route tree, matches a real route and
// runs that route's `beforeLoad` guards.
//
// It is deliberately *not* a shim over `history.pushState`. Going around the
// router would skip the guards, and the guards are the security boundary.

type PathQuery = Record<string, string>;

/**
 * Splits a legacy `"/dashboard/alerts?tab=deficits"` style path into the two
 * things the router wants separately.
 *
 * The router treats `to` as a route path, not a URL, so a query string glued
 * onto it would be matched literally and resolve to the not-found route.
 */
function splitPath(path: string): { to: string; search: PathQuery | undefined } {
  const [to, query] = path.split("?");
  if (!query) return { to: to || "/", search: undefined };
  return { to: to || "/", search: Object.fromEntries(new URLSearchParams(query)) };
}

/**
 * Returns a `navigate(path)` bound to the router.
 *
 * The cast on `to` is the one place where typing is relaxed, and it is relaxed
 * on purpose: callers pass paths built at runtime (a notification's `link`, a
 * saved filter, a deep link from another screen), which no static route union
 * can describe. If the path matches no route the router raises its not-found
 * route rather than silently rendering nothing.
 */
export function usePageNavigate(): (path: string) => void {
  const navigate = useNavigate();

  return useCallback(
    (path: string) => {
      // The app screens (login, register, dashboard...) live in the separate
      // frontend deployment. This home app only hosts the landing, so any
      // path it does not serve exits to the app origin.
      const APP_ORIGIN =
        (import.meta.env.VITE_APP_ORIGIN as string | undefined) ??
        (import.meta.env.DEV ? "http://localhost:8081" : "https://app.mawzun.org");
      if (/^\/(login|register|signup|forgot-password|dashboard)/.test(path)) {
        window.location.href = `${APP_ORIGIN}${path}`;
        return;
      }
      const { to, search } = splitPath(path);
      void navigate({ to: to as never, search: search as never, replace: false });
    },
    [navigate],
  );
}
