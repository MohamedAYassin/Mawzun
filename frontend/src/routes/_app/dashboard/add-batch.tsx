import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import AddBatch from "../../../pages/AddBatch/AddBatch";

export const Route = createFileRoute("/_app/dashboard/add-batch")({
  component: asRoute(AddBatch),
});
