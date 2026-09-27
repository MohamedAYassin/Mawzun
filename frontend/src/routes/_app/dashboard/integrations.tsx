import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import Integrations from "../../../pages/Integrations/Integrations";

export const Route = createFileRoute("/_app/dashboard/integrations")({
  component: asRoute(Integrations),
});
