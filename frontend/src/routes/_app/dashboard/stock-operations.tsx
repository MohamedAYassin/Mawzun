import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import OperationsManagement from "../../../pages/OperationsManagement/OperationsManagement";

export const Route = createFileRoute("/_app/dashboard/stock-operations")({
  component: asRoute(OperationsManagement),
});
