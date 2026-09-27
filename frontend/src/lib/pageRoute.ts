import { createElement, type ReactElement } from "react";

import { usePageNavigate } from "./navigation";

type Navigate = (path: string) => void;

/**
 * Adapts a screen from `src/pages` to a route component.
 *
 * Every screen predates the router: it takes a `navigate(path)` callback as a
 * prop rather than importing the router, which is what let the same screen
 * render under the old manual `history.pushState` switch. Supplying that
 * callback from `usePageNavigate` is what lets the screens stay untouched
 * while navigation moves onto the router — a click travels the route tree and
 * runs the target route's `beforeLoad` guards instead of quietly rewriting the
 * URL behind the router's back, which is how a guarded screen used to be
 * reachable by simply typing its address.
 *
 * `extra` carries the screens' own props (`Payouts`' `section`,
 * `FulfillmentBatches`' `kind`) so those do not each need a hand-written route
 * component for what is a constant.
 */
export function asRoute<P extends { navigate: Navigate }>(
  screen: (props: P) => ReactElement | null,
  extra: Omit<P, "navigate"> = {} as Omit<P, "navigate">,
): () => ReactElement {
  return function RouteScreen() {
    const navigate = usePageNavigate();
    return createElement(screen, { ...extra, navigate } as P);
  };
}
