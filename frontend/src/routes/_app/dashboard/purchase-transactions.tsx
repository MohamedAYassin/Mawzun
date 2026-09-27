import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import PurchaseTransactions from "../../../pages/PurchaseTransactions/PurchaseTransactions";

export const Route = createFileRoute("/_app/dashboard/purchase-transactions")({
  component: asRoute(PurchaseTransactions),
});
