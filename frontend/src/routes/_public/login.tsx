import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import Login from "../../pages/Login/Login";

export const Route = createFileRoute("/_public/login")({
  component: asRoute(Login),
});
