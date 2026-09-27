import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import InventoryTransfers from "../../../pages/InventoryTransfers/InventoryTransfers";

export const Route = createFileRoute("/_app/dashboard/inventory-transfers")({
  component: asRoute(InventoryTransfers),
});
