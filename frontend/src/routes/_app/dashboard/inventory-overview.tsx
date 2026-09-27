import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import InventoryOverview from "../../../pages/InventoryOverview/InventoryOverview";

export const Route = createFileRoute("/_app/dashboard/inventory-overview")({
  component: asRoute(InventoryOverview),
});
