import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import InventoryTransactions from "../../../pages/InventoryTransactions/InventoryTransactions";

export const Route = createFileRoute("/_app/dashboard/inventory-transactions")({
  component: asRoute(InventoryTransactions),
});
