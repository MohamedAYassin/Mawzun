import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ConsignmentVendors from "../../../pages/ConsignmentVendors/ConsignmentVendors";

export const Route = createFileRoute("/_app/dashboard/consignment-vendors")({
  component: asRoute(ConsignmentVendors),
});
