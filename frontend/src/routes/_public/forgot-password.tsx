import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import ForgotPassword from "../../pages/ForgotPassword/ForgotPassword";

export const Route = createFileRoute("/_public/forgot-password")({
  component: asRoute(ForgotPassword),
});
