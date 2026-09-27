import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import OrdersTransactions from "../../../pages/OrdersTransactions/OrdersTransactions";

export const Route = createFileRoute("/_app/dashboard/orders-transactions")({
  component: asRoute(OrdersTransactions),
});
