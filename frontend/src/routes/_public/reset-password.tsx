import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import ResetPassword from "../../pages/ResetPassword/ResetPassword";

export const Route = createFileRoute("/_public/reset-password")({
  component: asRoute(ResetPassword),
});
