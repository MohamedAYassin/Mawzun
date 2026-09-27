import { createFileRoute, redirect } from "@tanstack/react-router";

import { mergedRedirectTarget } from "../../../components/DashboardLayout/navConfig";

// An old single-purpose address. The screen it used to open is now a tab of a
// merged screen, so the address still resolves — it just lands on the right
// tab of the screen that took its place.
export const Route = createFileRoute("/_app/dashboard/low-stock")({
  beforeLoad: () => {
    throw redirect({ ...mergedRedirectTarget("/dashboard/low-stock"), replace: true });
  },
});
