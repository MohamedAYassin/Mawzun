import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import SyncErrors from "../../../pages/SyncErrors/SyncErrors";

export const Route = createFileRoute("/_app/dashboard/sync-errors")({
  component: asRoute(SyncErrors),
});
