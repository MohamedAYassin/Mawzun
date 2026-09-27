import { resolveActive, normalizePath } from "./navConfig";
import { usePathname } from "../../lib/navigation";
import { useScrollEdges } from "../../hooks/useScrollEdges";
import "./ModuleTabs.css";

interface ModuleTabsProps {
  navigate: (path: string) => void;
  onOpenCommand: () => void;
}

/**
 * Secondary navigation: shows every screen inside the active module as a tab,
 * so related screens (alerts, returns, lookups...) read as one destination.
 */
function ModuleTabs({ navigate, onOpenCommand }: ModuleTabsProps) {
  const currentPath = normalizePath(usePathname());
  const { module, item } = resolveActive(currentPath);
  const { ref, overflowStart, overflowEnd } = useScrollEdges<HTMLElement>(module?.id);

  if (!module) return null;

  return (
    <div className="module-tabs">
      <div className="module-tabs-heading">
        <span className="module-tabs-icon">{module.icon}</span>
        <span className="module-tabs-title">{module.label}</span>
      </div>

      <div
        className={`module-tabs-scroll${overflowStart ? " overflow-start" : ""}${
          overflowEnd ? " overflow-end" : ""
        }`}
      >
        <nav ref={ref} className="module-tabs-list" aria-label={module.label}>
          {module.items.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className={`module-tab ${item?.path === entry.path ? "active" : ""}`}
              onClick={() => navigate(entry.path)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
      </div>

      <button type="button" className="module-tabs-search" onClick={onOpenCommand}>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span>بحث سريع</span>
        <kbd>Ctrl K</kbd>
      </button>
    </div>
  );
}

export default ModuleTabs;
