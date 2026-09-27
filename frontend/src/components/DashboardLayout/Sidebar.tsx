import { useState, useRef, useEffect } from "react";
import { ChevronLeftIcon, LogOutIcon } from "./SidebarIcons";
import { navModules, resolveActive, normalizePath, type NavModule } from "./navConfig";
import { usePathname } from "../../lib/navigation";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import "./Sidebar.css";

interface SidebarProps {
  navigate: (path: string) => void;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
}

function Sidebar({ navigate, onLogout, isOpen, onClose, isCollapsed }: SidebarProps) {
  // The path comes from the router rather than `window.location`. History
  // updates the address bar but tells React nothing, so a component that read
  // `location` during render kept the value from its first render and
  // highlighted the wrong entry after a client-side navigation.
  const currentPath = normalizePath(usePathname());
  const { module: activeModule, item: activeItem } = resolveActive(currentPath);

  // Hide modules the caller has no permission for — the backend already
  // enforces every route, so this only removes dead sidebar entries.
  const { hasPermission, isReady } = useCurrentUser();
  const visibleModules = navModules.filter(
    (mod: NavModule) => !mod.permission || (isReady && hasPermission(mod.permission))
  );

  const [openModule, setOpenModule] = useState<string | null>(activeModule?.id ?? "home");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Identity comes from the server principal, not localStorage. The sidebar
  // was still reading the pre-refactor "fullName"/"email" keys, which nothing
  // writes anymore, so every user saw the fallback "مسؤول النظام" instead of
  // their own name — the same class of bug TopBar was already fixed for.
  const { principal } = useCurrentUser();
  const fullName = principal?.user.fullName || "";
  const email = principal?.user.email || "";

  useEffect(() => {
    if (activeModule) setOpenModule(activeModule.id);
  }, [activeModule]);

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
    }
    return parts[0] ? parts[0].substring(0, 2).toUpperCase() : "US";
  };

  const initials = getInitials(fullName);

  // The avatar is whatever the principal says it is; there is no separate
  // "profile picture" endpoint in the current contract, so there is nothing to
  // keep in sync and no event to listen for.
  const avatarUrl = principal?.user.avatarUrl ?? "";

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleItemClick = (path: string) => {
    navigate(path);
    onClose();
  };

  return (
    <>
      {isOpen && <div id="sidebar-backdrop" className="sidebar-backdrop" onClick={onClose} />}

      <aside
        className={`sidebar ${isOpen ? "sidebar-open" : ""} ${isCollapsed ? "sidebar-collapsed" : ""}`}
      >
        <div className="sidebar-header">
          <img src="/logo_scale.svg" alt="" className="sidebar-mark" width={22} height={22} />
          {!isCollapsed && (
            <img src="/mawzun_black.svg" alt="mawzun" className="sidebar-logo brand-wordmark" />
          )}
        </div>

        <nav className="sidebar-content" aria-label="القائمة الرئيسية">
          {visibleModules.map((mod) => {
            const isActiveModule = activeModule?.id === mod.id;
            const expanded = !isCollapsed && openModule === mod.id;

            return (
              <div key={mod.id} className={`nav-module ${isActiveModule ? "is-active" : ""}`}>
                <button
                  id={`sidebar-module-${mod.id}`}
                  type="button"
                  className={`nav-module-trigger ${isActiveModule ? "active" : ""}`}
                  title={isCollapsed ? mod.label : undefined}
                  onClick={() => {
                    if (isCollapsed) {
                      const first = mod.items[0];
                      if (first) handleItemClick(first.path);
                      return;
                    }
                    setOpenModule((current) => (current === mod.id ? null : mod.id));
                  }}
                  aria-expanded={expanded}
                >
                  <span className="nav-module-icon">{mod.icon}</span>
                  {!isCollapsed && (
                    <>
                      <span className="nav-module-label">{mod.label}</span>
                      <ChevronLeftIcon className={`sidebar-chevron ${expanded ? "open" : ""}`} />
                    </>
                  )}
                </button>

                {expanded && (
                  <ul className="nav-sublist">
                    {mod.items.map((item) => (
                      <li key={item.path}>
                        <button
                          id={`sidebar-menu-item-${item.path.split("/").filter(Boolean).pop()}`}
                          type="button"
                          className={`nav-subitem ${activeItem?.path === item.path ? "active" : ""}`}
                          onClick={() => handleItemClick(item.path)}
                        >
                          <span className="nav-subitem-dot" aria-hidden="true" />
                          <span>{item.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer" ref={profileMenuRef}>
          <button
            type="button"
            className="sidebar-profile"
            onClick={() => setProfileMenuOpen((o) => !o)}
            title={isCollapsed ? fullName : undefined}
          >
            <span className="sidebar-avatar">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={fullName}
                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                initials
              )}
            </span>
            {!isCollapsed && (
              <span className="sidebar-profile-text">
                <span className="sidebar-profile-name">{fullName}</span>
                <span className="sidebar-profile-email">{email}</span>
              </span>
            )}
          </button>

          {profileMenuOpen && (
            <div className="sidebar-profile-menu">
              <button type="button" onClick={() => handleItemClick("/change-password")}>
                تغيير كلمة المرور
              </button>
              <button type="button" onClick={() => handleItemClick("/system-settings")}>
                إعدادات النظام
              </button>
              <button type="button" className="danger" onClick={onLogout}>
                <LogOutIcon size={15} />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
