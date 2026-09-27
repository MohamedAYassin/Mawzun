import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ShippingOverview from "../../../pages/ShippingOverview/ShippingOverview";

export const Route = createFileRoute("/_app/dashboard/shipping-overview")({
  component: asRoute(ShippingOverview),
});
