import { useState, useRef, useEffect, useCallback } from "react";
import { PanelLeftIcon, LogOutIcon } from "./SidebarIcons";
import { systemApi, type Notification } from "../../lib/api";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { usePathname } from "../../lib/navigation";
import "./TopBar.css";

interface TopBarProps {
  onLogout: () => void;
  onToggleSidebar: () => void;
  navigate: (path: string) => void;
}

const NOTIFICATION_CATEGORY_LABEL: Record<Notification["category"], string> = {
  GENERAL: "عام",
  ORDER: "طلبات",
  INVENTORY: "مخزون",
  SYSTEM: "النظام",
};

function NotificationBell({ navigate }: { navigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [count, recent] = await Promise.all([
        systemApi.unreadNotificationCount(),
        systemApi.listNotifications({ pageSize: 10 }),
      ]);
      setUnread(count.count);
      setItems(recent.items);
    } catch {
      /* notifications are non-critical — stay silent on failures */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 60000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) await refresh();
  };

  const openItem = async (item: Notification) => {
    if (!item.isRead) {
      try {
        await systemApi.markNotificationRead(item.id);
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    void refresh();
    if (item.link) navigate(item.link);
  };

  const markAll = async () => {
    try {
      await systemApi.markAllNotificationsRead();
    } catch {
      /* ignore */
    }
    await refresh();
  };

  const removeNotification = async (item: Notification) => {
    try {
      await systemApi.deleteNotification(item.id);
    } catch {
      /* ignore */
    }
    await refresh();
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        className="topbar-menu-trigger"
        onClick={() => void toggle()}
        aria-label="الإشعارات"
        title="الإشعارات"
        style={{ position: "relative" }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              left: "-4px",
              background: "var(--color-danger)",
              color: "var(--color-accent-contrast)",
              borderRadius: "999px",
              minWidth: "16px",
              height: "16px",
              fontSize: "0.62rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
              fontWeight: 700,
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            left: 0,
            background: "var(--bg-primary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-pop)",
            width: "320px",
            maxHeight: "380px",
            overflowY: "auto",
            zIndex: 1000,
            direction: "rtl",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.8rem 1rem",
              borderBottom: "1px solid var(--border-color)",
            }}
          >
            <strong style={{ fontSize: "0.85rem" }}>
              الإشعارات {unread > 0 && <span style={{ color: "var(--color-danger)" }}>({unread} جديدة)</span>}
            </strong>
            {unread > 0 && (
              <button
                onClick={() => void markAll()}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-warning)",
                  cursor: "pointer",
                  fontSize: "0.72rem",
                  fontWeight: 600,
                }}
              >
                تعليم الكل كمقروء
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div
              style={{ padding: "1.5rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8rem" }}
            >
              لا توجد إشعارات بعد
            </div>
          ) : (
            items.map((item) => (
              // The row is a div rather than a button because it now carries its
              // own delete control, and a button cannot legally nest a button.
              <div
                key={item.id}
                style={{
                  position: "relative",
                  background: item.isRead ? "var(--bg-primary)" : "var(--color-accent-soft)",
                  borderBottom: "1px solid var(--border-color)",
                }}
              >
                <button
                  onClick={() => void openItem(item)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "right",
                    padding: "0.7rem 2rem 0.7rem 1rem",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      fontSize: "0.78rem",
                      fontWeight: item.isRead ? 500 : 700,
                      color: "var(--text-primary)",
                    }}
                  >
                    {!item.isRead && <span style={{ color: "var(--color-danger)", marginLeft: "4px" }}>●</span>}
                    {item.title}
                  </span>
                  {item.message && (
                    <span
                      style={{
                        display: "block",
                        fontSize: "0.7rem",
                        color: "var(--text-secondary)",
                        marginTop: "2px",
                      }}
                    >
                      {item.message}
                    </span>
                  )}
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "0.64rem",
                      color: "var(--text-muted)",
                      marginTop: "3px",
                    }}
                  >
                    <span
                      style={{
                        background: "var(--color-warning-soft)",
                        color: "var(--color-warning)",
                        borderRadius: "var(--radius-xs)",
                        padding: "1px 5px",
                        fontWeight: 600,
                      }}
                    >
                      {NOTIFICATION_CATEGORY_LABEL[item.category] ?? item.category}
                    </span>
                    {new Date(item.createdAt).toLocaleString("ar-EG", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    {item.readAt && (
                      <span>
                        · قُرئ {new Date(item.readAt).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    )}
                  </span>
                </button>
                <button
                  onClick={() => void removeNotification(item)}
                  aria-label={`حذف إشعار ${item.title}`}
                  title="حذف الإشعار"
                  style={{
                    position: "absolute",
                    top: "0.55rem",
                    left: "0.6rem",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    lineHeight: 1,
                    padding: "2px 4px",
                  }}
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function TopBar({ onLogout, onToggleSidebar, navigate }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Who the caller is comes from the server on every load. It used to come
  // from `localStorage.getItem('fullName')`, written once at login — so
  // renaming an account, or an admin resetting a colleague's password, left
  // the header showing something that was no longer true.
  const { principal } = useCurrentUser();
  const fullName = principal?.user.fullName || "مستخدم";
  const email = principal?.user.email || "";

  const getInitials = (name: string) => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0] ? parts[0].substring(0, 2).toUpperCase() : "US";
  };

  const initials = getInitials(fullName);
  // Impersonation banner state: the backend marks the whole session when a
  // platform admin logs in as this user, so every page load announces it.
  const impersonatedBy = principal?.impersonatedBy ?? null;

  // The avatar is whatever the principal says it is; there is no separate
  // "profile picture" endpoint in the current contract, so there is nothing to
  // keep in sync and no event to listen for.
  const avatarUrl = principal?.user.avatarUrl ?? "";

  const currentPath = usePathname().toLowerCase();
  let breadcrumb = "لوحة الإحصائيات";
  if (currentPath === "/dashboard/sales-overview" || currentPath === "/dashboard/sales-overview/") {
    breadcrumb = "لوحة الإحصائيات / المبيعات";
  } else if (
    currentPath === "/dashboard/accounting-overview" ||
    currentPath === "/dashboard/accounting-overview/"
  ) {
    breadcrumb = "لوحة الإحصائيات / المحاسبة";
  } else if (currentPath === "/dashboard/orders" || currentPath === "/dashboard/orders/") {
    breadcrumb = "الطلبات / سجل الطلبات";
  } else if (currentPath === "/dashboard/add-sale" || currentPath === "/dashboard/add-sale/") {
    breadcrumb = "الطلبات / اضافه مبيعات";
  } else if (currentPath === "/dashboard/reasons" || currentPath === "/dashboard/reasons/") {
    breadcrumb = "الطلبات / إدارة الأسباب";
  } else if (
    currentPath === "/dashboard/order-sources" ||
    currentPath === "/dashboard/order-sources/"
  ) {
    breadcrumb = "الطلبات / مصادر الطلبات";
  } else if (
    currentPath === "/dashboard/confirmation-overview" ||
    currentPath === "/dashboard/confirmation-overview/"
  ) {
    breadcrumb = "الطلبات / تاكيد الطلبات";
  } else if (
    currentPath === "/dashboard/shipping-overview" ||
    currentPath === "/dashboard/shipping-overview/"
  ) {
    breadcrumb = "شركات الشحن / عمليات الشحن";
  } else if (
    currentPath === "/dashboard/shipping-companies" ||
    currentPath === "/dashboard/shipping-companies/"
  ) {
    breadcrumb = "شركات الشحن / اداره شركات الشحن";
  } else if (
    currentPath === "/dashboard/governorates" ||
    currentPath === "/dashboard/governorates/"
  ) {
    breadcrumb = "شركات الشحن / إدارة المحافظات";
  } else if (currentPath === "/dashboard/cities" || currentPath === "/dashboard/cities/") {
    breadcrumb = "شركات الشحن / إدارة المدن";
  } else if (currentPath === "/dashboard/warehouses" || currentPath === "/dashboard/warehouses/") {
    breadcrumb = "المخازن / إدارة المخازن";
  } else if (
    currentPath === "/dashboard/inventory-overview" ||
    currentPath === "/dashboard/inventory-overview/"
  ) {
    breadcrumb = "لوحة الإحصائيات / احصائيات المخازن";
  } else if (currentPath === "/dashboard/products" || currentPath === "/dashboard/products/") {
    breadcrumb = "المنتجات / إدارة المنتجات";
  } else if (
    currentPath === "/dashboard/storage-locations" ||
    currentPath === "/dashboard/storage-locations/"
  ) {
    breadcrumb = "المخازن / مواقع التخزين";
  } else if (
    currentPath === "/dashboard/inventory-transactions" ||
    currentPath === "/dashboard/inventory-transactions/"
  ) {
    breadcrumb = "المخازن / حركات التخزين";
  } else if (
    currentPath === "/dashboard/add-inventory-transaction" ||
    currentPath === "/dashboard/add-inventory-transaction/"
  ) {
    breadcrumb = "المخازن / تسجيل حركة مخزنية";
  } else if (currentPath === "/dashboard/production" || currentPath === "/dashboard/production/") {
    breadcrumb = "باتشات / إدارة الباتشات";
  } else if (currentPath === "/dashboard/add-batch" || currentPath === "/dashboard/add-batch/") {
    breadcrumb = "باتشات / إنشاء باتش";
  } else if (
    currentPath === "/dashboard/deficits-alert" ||
    currentPath === "/dashboard/deficits-alert/"
  ) {
    breadcrumb = "لوحة الإحصائيات / جدول عجز المخزون والنواقص";
  } else if (currentPath === "/dashboard/brands" || currentPath === "/dashboard/brands/") {
    breadcrumb = "المنتجات / إدارة الماركات";
  } else if (currentPath === "/dashboard/categories" || currentPath === "/dashboard/categories/") {
    breadcrumb = "المنتجات / شجرة الأقسام";
  } else if (
    currentPath === "/dashboard/payment-methods" ||
    currentPath === "/dashboard/payment-methods/"
  ) {
    breadcrumb = "المنتجات / طرق الدفع";
  } else if (currentPath === "/system-settings" || currentPath === "/system-settings/") {
    breadcrumb = "اعدادات النظام";
  } else if (currentPath === "/permissions" || currentPath === "/permissions/") {
    breadcrumb = "الاعدادات / الصلاحيات";
  } else if (currentPath === "/roles" || currentPath === "/roles/") {
    breadcrumb = "الاعدادات / الادوار";
  } else if (currentPath === "/users" || currentPath === "/users/") {
    breadcrumb = "الاعدادات / المستخدمين";
  } else if (currentPath === "/change-password" || currentPath === "/change-password/") {
    breadcrumb = "تغيير كلمة المرور";
  } else if (
    currentPath === "/dashboard/scanner-transactions" ||
    currentPath === "/dashboard/scanner-transactions/"
  ) {
    breadcrumb = "المسح الضوئي / سجل المسح";
  }

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <>
      {impersonatedBy && (
        <div
          className="impersonation-banner"
          role="status"
          style={{
            background: "var(--color-warning-soft)",
            borderBottom: "1px solid var(--color-warning)",
            color: "var(--color-warning)",
            padding: "0.45rem 1.5rem",
            fontSize: "0.8rem",
            textAlign: "center",
            position: "sticky",
            top: 0,
            zIndex: 101,
          }}
        >
          جلسة إدارة: يتم الدخول إلى حسابك بواسطة فريق المنصة ({impersonatedBy})
        </div>
      )}
      <header className="topbar">
      <div className="topbar-start">
        {/* Hamburger/Panel toggle Menu trigger */}
        <button
          className="topbar-menu-trigger"
          onClick={onToggleSidebar}
          aria-label="Toggle Sidebar"
        >
          <PanelLeftIcon />
        </button>
        <span className="topbar-breadcrumb">{breadcrumb}</span>
      </div>

      <div className="topbar-end" ref={menuRef}>
        <button
          className="topbar-menu-trigger"
          aria-label="تبديل المظهر"
          title="تبديل المظهر (فاتح/داكن)"
          onClick={() => {
            const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
            document.documentElement.dataset.theme = next;
            localStorage.setItem("theme", next);
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
        </button>
        <NotificationBell navigate={navigate} />
        <button className="topbar-user-btn" onClick={() => setMenuOpen((o) => !o)}>
          <div className="user-avatar-sm">
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
          </div>
        </button>

        {menuOpen && (
          <div className="topbar-dropdown">
            <div className="dropdown-header">
              <div className="user-avatar-md">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={fullName}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: "50%",
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  initials
                )}
              </div>
              <div className="dropdown-user-info">
                <span className="dropdown-user-name">{fullName}</span>
                <span className="dropdown-user-email">{email}</span>
              </div>
            </div>
            <div className="dropdown-divider" />
            <button
              className="dropdown-item"
              onClick={() => {
                setMenuOpen(false);
                navigate("/system-settings");
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginLeft: "8px" }}
              >
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              الإعدادات
            </button>
            <button
              className="dropdown-item"
              onClick={() => {
                setMenuOpen(false);
                navigate("/change-password");
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ marginLeft: "8px" }}
              >
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.778-7.778zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              تغيير كلمة المرور
            </button>
            <button className="dropdown-item" onClick={onLogout}>
              <LogOutIcon size={16} className="dropdown-logout-icon" />
              تسجيل الخروج
            </button>
          </div>
        )}
      </div>
        </header>
    </>
  );
}

export default TopBar;
