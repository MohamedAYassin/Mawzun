import { useEffect, useState } from "react";
import { Outlet } from "@tanstack/react-router";

import { usePageNavigate } from "./lib/navigation";
import "./App.css";

// The application shell.
//
// Routing used to live in this file: a ~450-line switch over
// `window.location.pathname` with its own copy of the guard rules, its own list
// of which paths exist, and its own redirect table. Every one of those was a
// second source of truth that could disagree with the backend — and did, since
// the guards were client-side checks on client-side state.
//
// The file routes under `src/routes/` own all of that now: the paths, the
// session and platform guards, the old addresses that still resolve, and the
// not-found screen. What is left here is only what is genuinely global —
// whichever route is showing, these still apply.

/**
 * Paints the persisted theme onto the document before the shell is visible.
 *
 * `localStorage` is the right place for this one thing: it is a display
 * preference, not an authorisation decision, and nothing breaks if it lies.
 */
function usePersistedTheme(): void {
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark" || saved === "light") {
      document.documentElement.dataset.theme = saved;
    }
  }, []);
}

/**
 * Every screen in the app frontend is Arabic and RTL. The bilingual marketing
 * home lives in the separate web deployment (mawzun.org).
 */
function useDocumentDirection(): void {
  useEffect(() => {
    document.documentElement.dir = "rtl";
    document.documentElement.lang = "ar";
  }, []);
}

function ForbiddenActionModal({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      className="custom-modal-overlay animate-fade-in"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "var(--overlay-scrim)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 9999,
        padding: "1rem",
        backdropFilter: "blur(4px)",
        direction: "rtl",
      }}
    >
      <div
        className="custom-modal-card"
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-lg)",
          padding: "2.25rem",
          maxWidth: "400px",
          width: "100%",
          boxShadow: "var(--shadow-pop)",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "1.1rem",
          fontFamily: "var(--font-body)",
        }}
      >
        <div
          style={{
            margin: "0 auto",
            width: "56px",
            height: "56px",
            borderRadius: "50%",
            backgroundColor: "var(--color-danger-soft)",
            color: "var(--color-danger)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontSize: "1.7rem",
          }}
        >
          ⚠️
        </div>
        <div>
          <h3
            style={{
              margin: "0 0 0.5rem 0",
              color: "var(--text-primary)",
              fontSize: "1.1rem",
              fontWeight: 700,
            }}
          >
            صلاحية مرفوضة
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--text-secondary)",
              fontSize: "0.85rem",
              lineHeight: "1.5",
            }}
          >
            {message}
          </p>
        </div>
        <button
          onClick={onDismiss}
          style={{
            background: "var(--color-accent)",
            color: "var(--color-accent-contrast)",
            border: "none",
            padding: "0.7rem 1.5rem",
            borderRadius: "var(--radius-md)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "0.85rem",
            transition: "background 0.2s",
            marginTop: "0.5rem",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-accent-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--color-accent)")}
        >
          حسناً، فهمت
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const navigate = usePageNavigate();
  const [forbiddenError, setForbiddenError] = useState<string | null>(null);

  usePersistedTheme();
  useDocumentDirection();

  // Screens raise this when the server answers 403: the transport turns the
  // response into an ApiError, the screen shows what it can inline, and
  // anything it cannot attribute to a control comes here.
  useEffect(() => {
    const handleForbidden = (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string }>;
      setForbiddenError(
        customEvent.detail?.message || "ليس لديك الصلاحية الكافية لإتمام هذا الإجراء.",
      );
    };
    window.addEventListener("forbidden-action", handleForbidden);
    return () => window.removeEventListener("forbidden-action", handleForbidden);
  }, []);

  // The API transport clears the session and raises this when a refresh fails,
  // so the UI is not left showing screens whose every request will 401. Inside
  // the dashboard the route guard catches the same thing; this is the case
  // where the session dies while no guard is mounted.
  useEffect(() => {
    const handleSessionExpired = () => navigate("/login");
    window.addEventListener("mawzun:session-expired", handleSessionExpired);
    return () => window.removeEventListener("mawzun:session-expired", handleSessionExpired);
  }, [navigate]);

  return (
    <>
      <Outlet />
      {forbiddenError && (
        <ForbiddenActionModal message={forbiddenError} onDismiss={() => setForbiddenError(null)} />
      )}
    </>
  );
}
