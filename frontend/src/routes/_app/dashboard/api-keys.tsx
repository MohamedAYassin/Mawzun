import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import ApiKeysManagement from "../../../pages/ApiKeysManagement/ApiKeysManagement";

export const Route = createFileRoute("/_app/dashboard/api-keys")({
  component: asRoute(ApiKeysManagement),
});
