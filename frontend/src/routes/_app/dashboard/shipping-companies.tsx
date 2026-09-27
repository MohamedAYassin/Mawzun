import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ShippingCompaniesManagement from "../../../pages/ShippingCompaniesManagement/ShippingCompaniesManagement";

export const Route = createFileRoute("/_app/dashboard/shipping-companies")({
  component: asRoute(ShippingCompaniesManagement),
});
