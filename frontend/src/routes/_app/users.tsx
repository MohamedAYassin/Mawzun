import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import Users from "../../pages/Users/Users";

export const Route = createFileRoute("/_app/users")({
  component: asRoute(Users),
});
