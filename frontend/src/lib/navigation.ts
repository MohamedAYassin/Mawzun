import { useCallback } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

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
      const { to, search } = splitPath(path);
      void navigate({ to: to as never, search: search as never, replace: false });
    },
    [navigate],
  );
}

/**
 * The current path, without the origin.
 *
 * Replaces `window.location.pathname`, which does not notify React: a
 * component that read it during render kept the value from its first render
 * after a client-side navigation.
 */
export function usePathname(): string {
  return useRouterState({ select: (state) => state.location.pathname });
}

/** The current path plus query string, in the `"/a?b=c"` form callers expect. */
export function useLocationPath(): string {
  return useRouterState({
    select: (state) => {
      const query = state.location.searchStr.replace(/^\?/, "");
      return query ? `${state.location.pathname}?${query}` : state.location.pathname;
    },
  });
}
