import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { session } from "../../lib/api";
import { SessionGate } from "../../components/guards/SessionGate";

// Every company-facing screen.
//
// Two guards, at the two places they can be enforced:
//
//   `beforeLoad` runs before the route's component is created, so a visitor
//   with no token pair never renders the dashboard shell — not even for the
//   frame it would take to discover they are signed out. It is synchronous
//   because there is nothing to wait for: either the pair is in storage or it
//   is not.
//
//   `SessionGate` is the part that needs the network. A token pair can be
//   present and dead, and a company can be suspended or closed between
//   requests; only the server knows, so the component waits for `/auth/me`
//   and shows the server's own answer when it refuses.
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ location }) => {
    if (typeof window !== "undefined" && !session.isAuthenticated) {
      throw redirect({
        to: "/login",
        replace: true,
        // Where they were going, so a deep link survives the detour through
        // the login screen instead of dumping them on the landing page.
        search: { redirect: location.href },
      });
    }
  },
  component: AppLayout,
});

function AppLayout() {
  return (
    <SessionGate>
      <Outlet />
    </SessionGate>
  );
}
