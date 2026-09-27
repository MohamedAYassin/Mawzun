import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import SupplierOverview from "../../../pages/SupplierOverview/SupplierOverview";

export const Route = createFileRoute("/_app/dashboard/supplier-overview")({
  component: asRoute(SupplierOverview),
});
