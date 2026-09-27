// HTML rendering: page shell + shared UI atoms.
// Design language: Functional Grid (Müller-Brockmann) — strict 12-column
// alignment, hairline rules, mono labels, zero decoration. Status color
// semantics are fixed: ACTIVE green, SUSPENDED red, CLOSED gray, INVITED amber.

export function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const NAV = [
  { href: "/", label: "Overview" },
  { href: "/companies", label: "Companies" },
  { href: "/users", label: "Users" },
  { href: "/notifications", label: "Notify" },
  { href: "/sync", label: "Sync health" },
  { href: "/keys", label: "API keys" },
  { href: "/audit", label: "Audit" },
  { href: "/observability", label: "Observability" },
  { href: "/settings", label: "Settings" },
];

const BASE_CSS = `
:root{--bg:#0b0e14;--panel:#11151f;--panel2:#161b28;--line:#232a3a;--txt:#dfe5f1;--mut:#8a93a6;
--grn:#3fb96f;--red:#e05252;--amb:#d99a2b;--gry:#6b7280;--blu:#4c8dff}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--txt);margin:0;font-size:14px;line-height:1.45}
a{color:var(--blu);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1200px;margin:0 auto;padding:1.25rem}
header.top{border-bottom:1px solid var(--line);background:var(--panel)}
header.top .wrap{display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;padding-block:.7rem}
header.top .brand{font-weight:800;letter-spacing:.06em;text-transform:uppercase;font-size:.8rem;color:var(--mut);margin-right:.8rem}
header.top a.nav{color:var(--mut);padding:.35rem .6rem;border-radius:6px;font-size:.85rem}
header.top a.nav:hover{color:var(--txt);text-decoration:none}
header.top a.nav.on{color:var(--txt);background:var(--panel2)}
header.top form{margin-inline-start:auto}
h1{font-size:1.15rem;margin:.2rem 0 1rem;font-weight:700}
h2{font-size:.95rem;margin:0 0 .6rem}
.muted{color:var(--mut);font-size:.82rem;font-weight:400}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line)}
.grid.c2{grid-template-columns:repeat(2,1fr)}
.tile{background:var(--panel);padding:.9rem 1rem}
.tile .k{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--mut)}
.tile .v{font-size:1.55rem;font-weight:700;margin-top:.15rem;font-variant-numeric:tabular-nums}
.panel{background:var(--panel);border:1px solid var(--line);padding:1rem 1.1rem;margin-bottom:1.1rem}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{text-align:left;padding:.45rem .6rem;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--mut);font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;font-weight:600}
tbody tr:hover{background:var(--panel2)}
.pill{display:inline-block;border-radius:3px;padding:.08em .55em;font-size:.7rem;font-weight:700;letter-spacing:.04em}
.pill.ACTIVE,.pill.active{background:rgba(63,185,111,.15);color:var(--grn)}
.pill.SUSPENDED,.pill.suspended{background:rgba(224,82,82,.15);color:var(--red)}
.pill.CLOSED,.pill.closed{background:rgba(107,114,128,.18);color:var(--gry)}
.pill.INVITED,.pill.invited{background:rgba(217,154,43,.15);color:var(--amb)}
.pill.plat{background:rgba(76,141,255,.15);color:var(--blu)}
.pill.owner{background:var(--panel2);color:var(--mut);border:1px solid var(--line)}
button,.btn{padding:.42rem .8rem;border-radius:6px;border:1px solid var(--line);background:var(--panel2);color:var(--txt);font-size:.82rem;cursor:pointer}
button:hover{border-color:var(--mut)}
button.danger{border-color:rgba(224,82,82,.4);color:var(--red)}
button:disabled{opacity:.5;cursor:not-allowed}
input,select,textarea{padding:.5rem .65rem;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--txt);font-size:.85rem}
input:focus,select:focus,textarea:focus{outline:1px solid var(--blu)}
label.f{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:.7rem 0 .25rem}
.err{color:var(--red);font-size:.85rem;margin:.5rem 0}
.ok{color:var(--grn);font-size:.85rem;margin:.5rem 0}
.empty{color:var(--mut);padding:1.6rem;text-align:center;border:1px dashed var(--line);border-radius:6px;margin:.6rem 0}
.bar{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem}
.bar form{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem}
.banner{border:1px solid rgba(217,154,43,.45);background:rgba(217,154,43,.08);color:var(--amb);padding:.6rem .9rem;border-radius:6px;margin-bottom:1rem;font-size:.85rem}
footer{color:var(--mut);font-size:.75rem;padding:1rem 0 2rem}
@media(max-width:820px){.grid{grid-template-columns:repeat(2,1fr)}.grid.c2{grid-template-columns:1fr}}
`;

export function page(opts: {
  title: string;
  active: string;
  body: string;
  flash?: { kind: "ok" | "err"; text: string };
  metaDescription?: string;
}): string {
  const { title, active, body, flash, metaDescription } = opts;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(metaDescription ?? "Mawzun platform administration")}">
<title>${esc(title)} · Mawzun admin</title><style>${BASE_CSS}</style></head><body>
<header class="top"><div class="wrap">
<span class="brand">Mawzun Admin</span>
${NAV.map((n) => `<a class="nav${n.href === active ? " on" : ""}" href="${n.href}">${n.label}</a>`).join("")}
<form method="post" action="/logout"><button>Log out</button></form>
</div></header>
<main class="wrap">
${flash?.kind === "ok" ? `<div class="ok">${esc(flash.text)}</div>` : ""}
${flash?.kind === "err" ? `<div class="err">${esc(flash.text)}</div>` : ""}
${body}
</main>
<footer class="wrap">Mawzun platform admin · every action is audit-logged</footer>
</body></html>`;
}

export function notFoundPage(): string {
  return page({
    title: "Not found",
    active: "",
    body: `<div class="empty" style="margin-top:3rem"><h2>404 — Page not found</h2>
<p class="muted">The page you asked for does not exist.</p><p><a class="btn" href="/">Back to overview</a></p></div>`,
  });
}

export function errorPage(message?: string): string {
  return page({
    title: "Error",
    active: "",
    body: `<div class="empty" style="margin-top:3rem"><h2>Something went wrong</h2>
<p class="muted">${esc(message ?? "An unexpected error occurred. The in-app data was not modified.")}</p>
<p><a class="btn" href="/">Back to overview</a></p></div>`,
  });
}

export const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...headers } });

/** Read a POST body tolerantly: empty bodies parse to {} (skill gotcha). */
export async function readBody(request: Request): Promise<URLSearchParams | Record<string, unknown>> {
  const text = await request.text();
  const ct = request.headers.get("content-type") ?? "";
  if (!text) return {};
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return new URLSearchParams(text);
}

export function formStr(v: URLSearchParams | Record<string, unknown>, key: string): string {
  if (v instanceof URLSearchParams) return String(v.get(key) ?? "");
  const raw = v[key];
  return raw === undefined || raw === null ? "" : String(raw);
}
