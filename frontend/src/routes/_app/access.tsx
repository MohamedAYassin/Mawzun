import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../lib/pageRoute";
import PermissionsPage from "../../pages/Permissions/Permissions";
import Roles from "../../pages/Roles/Roles";

/**
 * Who may do what: the roles a company defines, and the permissions the
 * backend resolves from them on every request.
 */
const TABS = {
  roles: asRoute(Roles),
  permissions: asRoute(PermissionsPage),
} as const;

type AccessTab = keyof typeof TABS;

export const Route = createFileRoute("/_app/access")({
  validateSearch: (search: Record<string, unknown>): { tab: AccessTab } => {
    const tab = typeof search.tab === "string" ? search.tab : "roles";
    return { tab: tab in TABS ? (tab as AccessTab) : "roles" };
  },
  component: function AccessRoute() {
    const { tab } = Route.useSearch();
    const Screen = TABS[tab];
    return <Screen />;
  },
});
