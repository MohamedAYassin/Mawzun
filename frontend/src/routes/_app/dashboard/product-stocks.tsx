import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ProductStocks from "../../../pages/ProductStocks/ProductStocks";

export const Route = createFileRoute("/_app/dashboard/product-stocks")({
  component: asRoute(ProductStocks),
});
