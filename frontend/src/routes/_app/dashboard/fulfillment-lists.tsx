import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import FulfillmentBatches from "../../../pages/FulfillmentBatches/FulfillmentBatches";

/**
 * Picking and packing lists.
 *
 * They were two addresses rendering two copies of the same component; the only
 * difference is which batch type the screen filters on, so it is now one screen
 * with a tab.
 */
const TABS = {
  picking: asRoute(FulfillmentBatches, { kind: "picking" as const }),
  packing: asRoute(FulfillmentBatches, { kind: "packing" as const }),
} as const;

type FulfillmentTab = keyof typeof TABS;

export const Route = createFileRoute("/_app/dashboard/fulfillment-lists")({
  validateSearch: (search: Record<string, unknown>): { tab: FulfillmentTab } => {
    const tab = typeof search.tab === "string" ? search.tab : "picking";
    return { tab: tab in TABS ? (tab as FulfillmentTab) : "picking" };
  },
  component: function FulfillmentListsRoute() {
    const { tab } = Route.useSearch();
    const Screen = TABS[tab];
    return <Screen />;
  },
});
