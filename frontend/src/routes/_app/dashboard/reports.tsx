import { createFileRoute, Outlet, useMatchRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import Reports from "../../../pages/Reports/Reports";

// reports/stock and reports/locations nest under this route, so this file is a
// layout. Without the exact-match check the parent rendered Reports for every
// child path too, which made the two child routes dead code — the URLs worked
// only because Reports derives its tab from the pathname.
//
// The screen component is built ONCE at module level: calling a hook-bearing
// factory during render is a hooks-order violation (the same bug that made the
// invoice page need a retry).
const ReportsScreen = asRoute(Reports);

export const Route = createFileRoute("/_app/dashboard/reports")({
  component: function ReportsLayout() {
    const matchRoute = useMatchRoute();
    const isExact = matchRoute({ to: "/dashboard/reports", fuzzy: false });
    if (!isExact) return <Outlet />;
    return <ReportsScreen />;
  },
});
