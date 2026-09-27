import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import AddSale from "../../../pages/AddSale/AddSale";

export const Route = createFileRoute("/_app/dashboard/add-sale")({
  component: asRoute(AddSale),
});
