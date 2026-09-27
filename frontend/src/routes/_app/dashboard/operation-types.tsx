import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import OperationsManagement from "../../../pages/OperationsManagement/OperationsManagement";

export const Route = createFileRoute("/_app/dashboard/operation-types")({
  component: asRoute(OperationsManagement),
});
