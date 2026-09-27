import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../../lib/pageRoute";
import Reports from "../../../../pages/Reports/Reports";

export const Route = createFileRoute("/_app/dashboard/reports/locations")({
  component: asRoute(Reports),
});
