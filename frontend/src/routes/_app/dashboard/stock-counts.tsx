import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import StockCounts from "../../../pages/StockCounts/StockCounts";

export const Route = createFileRoute("/_app/dashboard/stock-counts")({
  component: asRoute(StockCounts),
});
