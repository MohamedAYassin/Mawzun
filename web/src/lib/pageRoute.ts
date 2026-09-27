import { createElement, type ReactElement } from "react";

import { usePageNavigate } from "./navigation";

type Navigate = (path: string) => void;

/**
 * Adapts a screen from `src/pages` to a route component.
 *
 * Every screen takes a `navigate(path)` callback as a prop rather than
 * importing the router. Supplying that callback from `usePageNavigate` keeps
 * the screens router-agnostic — a click travels the route tree and exits to
 * the frontend origin for paths this deployment does not serve.
 */
export function asRoute<P extends { navigate: Navigate }>(
  screen: (props: P) => ReactElement | null,
): () => ReactElement {
  return function RouteScreen() {
    const navigate = usePageNavigate();
    return createElement(screen, { navigate } as P);
  };
}
