import { useEffect } from "react";
import { Outlet } from "@tanstack/react-router";

// The application shell.
//
// Routing used to live in this file: a ~450-line switch over
// `window.location.pathname` with its own copy of the guard rules, its own list
// of which paths exist, and its own redirect table. Every one of those was a
// second source of truth that could disagree with the backend — and did, since
// the guards were client-side checks on client-side state.
//
// The file routes under `src/routes/` own all of that now. What is left here is
// only what is genuinely global — whichever route is showing, these still apply.

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

export default function App() {
  usePersistedTheme();
  useDocumentDirection();

  return <Outlet />;
}
