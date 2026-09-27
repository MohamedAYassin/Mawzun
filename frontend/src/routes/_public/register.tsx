import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import Register from "../../pages/Register/Register";

export const Route = createFileRoute("/_public/register")({
  component: asRoute(Register),
});
