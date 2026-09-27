import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import StoresManagement from "../../../pages/StoresManagement/StoresManagement";

export const Route = createFileRoute("/_app/dashboard/stores")({
  component: asRoute(StoresManagement),
});
