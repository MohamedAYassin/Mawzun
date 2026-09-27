import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import DeficitsAlert from "../../../pages/DeficitsAlert/DeficitsAlert";
import LowStock from "../../../pages/LowStock/LowStock";

/**
 * Stock alerts: one screen, two tabs.
 *
 * Low stock and deficits used to be separate addresses with separate screens;
 * they are two views of the same question — what is about to run out — so they
 * share a page and the `?tab=` query string picks which one is showing.
 */
const TABS = {
  "low-stock": asRoute(LowStock),
  deficits: asRoute(DeficitsAlert),
} as const;

type AlertsTab = keyof typeof TABS;

export const Route = createFileRoute("/_app/dashboard/alerts")({
  validateSearch: (search: Record<string, unknown>): { tab: AlertsTab } => {
    const tab = typeof search.tab === "string" ? search.tab : "low-stock";
    return { tab: tab in TABS ? (tab as AlertsTab) : "low-stock" };
  },
  component: function AlertsRoute() {
    const { tab } = Route.useSearch();
    const Screen = TABS[tab];
    return <Screen />;
  },
});
