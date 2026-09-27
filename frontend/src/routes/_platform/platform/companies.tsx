import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import PlatformCompanies from "../../../pages/PlatformCompanies/PlatformCompanies";

export const Route = createFileRoute("/_platform/platform/companies")({
  component: asRoute(PlatformCompanies),
});
