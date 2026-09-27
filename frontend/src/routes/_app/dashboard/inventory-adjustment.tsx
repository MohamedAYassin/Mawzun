import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import InventoryAdjustment from "../../../pages/InventoryAdjustment/InventoryAdjustment";

export const Route = createFileRoute("/_app/dashboard/inventory-adjustment")({
  component: asRoute(InventoryAdjustment),
});
