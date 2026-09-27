import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import CustomersManagement from "../../../pages/CustomersManagement/CustomersManagement";

export const Route = createFileRoute("/_app/dashboard/customers")({
  component: asRoute(CustomersManagement),
});
