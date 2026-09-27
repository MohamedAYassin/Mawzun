import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import SystemSettings from "../../pages/SystemSettings/SystemSettings";

export const Route = createFileRoute("/_app/system-settings")({
  component: asRoute(SystemSettings),
});
