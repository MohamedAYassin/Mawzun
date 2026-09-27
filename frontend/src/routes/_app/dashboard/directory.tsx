import { createFileRoute } from "@tanstack/react-router";

import { asRoute } from "../../../lib/pageRoute";
import BrandsManagement from "../../../pages/BrandsManagement/BrandsManagement";
import CategoriesManagement from "../../../pages/CategoriesManagement/CategoriesManagement";
import CitiesManagement from "../../../pages/CitiesManagement/CitiesManagement";
import GovernoratesManagement from "../../../pages/GovernoratesManagement/GovernoratesManagement";
import ReasonsManagement from "../../../pages/ReasonsManagement/ReasonsManagement";
import UomManagement from "../../../pages/UomManagement/UomManagement";

/**
 * Reference data: the small lookup lists every other screen reads from.
 *
 * Six of them used to be six top-level screens in the sidebar. Grouped here
 * they take one sidebar entry and one address instead of six.
 */
const TABS = {
  brands: asRoute(BrandsManagement),
  categories: asRoute(CategoriesManagement),
  uom: asRoute(UomManagement),
  reasons: asRoute(ReasonsManagement),
  governorates: asRoute(GovernoratesManagement),
  cities: asRoute(CitiesManagement),
} as const;

type DirectoryTab = keyof typeof TABS;

export const Route = createFileRoute("/_app/dashboard/directory")({
  validateSearch: (search: Record<string, unknown>): { tab: DirectoryTab } => {
    const tab = typeof search.tab === "string" ? search.tab : "brands";
    return { tab: tab in TABS ? (tab as DirectoryTab) : "brands" };
  },
  component: function DirectoryRoute() {
    const { tab } = Route.useSearch();
    const Screen = TABS[tab];
    return <Screen />;
  },
});
