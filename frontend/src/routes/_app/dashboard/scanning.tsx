import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import Scanning from "../../../pages/Scanning/Scanning";

export const Route = createFileRoute("/_app/dashboard/scanning")({
  component: asRoute(Scanning),
});
