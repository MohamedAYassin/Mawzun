import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import PurchaseOrders from "../../../pages/PurchaseOrders/PurchaseOrders";

export const Route = createFileRoute("/_app/dashboard/purchase-orders")({
  component: asRoute(PurchaseOrders),
});
