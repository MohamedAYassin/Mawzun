import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import AddProduct from "../../../pages/AddProduct/AddProduct";

export const Route = createFileRoute("/_app/dashboard/add-product")({
  component: asRoute(AddProduct),
});
