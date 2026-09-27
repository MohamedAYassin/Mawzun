import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import CouponsManagement from "../../../pages/CouponsManagement/CouponsManagement";

export const Route = createFileRoute("/_app/dashboard/coupons")({
  component: asRoute(CouponsManagement),
});
