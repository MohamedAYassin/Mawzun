import { useEffect } from "react";
import { Navigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import { ApiError, authApi, session } from "../../lib/api";
import { currentUserQueryKey, useCurrentUser } from "../../hooks/useCurrentUser";
import Onboarding from "../Onboarding/Onboarding";

// The company-facing shell's guard.
//
// Three things have to be true before a dashboard screen renders, and each is
// checked where it can actually be enforced:
//
//   1. There is a token pair. The route's `beforeLoad` checks this
//      synchronously, so a signed-out visitor never renders a dashboard frame,
//      not even for the moment it takes to fetch the principal.
//   2. The pair still works. That is `/auth/me`, and only the server can
//      answer it — a token can be well formed and revoked.
//   3. The company may use the app. A SUSPENDED or CLOSED company is rejected
//      at authentication with a 403 on *every* route, `/auth/me` included.
//
// The third case is the one that used to be invisible: the shell rendered,
// every request on the page failed, and the user got a dashboard made of empty
// tables. Showing the server's own message and a way out is the honest
// behaviour, and it costs one branch.

function Spinner({ label }: { label: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        direction: "rtl",
        fontFamily: "var(--font-body)",
        color: "var(--text-secondary)",
      }}
    >
      <img src="/logo_scale.svg" alt="Mawzun" width={56} height={56} />
      <span>{label}</span>
    </div>
  );
}

function Blocked({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        direction: "rtl",
        fontFamily: "var(--font-body)",
      }}
    >
      <div
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-pop)",
          padding: "2.25rem",
          maxWidth: "26rem",
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "3.5rem",
            height: "3.5rem",
            borderRadius: "50%",
            background: "var(--color-danger-soft)",
            color: "var(--color-danger)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.7rem",
          }}
        >
          ⚠️
        </div>
        <h1 style={{ margin: 0, fontSize: "1.1rem", color: "var(--text-primary)" }}>{title}</h1>
        <p style={{ margin: 0, color: "var(--text-secondary)", lineHeight: 1.6 }}>{message}</p>
        <button
          type="button"
          onClick={onAction}
          style={{
            marginTop: "0.5rem",
            background: "var(--color-accent)",
            color: "#fff",
            border: "none",
            padding: "0.7rem 1.5rem",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Renders `children` once the caller is known and their company is usable.
 *
 * Mounted once by the dashboard layout route rather than repeated on every
 * screen, so a guard change is a change in one file.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isReady, principal, isError, error, isPlatformAdmin } = useCurrentUser();

  const goToLogin = () => {
    void router.navigate({ to: "/login", replace: true });
  };

  // A 401 means the pair is dead. The transport has already cleared the stored
  // tokens and fired `mawzun:session-expired` by the time this runs, so there
  // is nothing to clean up here — only somewhere to send the user.
  const isUnauthorized = isError && error instanceof ApiError && error.status === 401;

  useEffect(() => {
    if (isUnauthorized || !session.isAuthenticated) goToLogin();
  }, [isUnauthorized]);

  if (isUnauthorized || !session.isAuthenticated) return <Spinner label="جاري تسجيل الخروج..." />;

  // The only 403 `/auth/me` can return is the company-status check in
  // `authenticate`: the route requires no permission, so nothing else in it
  // can forbid.
  if (isError && error instanceof ApiError && error.status === 403) {
    return (
      <Blocked
        title="تعذّر الوصول إلى الشركة"
        message={error.message}
        actionLabel="تسجيل الخروج"
        onAction={() => {
          void authApi.logout(true).catch(() => undefined).then(goToLogin);
        }}
      />
    );
  }

  if (isError) {
    return (
      <Blocked
        title="تعذّر تحميل الحساب"
        message={error instanceof Error ? error.message : "حدث خطأ غير متوقع."}
        actionLabel="إعادة المحاولة"
        onAction={() => void router.invalidate()}
      />
    );
  }

  if (!isReady || !principal) return <Spinner label="جاري تحميل بيانات الحساب..." />;

  // Platform staff belong to no company — the database refuses to give them
  // one — so every company screen they opened would be a screen whose every
  // request comes back 403. Send them to the surface they can use instead.
  if (isPlatformAdmin) return <Navigate to="/platform/companies" replace />;

  // First run. Only the owner is shown the wizard: they are the only one who
  // can write settings (ManageSettings), so showing it to staff would present
  // a form whose every save is refused. Staff of an un-onboarded company see
  // the app normally — their employer will finish setup.
  if (principal.onboarding && !principal.onboarding.completed && principal.user.isCompanyOwner) {
    // The wizard writes the answers and marks the company onboarded. The
    // principal is cached by React Query, so `router.invalidate()` alone is
    // not enough — it re-runs route loaders, not the query that holds the
    // onboarding flag. Without invalidating that query the wizard closed and
    // the app immediately re-rendered it from the stale cache, which looked
    // like the button doing nothing.
    return (
      <Onboarding
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
        }}
      />
    );
  }

  return <>{children}</>;
}
