import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import PaymentMethodsManagement from "../../../pages/PaymentMethodsManagement/PaymentMethodsManagement";

export const Route = createFileRoute("/_app/dashboard/payment-methods")({
  component: asRoute(PaymentMethodsManagement),
});
