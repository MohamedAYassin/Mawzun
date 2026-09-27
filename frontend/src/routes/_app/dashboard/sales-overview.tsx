import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import SalesOverview from "../../../pages/SalesOverview/SalesOverview";

export const Route = createFileRoute("/_app/dashboard/sales-overview")({
  component: asRoute(SalesOverview),
});
