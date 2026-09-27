import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { session } from "../lib/api";

// The app frontend's root. The marketing home lives on the separate
// web deployment (mawzun.org); everything here is the product.
//
// Smart redirect, client-side only: a signed-out visitor goes to /login, a
// signed-in one to the dashboard.
//
// This route deliberately does NOT redirect in `beforeLoad`. A server-side
// redirect here forces "/" through SSR on every request, and any SSR hiccup
// shows Cloudflare's error page on first load. Prerendering writes a static
// index.html instead, so "/" is served straight from Workers Assets — no SSR
// in the path at all.
export const Route = createFileRoute("/")({
  component: RootRedirect,
});

function RootRedirect() {
  useEffect(() => {
    window.location.replace(
      session.isAuthenticated ? "/dashboard/sales-overview" : "/login"
    );
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <p>جارٍ التحويل…</p>
    </div>
  );
}
