import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import AccountingOverview from "../../../pages/AccountingOverview/AccountingOverview";

export const Route = createFileRoute("/_app/dashboard/accounting-overview")({
  component: asRoute(AccountingOverview),
});
