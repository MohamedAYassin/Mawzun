import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ProductsManagement from "../../../pages/ProductsManagement/ProductsManagement";

export const Route = createFileRoute("/_app/dashboard/products")({
  component: asRoute(ProductsManagement),
});
