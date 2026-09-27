import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { session } from "../../lib/api";

// Routes anyone may reach: the marketing page and the three screens that start
// or recover a session.
//
// The underscore prefix makes this a *pathless* layout — it contributes no URL
// segment, only the guard everything under it inherits.
export const Route = createFileRoute("/_public")({
  // Signed-out visitors only. A logged-in user landing on /login is already
  // past it, and letting them through would show a form whose submit would
  // silently create a second session.
  beforeLoad: () => {
    if (typeof window !== "undefined" && session.isAuthenticated && !window.location.pathname.startsWith("/impersonation")) {
      throw redirect({ to: "/dashboard/sales-overview", replace: true });
    }
  },
  component: PublicLayout,
});

function PublicLayout() {
  return <Outlet />;
}
