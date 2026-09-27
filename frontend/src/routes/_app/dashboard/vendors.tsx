import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import VendorsManagement from "../../../pages/VendorsManagement/VendorsManagement";

export const Route = createFileRoute("/_app/dashboard/vendors")({
  component: asRoute(VendorsManagement),
});
