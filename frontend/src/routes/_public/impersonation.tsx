import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { API_PREFIX, ORIGIN, session } from "../../lib/api/http";

function buildUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${ORIGIN}${API_PREFIX}${suffix}`;
}

// ---------------------------------------------------------------------------
// Impersonation landing.
//
// The admin worker mints a session for the target user and hands the admin a
// one-time link here. The exchange MUST run in the browser: the rotated
// refresh cookie is set on the exchange response, and a cookie set during SSR
// would land on the server, never on the admin's browser. So this route
// renders a small client screen that fires the exchange in a useEffect and
// then navigates — beforeLoad only guards the presence of the token.
// ---------------------------------------------------------------------------
function ImpersonationLanding() {
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      window.location.replace("/login");
      return;
    }
    (async () => {
      try {
        const response = await fetch(buildUrl("/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: token }),
          credentials: "include",
        });
        const envelope = (await response.json()) as {
          success?: boolean;
          data?: { tokens: { accessToken: string } };
        };
        if (!response.ok || !envelope.success || !envelope.data) {
          setError("تعذر بدء جلسة الدخول كالمستخدم. الرابط غير صالح أو استُخدم مسبقاً.");
          return;
        }
        session.set(envelope.data.tokens.accessToken);
        window.location.replace("/dashboard/sales-overview");
      } catch {
        setError("تعذر الاتصال بالخادم. حاول مرة أخرى.");
      }
    })();
  }, []);

  if (error) {
    return (
      <div style={{ display: "grid", placeItems: "center", minHeight: "60vh", padding: "2rem" }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h2 style={{ color: "#b42318" }}>تعذر بدء جلسة الانتحال</h2>
          <p style={{ color: "#667085" }}>{error}</p>
          <a
            href="/login"
            style={{ display: "inline-block", marginTop: "1rem", color: "#4c8dff" }}
          >
            العودة لتسجيل الدخول
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "60vh" }}>
      <p style={{ color: "#667085" }}>جارٍ بدء الجلسة…</p>
    </div>
  );
}

export const Route = createFileRoute("/_public/impersonation")({
  validateSearch: (search: Record<string, string>) => ({
    token: (search.token ?? "") as string,
  }),
  beforeLoad: async ({ search }) => {
    // Presence check only — the exchange itself runs in the browser effect so
    // the rotated cookie lands on the admin's browser, not the server.
    if (!search.token) {
      throw redirect({ to: "/login", replace: true });
    }
  },
  component: ImpersonationLanding,
});
