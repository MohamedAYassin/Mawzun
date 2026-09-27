import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ExchangeRequests from "../../../pages/ExchangeRequests/ExchangeRequests";
import ReturnRequests from "../../../pages/ReturnRequests/ReturnRequests";
import ShippingReturns from "../../../pages/ShippingReturns/ShippingReturns";

/**
 * Everything coming back: the shipments arriving, the return requests raised
 * against them, and the exchanges that replace them.
 */
const TABS = {
  shipments: asRoute(ShippingReturns),
  requests: asRoute(ReturnRequests),
  exchanges: asRoute(ExchangeRequests),
} as const;

type ReturnsTab = keyof typeof TABS;

export const Route = createFileRoute("/_app/dashboard/returns")({
  validateSearch: (search: Record<string, unknown>): { tab: ReturnsTab } => {
    const tab = typeof search.tab === "string" ? search.tab : "shipments";
    return { tab: tab in TABS ? (tab as ReturnsTab) : "shipments" };
  },
  component: function ReturnsRoute() {
    const { tab } = Route.useSearch();
    const Screen = TABS[tab];
    return <Screen />;
  },
});
