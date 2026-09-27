import { pageTabGroups, normalizePath } from "./navConfig";
import { useLocationPath } from "../../lib/navigation";
import "./PageTabs.css";

interface PageTabsProps {
  navigate: (path: string) => void;
}

/**
 * Second-level tabs for merged screens (stock alerts, fulfillment lists,
 * returns, reference data, access control). The active tab lives in `?tab=`.
 *
 * Both the path and the tab are read from the router. Switching a tab is a
 * navigation, so `window.location` would be the wrong source even though it
 * happens to be up to date: it does not notify React, and the tab would stay
 * where it was until something else re-rendered this component.
 */
function PageTabs({ navigate }: PageTabsProps) {
  const [path, query] = useLocationPath().split("?");
  const current = normalizePath(path || "/");
  const tabs = pageTabGroups[current];
  if (!tabs || tabs.length === 0) return null;

  const active = new URLSearchParams(query ?? "").get("tab") || tabs[0]!.key;

  return (
    <div className="page-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={`page-tab ${active === tab.key ? "active" : ""}`}
          onClick={() => navigate(`${current}?tab=${tab.key}`)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default PageTabs;
