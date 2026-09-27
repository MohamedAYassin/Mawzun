import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import StorageLocations from "../../../pages/StorageLocations/StorageLocations";

export const Route = createFileRoute("/_app/dashboard/storage-locations")({
  component: asRoute(StorageLocations),
});
