import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ProductionPage from "../../../pages/Production/Production";

export const Route = createFileRoute("/_app/dashboard/production")({
  component: asRoute(ProductionPage),
});
