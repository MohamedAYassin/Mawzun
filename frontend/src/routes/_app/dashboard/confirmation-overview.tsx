import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ConfirmationOverview from "../../../pages/ConfirmationOverview/ConfirmationOverview";

export const Route = createFileRoute("/_app/dashboard/confirmation-overview")({
  component: asRoute(ConfirmationOverview),
});
