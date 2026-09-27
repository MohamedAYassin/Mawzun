import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import AppsManagement from "../../../pages/AppsManagement/AppsManagement";

export const Route = createFileRoute("/_app/dashboard/apps")({
  component: asRoute(AppsManagement),
});
