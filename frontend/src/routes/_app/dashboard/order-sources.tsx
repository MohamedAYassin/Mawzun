import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import OrderSourcesManagement from "../../../pages/OrderSourcesManagement/OrderSourcesManagement";

export const Route = createFileRoute("/_app/dashboard/order-sources")({
  component: asRoute(OrderSourcesManagement),
});
