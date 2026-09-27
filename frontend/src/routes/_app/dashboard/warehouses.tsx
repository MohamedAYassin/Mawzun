import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import WarehousesManagement from "../../../pages/WarehousesManagement/WarehousesManagement";

export const Route = createFileRoute("/_app/dashboard/warehouses")({
  component: asRoute(WarehousesManagement),
});
