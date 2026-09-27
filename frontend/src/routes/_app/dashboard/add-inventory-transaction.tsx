import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import NewInventoryTransaction from "../../../pages/NewInventoryTransaction/NewInventoryTransaction";

export const Route = createFileRoute("/_app/dashboard/add-inventory-transaction")({
  component: asRoute(NewInventoryTransaction),
});
