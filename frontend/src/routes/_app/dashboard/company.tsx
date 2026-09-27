import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import CompanyProfile from "../../../pages/CompanyProfile/CompanyProfile";

export const Route = createFileRoute("/_app/dashboard/company")({
  component: asRoute(CompanyProfile),
});
