import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import DashboardLayout from "../../components/DashboardLayout/DashboardLayout";
import { toArabicNumerals } from "../../utils/arabicNumerals";
import {
  ApiError,
  companyApi,
  rolesApi,
  usersApi,
  type CompanyUser,
  type Role,
} from "../../lib/api";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import "./Users.css";

interface UsersProps {
  navigate: (path: string) => void;
}

const pageSize = 10;

const STATUS_LABEL: Record<CompanyUser["status"], string> = {
  ACTIVE: "نشط",
  SUSPENDED: "غير نشط",
  INVITED: "بانتظار القبول",
};

/**
 * Turns an unknown failure into something showable.
 *
 * The previous version swallowed load errors in an empty catch block, so a
 * dead backend looked identical to a company with no members. Owner-protection
 * rejections get their own wording because "409 conflict" means nothing to
 * someone trying to delete an admin.
 */
function describeError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.isOwnerProtected) return "لا يمكن حذف أو تعطيل مالك الشركة.";
    if (error.isForbidden) return "ليس لديك الصلاحية الكافية لإتمام هذا الإجراء.";
    return error.message;
  }
  return fallback;
}

export default function Users({ navigate }: UsersProps) {
  const [usersList, setUsersList] = useState<CompanyUser[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  // The company owner. Fetched once: it is the one row in this screen whose
  // controls must not be offered, and it never changes without ownership
  // transfer — an explicit, audited operation.
  const [ownerId, setOwnerId] = useState<string | null>(null);

  // Drawer state
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPhone, setNewUserPhone] = useState("");
  const [newUserJobTitle, setNewUserJobTitle] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [newUserRoleIds, setNewUserRoleIds] = useState<string[]>([]);

  const [rolesDropdownOpen, setRolesDropdownOpen] = useState(false);

  const [availableRoles, setAvailableRoles] = useState<Role[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);

  // Role edit state (table)
  const [roleEditUserId, setRoleEditUserId] = useState<string | null>(null);
  const [roleEditAnchor, setRoleEditAnchor] = useState<{ top: number; right: number } | null>(null);
  const roleEditRef = useRef<HTMLDivElement>(null);

  // Effective permissions come from the server, not from a role name cached in
  // localStorage at login time. See hooks/useCurrentUser.
  const { hasPermission, isReady: capabilitiesReady } = useCurrentUser();
  const canManageUsers = capabilitiesReady && hasPermission("Permissions.ManageUsers");

  // Popover togglers
  const [filterOpen, setFilterOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);

  // Refs
  const filterRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const rolesDropdownRef = useRef<HTMLDivElement>(null);

  // Filters state
  const [filterName, setFilterName] = useState("");
  const [filterEmail, setFilterEmail] = useState("");
  const [filterPhone, setFilterPhone] = useState("");
  const [filterUserStatus, setFilterUserStatus] = useState("all");
  const [filterStatusOpen, setFilterStatusOpen] = useState(false);


  // Group by option state
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [groupSearch, setGroupSearch] = useState("");

  // Columns visibility state
  const [visibleColumns, setVisibleColumns] = useState({
    name: true,
    email: true,
    phone: true,
    role: true,
    status: true,
    lastLogin: true,
  });

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (filterOpen && filterRef.current && !filterRef.current.contains(target)) {
        setFilterOpen(false);
        setFilterStatusOpen(false);
      }
      if (groupOpen && groupRef.current && !groupRef.current.contains(target)) {
        setGroupOpen(false);
      }
      if (columnsOpen && columnsRef.current && !columnsRef.current.contains(target)) {
        setColumnsOpen(false);
      }
      if (
        rolesDropdownOpen &&
        rolesDropdownRef.current &&
        !rolesDropdownRef.current.contains(target)
      ) {
        setRolesDropdownOpen(false);
      }
      if (roleEditUserId && roleEditRef.current && !roleEditRef.current.contains(target)) {
        setRoleEditUserId(null);
        setRoleEditAnchor(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [filterOpen, groupOpen, columnsOpen, rolesDropdownOpen, roleEditUserId]);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await usersApi.list({
        search: searchTerm.trim() || undefined,
        page,
        pageSize,
      });
      setUsersList(result.items);
      setTotalEntries(result.total);
      setTotalPages(result.totalPages);
    } catch (e) {
      setError(describeError(e, "فشل تحميل قائمة المستخدمين."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, searchTerm]);

  // The owner never changes during normal use, so this is loaded once.
  useEffect(() => {
    let mounted = true;
    void companyApi
      .profile()
      .then((profile) => {
        if (mounted) setOwnerId(profile.owner.id);
      })
      .catch(() => {
        // Not fatal: without the owner id the screen simply offers no
        // destructive action on any row, which is the safe direction to fail.
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Roles available in this company.
  useEffect(() => {
    let mounted = true;
    setRolesLoading(true);
    void rolesApi
      .list({ pageSize: 100 })
      .then((result) => {
        if (!mounted) return;
        setAvailableRoles(result.items);
      })
      .catch(() => {
        if (mounted) setAvailableRoles([]);
      })
      .finally(() => {
        if (mounted) setRolesLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Client-side filter on top of paginated data
  const filteredUsers = usersList.filter((user) => {
    if (filterName && !user.fullName.includes(filterName)) return false;
    if (filterEmail && !user.email.includes(filterEmail)) return false;
    if (filterPhone && !(user.phoneNumber ?? "").includes(filterPhone)) return false;
    if (filterUserStatus !== "all" && user.status !== filterUserStatus) return false;
    return true;
  });

  const groupingOptions = [{ key: "status", label: "الحالة" }].filter((opt) =>
    opt.label.includes(groupSearch),
  );

  const toggleColumn = (col: keyof typeof visibleColumns) => {
    setVisibleColumns((prev) => ({ ...prev, [col]: !prev[col] }));
  };

  const showAllColumns = () => {
    setVisibleColumns({ name: true, email: true, phone: true, role: true, status: true, lastLogin: true });
  };

  const isOwner = (user: CompanyUser) => ownerId === user.id;

  const handleToggleUserStatus = async (user: CompanyUser) => {
    if (isOwner(user)) {
      alert("لا يمكن تعطيل مالك الشركة.");
      return;
    }
    const willSuspend = user.status === "ACTIVE";
    const confirmMsg = willSuspend
      ? `هل أنت متأكد من تعطيل حساب المستخدم «${user.fullName}»؟`
      : `هل أنت متأكد من تفعيل حساب المستخدم «${user.fullName}»؟`;
    if (!window.confirm(confirmMsg)) return;
    setLoading(true);
    try {
      await usersApi.update(user.id, { status: willSuspend ? "SUSPENDED" : "ACTIVE" });
      await loadUsers();
    } catch (e) {
      alert(describeError(e, "فشل تعديل حالة الحساب."));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (user: CompanyUser) => {
    if (isOwner(user)) {
      alert("لا يمكن حذف مالك الشركة.");
      return;
    }
    if (!window.confirm(`هل أنت متأكد من حذف المستخدم «${user.fullName}»؟`)) return;
    setLoading(true);
    try {
      await usersApi.remove(user.id);
      await loadUsers();
    } catch (e) {
      alert(describeError(e, "فشل حذف المستخدم."));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (user: CompanyUser) => {
    const newPass = window.prompt(
      `أدخل كلمة المرور الجديدة للمستخدم «${user.fullName}» (٨ أحرف على الأقل):`,
    );
    if (newPass === null) return;
    const cleanPass = newPass.trim();
    if (!cleanPass) {
      alert("كلمة المرور لا يمكن أن تكون فارغة.");
      return;
    }
    if (cleanPass.length < 8) {
      alert("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
      return;
    }
    setLoading(true);
    try {
      await usersApi.resetPassword(user.id, cleanPass);
      alert("تمت إعادة تعيين كلمة المرور بنجاح");
    } catch (e) {
      alert(describeError(e, "فشل إعادة تعيين كلمة المرور."));
    } finally {
      setLoading(false);
    }
  };

  const handleChangeRole = async (user: CompanyUser, roleId: string) => {
    if (!roleId) {
      setRoleEditUserId(null);
      return;
    }
    if (isOwner(user)) {
      setRoleEditUserId(null);
      return;
    }
    setLoading(true);
    try {
      await usersApi.update(user.id, { roleIds: [roleId] });
      setRoleEditUserId(null);
      await loadUsers();
    } catch (e) {
      alert(describeError(e, "فشل تغيير دور المستخدم."));
    } finally {
      setLoading(false);
    }
  };

  const resetAddUserForm = () => {
    setNewUserName("");
    setNewUserEmail("");
    setNewUserPhone("");
    setNewUserJobTitle("");
    setNewUserPassword("");
    setNewUserRoleIds([]);
    setShowPassword(false);
  };

  const handleAddUser = async () => {
    if (!newUserName.trim()) {
      alert("يرجى إدخال اسم المستخدم");
      return;
    }
    if (!newUserEmail.trim()) {
      alert("يرجى إدخال البريد الإلكتروني");
      return;
    }
    if (newUserPassword.length < 8) {
      alert("كلمة المرور يجب ألا تقل عن ٨ أحرف.");
      return;
    }
    setLoading(true);
    try {
      // Creating a member of this company — NOT registering. Registering would
      // mint a second company with this person as its owner.
      await usersApi.create({
        fullName: newUserName.trim(),
        email: newUserEmail.trim(),
        password: newUserPassword,
        phoneNumber: newUserPhone.trim() || null,
        jobTitle: newUserJobTitle.trim() || null,
        roleIds: newUserRoleIds,
      });
      resetAddUserForm();
      setAddUserOpen(false);
      await loadUsers();
    } catch (e) {
      alert(describeError(e, "فشل إضافة المستخدم."));
    } finally {
      setLoading(false);
    }
  };

  // Grouped users list helper
  const groupedUsers = groupBy
    ? filteredUsers.reduce(
        (acc, user) => {
          const val = STATUS_LABEL[user.status] ?? "غير محدد";
          if (!acc[val]) acc[val] = [];
          acc[val].push(user);
          return acc;
        },
        {} as Record<string, CompanyUser[]>,
      )
    : null;

  const renderPhone = (user: CompanyUser) => {
    const phone = user.phoneNumber ?? "";
    if (!phone) return <span style={{ color: "var(--text-muted)" }}>—</span>;
    const flag = phone.startsWith("05") || phone.startsWith("+966") ? "🇸🇦" : "🇪🇬";
    const prefix = flag === "🇸🇦" ? "+٩٦٦" : "+٢٠";
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          direction: "ltr",
          justifyContent: "flex-end",
        }}
      >
        <span>{toArabicNumerals(phone)}</span>
        <span>{prefix}</span>
        <span>{flag}</span>
      </div>
    );
  };

  const primaryRole = (user: CompanyUser) => user.roles[0];

  const renderRoleCell = (user: CompanyUser) => {
    const editing = roleEditUserId === user.id;
    const role = primaryRole(user);
    const locked = isOwner(user) || !canManageUsers;

    const openEditor = (btn: HTMLButtonElement | null) => {
      if (!btn) return;
      if (editing) {
        setRoleEditUserId(null);
        setRoleEditAnchor(null);
        return;
      }
      const rect = btn.getBoundingClientRect();
      setRoleEditUserId(user.id);
      setRoleEditAnchor({
        top: rect.bottom + window.scrollY + 6,
        right: rect.right + window.scrollX,
      });
    };

    const label = isOwner(user) ? "المالك" : (role?.name ?? "بدور");

    // The owner's authority does not come from a role row, so there is nothing
    // to edit. Showing a picker here would imply the change would take effect.
    if (locked) {
      return (
        <span
          style={{
            fontSize: "0.8rem",
            background: "var(--bg-secondary)",
            padding: "2px 8px",
            borderRadius: "4px",
            color: "var(--text-primary)",
            fontWeight: 500,
          }}
          title={isOwner(user) ? "مالك الشركة يمتلك كل الصلاحيات ولا يمكن تغيير دوره" : undefined}
        >
          {label}
        </span>
      );
    }

    return (
      <>
        <button
          className="forgot-btn"
          style={{
            fontSize: "0.8rem",
            textDecoration: "none",
            background: "var(--bg-secondary)",
            padding: "2px 8px",
            borderRadius: "4px",
            color: "var(--text-primary)",
            fontWeight: 500,
          }}
          onClick={(e) => openEditor(e.currentTarget)}
          disabled={loading}
          title="تغيير الدور"
        >
          {label} ▾
        </button>
        {editing &&
          roleEditAnchor &&
          createPortal(
            <div
              ref={roleEditRef}
              style={{
                position: "absolute",
                top: roleEditAnchor.top,
                right: roleEditAnchor.right,
                zIndex: 1000,
                minWidth: "190px",
                background: "var(--bg-primary)",
                border: "1px solid var(--border-color)",
                borderRadius: "10px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.16)",
                padding: "0.35rem",
                textAlign: "right",
              }}
            >
              {rolesLoading ? (
                <div
                  style={{
                    padding: "0.4rem 0.6rem",
                    fontSize: "0.72rem",
                    color: "var(--text-muted)",
                  }}
                >
                  جاري تحميل الأدوار...
                </div>
              ) : (
                <>
                  <div
                    style={{
                      padding: "0.3rem 0.6rem",
                      fontSize: "0.65rem",
                      color: "var(--text-muted)",
                      fontWeight: 700,
                    }}
                  >
                    تغيير الدور
                  </div>
                  {availableRoles.map((r) => (
                    <div
                      key={r.id}
                      onClick={() => void handleChangeRole(user, r.id)}
                      style={{
                        padding: "0.4rem 0.6rem",
                        borderRadius: "var(--radius-md)",
                        cursor: "pointer",
                        fontSize: "0.75rem",
                        fontWeight: r.id === (role?.id ?? "") ? 700 : 500,
                        background:
                          r.id === (role?.id ?? "") ? "var(--bg-secondary)" : "transparent",
                        color: "var(--text-primary)",
                      }}
                    >
                      {r.name} {r.id === (role?.id ?? "") && "✓"}
                    </div>
                  ))}
                </>
              )}
            </div>,
            document.body,
          )}
      </>
    );
  };

  const renderRow = (user: CompanyUser) => (
    <tr key={user.id}>
      {visibleColumns.name && (
        <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {user.avatarUrl ? (
              <img
                className="users-avatar"
                src={user.avatarUrl}
                alt={user.fullName}
                style={{ objectFit: "cover" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="users-avatar">
                {user.fullName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")}
              </div>
            )}
            <span>{user.fullName}</span>
            {isOwner(user) && <span className="badge-owner">المالك</span>}
            {user.jobTitle && <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 400 }}>{user.jobTitle}</div>}
          </div>
        </td>
      )}
      {visibleColumns.email && <td style={{ color: "var(--text-secondary)" }}>{user.email}</td>}
      {visibleColumns.phone && <td>{renderPhone(user)}</td>}
      {visibleColumns.role && <td>{renderRoleCell(user)}</td>}
      {visibleColumns.status && (
        <td>
          <span className={user.status === "ACTIVE" ? "badge-active" : "badge-gray"}>
            {STATUS_LABEL[user.status]}
          </span>
        </td>
      )}
      {visibleColumns.lastLogin && (
        <td style={{ color: "var(--text-secondary)", fontSize: "0.82rem" }}>
          {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString("ar-EG") : "لم يدخل بعد"}
        </td>
      )}
      <td style={{ textAlign: "center" }}>
        <div
          style={{
            display: "flex",
            gap: "0.4rem",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <button
            className="users-action-btn"
            onClick={() => void handleResetPassword(user)}
            disabled={loading}
          >
            كلمة المرور
          </button>
          {/* The owner has no suspend or delete control at all: offering one
              that the server will always refuse is worse than not offering it. */}
          {!isOwner(user) && (
            <button
              className={`users-action-btn ${user.status === "ACTIVE" ? "users-action-btn-danger" : "users-action-btn-moss"}`}
              onClick={() => void handleToggleUserStatus(user)}
              disabled={loading}
            >
              {user.status === "ACTIVE" ? "تعطيل" : "تفعيل"}
            </button>
          )}
          {!isOwner(user) && (
            <button
              className="users-action-btn users-action-btn-danger"
              onClick={() => void handleDeleteUser(user)}
              disabled={loading}
            >
              حذف
            </button>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <DashboardLayout navigate={navigate}>
      <div className="users-container">
        <div className="users-header">
          <div className="users-title-area">
            <h1 className="users-title">إدارة المستخدمين</h1>
            <p className="users-subtitle">
              أنشئ حسابات الموظفين وحدد أدوارهم وحالات حساباتهم للتحكم في وصولهم للسيستم
            </p>
          </div>
          {canManageUsers && (
            <button className="users-btn-add" onClick={() => setAddUserOpen(true)}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              <span>إضافة مستخدم جديد</span>
            </button>
          )}
        </div>

        {error && (
          <div className="users-error" role="alert">
            <span>{error}</span>
            <button className="users-error-retry" onClick={() => void loadUsers()}>
              إعادة المحاولة
            </button>
          </div>
        )}

        <div className="users-toolbar">
          <div className="users-toolbar-actions">
            <input
              type="text"
              className="users-search-input"
              placeholder="البحث بالاسم، البريد أو الهاتف..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
            />

            <div className="users-popover-trigger" ref={filterRef}>
              <button
                className={`users-btn-action ${filterOpen ? "active-popover" : ""}`}
                onClick={() => {
                  setFilterOpen(!filterOpen);
                  setGroupOpen(false);
                  setColumnsOpen(false);
                          }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                <span>فلترة</span>
              </button>
              {filterOpen && (
                <div className="users-popover-panel w-filter">
                  <p className="popover-header">فلترة حسب</p>
                  <div className="popover-field-group">
                    <div className="popover-label-item">
                      <label className="popover-label">الاسم</label>
                      <input
                        type="text"
                        className="popover-input"
                        placeholder="البحث بالاسم"
                        value={filterName}
                        onChange={(e) => setFilterName(e.target.value)}
                      />
                    </div>
                    <div className="popover-label-item">
                      <label className="popover-label">البريد الإلكتروني</label>
                      <input
                        type="text"
                        className="popover-input"
                        placeholder="البحث بالبريد"
                        value={filterEmail}
                        onChange={(e) => setFilterEmail(e.target.value)}
                      />
                    </div>
                    <div className="popover-label-item">
                      <label className="popover-label">رقم الهاتف</label>
                      <input
                        type="text"
                        className="popover-input"
                        placeholder="البحث برقم الهاتف"
                        value={filterPhone}
                        onChange={(e) => setFilterPhone(e.target.value)}
                      />
                    </div>
                    <div className="popover-label-item">
                      <label className="popover-label">حالة المستخدم</label>
                      <button
                        type="button"
                        className="popover-select"
                        onClick={() => setFilterStatusOpen(!filterStatusOpen)}
                      >
                        <span>
                          {filterUserStatus === "all"
                            ? "كل الحالات"
                            : STATUS_LABEL[filterUserStatus as CompanyUser["status"]]}
                        </span>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      {filterStatusOpen && (
                        <div className="popover-select-options">
                          <div
                            className={`popover-select-option ${filterUserStatus === "all" ? "selected" : ""}`}
                            onClick={() => {
                              setFilterUserStatus("all");
                              setFilterStatusOpen(false);
                            }}
                          >
                            كل الحالات
                          </div>
                          {(Object.keys(STATUS_LABEL) as CompanyUser["status"][]).map((s) => (
                            <div
                              key={s}
                              className={`popover-select-option ${filterUserStatus === s ? "selected" : ""}`}
                              onClick={() => {
                                setFilterUserStatus(s);
                                setFilterStatusOpen(false);
                              }}
                            >
                              {STATUS_LABEL[s]}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      className="btn-filter-clear"
                      onClick={() => {
                        setFilterName("");
                        setFilterEmail("");
                        setFilterPhone("");
                        setFilterUserStatus("all");
                        setFilterOpen(false);
                      }}
                      style={{ marginTop: "0.5rem" }}
                    >
                      إعادة ضبط الفلاتر
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="users-popover-trigger" ref={groupRef}>
              <button
                className={`users-btn-action ${groupOpen ? "active-popover" : ""}`}
                onClick={() => {
                  setGroupOpen(!groupOpen);
                  setFilterOpen(false);
                  setColumnsOpen(false);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                  <path d="M12 6v12" />
                  <path d="M6 12h12" />
                </svg>
                <span>تجميع حسب</span>
              </button>
              {groupOpen && (
                <div className="users-popover-panel w-group">
                  <p className="popover-header">تجميع حسب</p>
                  <div className="popover-search-container">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="popover-search-icon"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" x2="16.65" y1="21" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      className="popover-input"
                      placeholder="بحث"
                      style={{ paddingLeft: "24px" }}
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    {groupingOptions.map((opt) => (
                      <div
                        key={opt.key}
                        className={`popover-group-item ${groupBy === opt.key ? "active" : ""}`}
                        onClick={() => {
                          setGroupBy(groupBy === opt.key ? null : opt.key);
                          setGroupOpen(false);
                        }}
                      >
                        <span>{opt.label}</span>
                      </div>
                    ))}
                    {groupBy && (
                      <div
                        className="popover-group-item"
                        onClick={() => {
                          setGroupBy(null);
                          setGroupOpen(false);
                        }}
                        style={{
                          color: "var(--text-muted)",
                          borderTop: "1px solid var(--border-color)",
                          marginTop: "4px",
                        }}
                      >
                        <span>إلغاء التجميع</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="users-popover-trigger" ref={columnsRef}>
              <button
                className={`users-btn-action ${columnsOpen ? "active-popover" : ""}`}
                onClick={() => {
                  setColumnsOpen(!columnsOpen);
                  setFilterOpen(false);
                  setGroupOpen(false);
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                  <path d="M15 3v18" />
                </svg>
                <span>الأعمدة</span>
              </button>
              {columnsOpen && (
                <div className="users-popover-panel w-columns" style={{ left: "auto", right: "0" }}>
                  <p className="popover-header">تحديد الأعمدة</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    {(
                      [
                        ["name", "اسم الحساب"],
                        ["email", "البريد الالكتروني"],
                        ["phone", "رقم الهاتف"],
                        ["role", "الدور"],
                        ["status", "الحالة"],
                      ] as const
                    ).map(([key, label]) => (
                      <div
                        key={key}
                        className="popover-group-item"
                        onClick={() => toggleColumn(key)}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span>{label}</span>
                        {visibleColumns[key] && (
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{ color: "var(--color-success)" }}
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                    ))}
                    <div
                      className="popover-group-item"
                      onClick={showAllColumns}
                      style={{
                        color: "var(--text-secondary)",
                        borderTop: "1px solid var(--border-color)",
                        marginTop: "4px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>اظهار الكل</span>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
            مستعملي السيستم:{" "}
            <span style={{ color: "var(--color-accent)" }}>{toArabicNumerals(totalEntries)}</span>
          </span>
        </div>

        <div className="users-table-card table-responsive-container">
          <table className="users-table">
            <thead>
              <tr>
                {visibleColumns.name && <th>اسم الحساب</th>}
                {visibleColumns.email && <th>البريد الالكتروني</th>}
                {visibleColumns.phone && <th style={{ textAlign: "left" }}>رقم الهاتف</th>}
                {visibleColumns.role && <th>الدور</th>}
                {visibleColumns.status && <th>الحالة</th>}
                {visibleColumns.lastLogin && <th>آخر دخول</th>}
                <th style={{ width: "200px", textAlign: "center" }}>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    style={{ textAlign: "center", padding: "3rem", color: "var(--text-muted)" }}
                  >
                    جاري تحميل قائمة المستخدمين...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      textAlign: "center",
                      padding: "3rem",
                      color: "var(--text-muted)",
                      fontSize: "0.95rem",
                    }}
                  >
                    لا توجد سجلات مطابقة للبحث أو الفلترة النشطة
                  </td>
                </tr>
              ) : groupedUsers ? (
                Object.keys(groupedUsers).map((groupName) => (
                  <FragmentGroup
                    key={groupName}
                    label={groupName}
                    count={groupedUsers[groupName].length}
                  >
                    {groupedUsers[groupName].map(renderRow)}
                  </FragmentGroup>
                ))
              ) : (
                filteredUsers.map(renderRow)
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.75rem 0",
              marginTop: "0.5rem",
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{
                padding: "0.4rem 0.8rem",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                background: "var(--bg-primary)",
                cursor: page <= 1 ? "default" : "pointer",
                opacity: page <= 1 ? 0.4 : 1,
                fontSize: "0.8rem",
              }}
            >
              السابق
            </button>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              الصفحة {toArabicNumerals(page)} من {toArabicNumerals(totalPages)} (
              {toArabicNumerals(totalEntries)} مستخدم)
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              style={{
                padding: "0.4rem 0.8rem",
                border: "1px solid var(--border-color)",
                borderRadius: 6,
                background: "var(--bg-primary)",
                cursor: page >= totalPages ? "default" : "pointer",
                opacity: page >= totalPages ? 0.4 : 1,
                fontSize: "0.8rem",
              }}
            >
              التالي
            </button>
          </div>
        )}

        {addUserOpen && (
          <div className="users-drawer-backdrop" onClick={() => setAddUserOpen(false)}>
            <div className="users-drawer-content" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-header">
                <button className="drawer-close-btn" onClick={() => setAddUserOpen(false)}>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
                <div className="drawer-title-area">
                  <h2 className="drawer-title">إضافة مستخدم جديد</h2>
                  <p className="drawer-subtitle">
                    سيُضاف المستخدم إلى شركتك كعضو، ويمكن منحه دوراً يحدد صلاحياته
                  </p>
                </div>
              </div>
              <div className="drawer-form-body">
                <div className="drawer-field">
                  <label className="drawer-label">اسم المستخدم *</label>
                  <input
                    type="text"
                    className="drawer-input"
                    placeholder="يرجى إدخال اسم المستخدم"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                  />
                </div>
                <div className="drawer-field">
                  <label className="drawer-label">البريد الالكتروني *</label>
                  <input
                    type="email"
                    className="drawer-input"
                    placeholder="name@company.com"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                  />
                </div>
                <div className="drawer-field">
                  <label className="drawer-label">رقم الهاتف</label>
                  <input
                    type="tel"
                    className="drawer-input"
                    placeholder="يرجى إدخال رقم الهاتف"
                    value={newUserPhone}
                    onChange={(e) => setNewUserPhone(e.target.value)}
                  />
                </div>
                <div className="drawer-field">
                  <label className="drawer-label">المسمى الوظيفي</label>
                  <input
                    type="text"
                    className="drawer-input"
                    placeholder="مثال: مسؤول مبيعات"
                    value={newUserJobTitle}
                    onChange={(e) => setNewUserJobTitle(e.target.value)}
                  />
                </div>
                <div className="drawer-field">
                  <label className="drawer-label">الرقم السري * (٨ أحرف على الأقل)</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? "text" : "password"}
                      className="drawer-input password-input"
                      value={newUserPassword}
                      onChange={(e) => setNewUserPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" y1="2" x2="22" y2="22" />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="drawer-field">
                  <label className="drawer-label">الأدوار</label>
                  <div className="roles-select-wrapper" ref={rolesDropdownRef}>
                    <button
                      type="button"
                      className="roles-select-btn"
                      onClick={() => setRolesDropdownOpen(!rolesDropdownOpen)}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="roles-chevron"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                      <span
                        className={`roles-placeholder ${newUserRoleIds.length > 0 ? "has-value" : ""}`}
                      >
                        {newUserRoleIds.length > 0
                          ? availableRoles
                              .filter((r) => newUserRoleIds.includes(r.id))
                              .map((r) => r.name)
                              .join("، ")
                          : "بدون دور (اختياري)"}
                      </span>
                    </button>
                    {rolesDropdownOpen && (
                      <div className="roles-dropdown-menu">
                        {rolesLoading ? (
                          <div
                            className="roles-dropdown-item"
                            style={{
                              cursor: "default",
                              color: "var(--text-muted)",
                              fontSize: "0.75rem",
                            }}
                          >
                            جاري تحميل الأدوار...
                          </div>
                        ) : (
                          availableRoles.map((role) => {
                            const isChecked = newUserRoleIds.includes(role.id);
                            return (
                              <div
                                key={role.id}
                                className={`roles-dropdown-item ${isChecked ? "checked" : ""}`}
                                onClick={() => {
                                  setNewUserRoleIds(
                                    isChecked
                                      ? newUserRoleIds.filter((id) => id !== role.id)
                                      : [...newUserRoleIds, role.id],
                                  );
                                }}
                              >
                                <div className="roles-item-checkbox">
                                  {isChecked && (
                                    <svg
                                      xmlns="http://www.w3.org/2000/svg"
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="3"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  )}
                                </div>
                                <span className="roles-item-label">{role.name}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="drawer-footer">
                <button className="drawer-btn-secondary" onClick={() => setAddUserOpen(false)}>
                  إلغاء
                </button>
                <button
                  className="drawer-btn-primary"
                  onClick={() => void handleAddUser()}
                  disabled={loading}
                >
                  إضافة المستخدم
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

/**
 * A grouped header row plus its members.
 *
 * A React fragment cannot carry a key, and a plain <span> wrapper is invalid
 * inside <tbody>, so the group is its own component purely to hold one.
 */
function FragmentGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="users-group-header">
        <td colSpan={6}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>الحالة:</span>
            <span style={{ color: "var(--text-primary)" }}>{label}</span>
            <span
              style={{
                fontSize: "0.7rem",
                background: "var(--border-color)",
                color: "var(--text-secondary)",
                padding: "1px 6px",
                borderRadius: "3px",
                fontWeight: 500,
              }}
            >
              {toArabicNumerals(count)} سجلات
            </span>
          </div>
        </td>
      </tr>
      {children}
    </>
  );
}
