import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import ChangePassword from "../../pages/ChangePassword/ChangePassword";

export const Route = createFileRoute("/_app/change-password")({
  component: asRoute(ChangePassword),
});
