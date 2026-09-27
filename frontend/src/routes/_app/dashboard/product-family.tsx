import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ProductFamily from "../../../pages/ProductFamily/ProductFamily";

export const Route = createFileRoute("/_app/dashboard/product-family")({
  component: asRoute(ProductFamily),
});
