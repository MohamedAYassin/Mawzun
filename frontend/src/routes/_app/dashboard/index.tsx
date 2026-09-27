import { createFileRoute, redirect } from "@tanstack/react-router";

// `/dashboard` names the section, not a screen. The sales overview is where
// the dashboard starts.
export const Route = createFileRoute("/_app/dashboard/")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/sales-overview", replace: true });
  },
});
