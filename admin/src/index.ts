// Mawzun admin — password-gated platform back-office (single worker, no build).
//
// GET  /                overview stats + global search
// GET  /companies       all companies, search + filter
// GET  /companies/:id   company detail
// POST /companies/:id/status   suspend | activate | close (audit + session revoke)
// GET  /users           all users incl. company-less
// POST /users/:id/status       suspend | activate (stamp bump + revoke)
// POST /users/:id/logout       force logout
// POST /users/:id/impersonate  mint impersonation session → landing page
// POST /impersonation/:sessionId/end  revoke + audit end
// GET  /notifications   sent log + composer
// POST /notifications/send     single or broadcast (+ optional email copy)
// GET  /sync            cross-tenant sync-error triage + store freshness
// GET  /keys            API keys + revoke
// POST /keys/:id/revoke
// GET  /audit           global audit trail
// GET  /settings        ADMIN_EMAIL + NOTIFY_EMAIL toggle
// POST /settings
// POST /login /logout

import { withSql, withLogsSql, type Env, type Sql } from "./db.js";
import { mintSession, validSession, passwordMatches, sessionCookie, clearSessionCookie } from "./session.js";
import { page, notFoundPage, errorPage, html, esc, readBody, formStr } from "./render.js";
import * as q from "./queries.js";
import * as m from "./mutations.js";
import { sendEmail, notifEmailHtml } from "./mailer.js";

function pill(status: string): string {
  return `<span class="pill ${esc(status)}">${esc(status)}</span>`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 16).replace("T", " ");
}

function empty(msg: string): string {
  return `<div class="empty">${esc(msg)}</div>`;
}

/**
 * Trims a long value for a table cell, with an ellipsis so it is visibly cut.
 *
 * Used for User-Agent strings, ids and bodies — all of which are unbounded in
 * length and would otherwise stretch a row until the table is unreadable. The
 * full value is always available in the cell's `title`.
 */
function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  // Back off one code unit if the cut would split a surrogate pair, which would
  // render as a broken character rather than an ellipsis.
  let cut = max - 1;
  const code = value.charCodeAt(cut);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return value.slice(0, cut) + "…";
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function overviewBody(stats: q.StatsRow, results: q.SearchResult[], query: string): string {
  return `
<h1>Overview <span class="muted">everything on one grid</span></h1>
<form method="get" action="/" class="bar">
  <input type="search" name="q" value="${esc(query)}" placeholder="Global search: company, user email, order number…" style="min-width:340px">
  <button>Search</button>
</form>
${query && results.length === 0 ? empty(`No matches for “${query}”.`) : ""}
${results.length ? `<div class="panel"><h2>Search results</h2><table><thead><tr><th>Kind</th><th>Label</th><th>Detail</th><th></th></tr></thead><tbody>
${results.map((r) => `<tr><td><span class="pill plat">${r.kind}</span></td><td>${esc(r.label)}</td><td class="muted">${esc(r.sub)}</td><td><a href="${esc(r.href)}">open →</a></td></tr>`).join("")}
</tbody></table></div>` : ""}
<div class="grid">
  <div class="tile"><div class="k">Companies</div><div class="v">${stats.companiesTotal}</div><div class="muted">${stats.companiesActive} active · ${stats.companiesSuspended} suspended · ${stats.companiesClosed} closed</div></div>
  <div class="tile"><div class="k">Signups (30d)</div><div class="v">${stats.signups30d}</div><div class="muted">new companies</div></div>
  <div class="tile"><div class="k">Users</div><div class="v">${stats.usersTotal}</div><div class="muted">${stats.usersSuspended} suspended</div></div>
  <div class="tile"><div class="k">Active sessions</div><div class="v">${stats.activeSessions}</div><div class="muted">live refresh windows</div></div>
  <div class="tile"><div class="k">Products</div><div class="v">${stats.productsTotal}</div><div class="muted">across all companies</div></div>
  <div class="tile"><div class="k">Orders</div><div class="v">${stats.ordersTotal}</div><div class="muted">${stats.orders7d} in last 7 days</div></div>
  <div class="tile"><div class="k">Stores</div><div class="v">${stats.storesTotal}</div><div class="muted">connected channels</div></div>
  <div class="tile"><div class="k">Pending sync errors</div><div class="v" style="${stats.syncErrorsPending > 0 ? "color:var(--red)" : ""}">${stats.syncErrorsPending}</div><div class="muted"><a href="/sync">triage →</a></div></div>
</div>`;
}

function companiesBody(rows: q.CompanyListRow[], search: string, status: string): string {
  return `
<h1>Companies <span class="muted">${rows.length} shown (limit 200)</span></h1>
<form method="get" action="/companies" class="bar">
  <input type="search" name="q" value="${esc(search)}" placeholder="Name, slug, owner email…">
  <select name="status"><option value="">Any status</option>
    ${["ACTIVE", "SUSPENDED", "CLOSED"].map((s) => `<option value="${s}"${status === s ? " selected" : ""}>${s}</option>`).join("")}
  </select>
  <button>Filter</button>
</form>
${rows.length === 0 ? empty("No companies match.") : `<div class="panel"><table><thead><tr><th>Company</th><th>Status</th><th>Owner</th><th>Users</th><th>Products</th><th>Orders 7d</th><th>Created</th></tr></thead><tbody>
${rows.map((r) => `<tr>
  <td><a href="/companies/${esc(r.id)}"><strong>${esc(r.name)}</strong></a><div class="muted mono">${esc(r.slug)}</div></td>
  <td>${pill(r.status)}</td>
  <td>${esc(r.ownerName ?? "—")}<div class="muted">${esc(r.ownerEmail ?? "")}</div></td>
  <td>${r.userCount}</td><td>${r.productCount}</td><td>${r.orders7d}</td>
  <td class="muted">${fmtDate(r.createdAt)}</td></tr>`).join("")}
</tbody></table></div>`}`;
}

function companyDetailBody(
  c: q.CompanyListRow,
  d: q.CompanyDetail | null,
  users: q.UserRow[],
  stores: q.StoreRow[],
  syncErrors: q.SyncErrorRow[],
  audit: q.AuditRow[],
  notices: q.NotificationRow[]
): string {
  return `
<h1>${esc(c.name)} <span class="muted mono">${esc(c.slug)}</span></h1>
<div class="grid c2">
  <div class="tile"><div class="k">Status</div><div class="v">${pill(c.status)}</div>
    ${d?.suspendedAt ? `<div class="muted">since ${fmtDate(d.suspendedAt)} — ${esc(d.suspensionReason ?? "no reason recorded")}</div>` : ""}</div>
  <div class="tile"><div class="k">Created</div><div class="v" style="font-size:1rem">${fmtDate(c.createdAt)}</div>
    <div class="muted">${esc(d?.countryCode ?? "")} · ${esc(d?.currencyCode ?? "")}</div></div>
</div>
<div class="panel">
  <h2>Actions</h2>
  <div class="bar">
    ${c.status !== "ACTIVE" ? `<form method="post" action="/companies/${esc(c.id)}/status"><input type="hidden" name="status" value="ACTIVE"><button>Reactivate</button></form>` : ""}
    ${c.status === "ACTIVE" ? `<form method="post" action="/companies/${esc(c.id)}/status" onsubmit="const r=prompt('Suspension reason:');if(!r)return false;this.querySelector('[name=reason]').value=r"><input type="hidden" name="status" value="SUSPENDED"><input type="hidden" name="reason"><button class="danger">Suspend (revokes all sessions)</button></form>` : ""}
    ${c.status !== "CLOSED" ? `<form method="post" action="/companies/${esc(c.id)}/status" onsubmit="return confirm('Close this company? This revokes all sessions.')"><input type="hidden" name="status" value="CLOSED"><button class="danger">Close</button></form>` : ""}
    <a class="btn" href="/notifications?company=${esc(c.id)}">Compose notification →</a>
  </div>
</div>
<div class="panel"><h2>Users (${users.length})</h2>
${users.length === 0 ? empty("No users.") : `<table><thead><tr><th>User</th><th>Status</th><th>Role</th><th>Last login</th><th>Sessions</th><th>Actions</th></tr></thead><tbody>
${users.map((u) => `<tr>
  <td>${esc(u.fullName)} ${u.isOwner ? '<span class="pill owner">owner</span>' : ""}<div class="muted">${esc(u.email)}</div></td>
  <td>${pill(u.status)}</td>
  <td class="muted">${esc(u.roles || "—")}</td>
  <td class="muted">${fmtDate(u.lastLoginAt)}</td>
  <td>${u.sessionCount}</td>
  <td>
    ${u.status === "ACTIVE" ? `<form method="post" action="/users/${esc(u.id)}/impersonate" style="display:inline"><button title="Log in as this user">Log in as</button></form>` : ""}
    ${u.status === "ACTIVE" ? `<form method="post" action="/users/${esc(u.id)}/status" style="display:inline"><input type="hidden" name="status" value="SUSPENDED"><button class="danger">Suspend</button></form>` : ""}
    ${u.status === "SUSPENDED" ? `<form method="post" action="/users/${esc(u.id)}/status" style="display:inline"><input type="hidden" name="status" value="ACTIVE"><button>Activate</button></form>` : ""}
    <form method="post" action="/users/${esc(u.id)}/logout" style="display:inline"><button title="Revoke all sessions now">Force logout</button></form>
  </td></tr>`).join("")}
</tbody></table>`}
</div>
<div class="panel"><h2>Stores (${stores.length})</h2>
${stores.length === 0 ? empty("No connected stores.") : `<table><thead><tr><th>Store</th><th>Platform</th><th>Active</th><th>Last sync</th><th>Pending errors</th></tr></thead><tbody>
${stores.map((s) => `<tr><td>${esc(s.name)}<div class="muted mono">${esc(s.storeUrl)}</div></td><td>${esc(s.platform)}</td><td>${s.isActive ? "yes" : "no"}</td><td class="muted">${fmtDate(s.lastSyncedAt)}</td><td>${s.errorCount > 0 ? `<span class="pill SUSPENDED">${s.errorCount}</span>` : "0"}</td></tr>`).join("")}
</tbody></table>`}
</div>
<div class="panel"><h2>Recent sync errors (${syncErrors.length})</h2>
${syncErrors.length === 0 ? empty("No sync errors.") : `<table><thead><tr><th>When</th><th>Type</th><th>Message</th><th>Status</th></tr></thead><tbody>
${syncErrors.map((e) => `<tr><td class="muted">${fmtDate(e.createdAt)}</td><td class="mono">${esc(e.errorType)}</td><td>${esc(e.errorMessage.slice(0, 140))}</td><td>${pill(e.status)}</td></tr>`).join("")}
</tbody></table>`}
</div>
<div class="panel"><h2>Recent notifications (${notices.length})</h2>
${notices.length === 0 ? empty("None sent to this company.") : `<table><thead><tr><th>When</th><th>Title</th><th>Category</th><th>To</th><th>Read</th></tr></thead><tbody>
${notices.map((n) => `<tr><td class="muted">${fmtDate(n.createdAt)}</td><td>${esc(n.title)}</td><td>${esc(n.category)}</td><td class="muted">${esc(n.userEmail ?? "company-wide")}</td><td>${n.isRead ? "yes" : "no"}</td></tr>`).join("")}
</tbody></table>`}
</div>
<div class="panel"><h2>Recent audit entries</h2>
${audit.length === 0 ? empty("No audit rows.") : `<table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Summary</th></tr></thead><tbody>
${audit.map((a) => `<tr><td class="muted">${fmtDate(a.createdAt)}</td><td class="muted">${esc(a.actorEmail ?? "system")}</td><td class="mono">${esc(a.action)}</td><td>${esc(a.summary ?? "")}</td></tr>`).join("")}
</tbody></table>`}
</div>`;
}

function usersBody(rows: q.UserRow[], search: string, status: string): string {
  return `
<h1>Users <span class="muted">${rows.length} shown (limit 300)</span></h1>
<form method="get" action="/users" class="bar">
  <input type="search" name="q" value="${esc(search)}" placeholder="Name, email, company…">
  <select name="status"><option value="">Any status</option>
    ${["INVITED", "ACTIVE", "SUSPENDED"].map((s) => `<option value="${s}"${status === s ? " selected" : ""}>${s}</option>`).join("")}
  </select>
  <button>Filter</button>
</form>
${rows.length === 0 ? empty("No users match.") : `<div class="panel"><table><thead><tr><th>User</th><th>Company</th><th>Status</th><th>Roles</th><th>Last login</th><th>Sessions</th><th>Actions</th></tr></thead><tbody>
${rows.map((u) => `<tr>
  <td>${esc(u.fullName)} ${u.isPlatformAdmin ? '<span class="pill plat">platform</span>' : ""} ${u.isOwner ? '<span class="pill owner">owner</span>' : ""}<div class="muted">${esc(u.email)}</div></td>
  <td>${u.companyId ? `<a href="/companies/${esc(u.companyId)}">${esc(u.companyName ?? "")}</a>` : '<span class="muted">no company</span>'}</td>
  <td>${pill(u.status)}</td>
  <td class="muted">${esc(u.roles || "—")}</td>
  <td class="muted">${fmtDate(u.lastLoginAt)}</td>
  <td>${u.sessionCount}</td>
  <td>
    ${!u.isPlatformAdmin && u.status === "ACTIVE" ? `<form method="post" action="/users/${esc(u.id)}/impersonate" style="display:inline"><button>Log in as</button></form>` : ""}
    ${!u.isPlatformAdmin && u.status === "ACTIVE" ? `<form method="post" action="/users/${esc(u.id)}/status" style="display:inline"><input type="hidden" name="status" value="SUSPENDED"><button class="danger">Suspend</button></form>` : ""}
    ${!u.isPlatformAdmin && u.status === "SUSPENDED" ? `<form method="post" action="/users/${esc(u.id)}/status" style="display:inline"><input type="hidden" name="status" value="ACTIVE"><button>Activate</button></form>` : ""}
    <form method="post" action="/users/${esc(u.id)}/logout" style="display:inline"><button>Force logout</button></form>
  </td></tr>`).join("")}
</tbody></table></div>

<div class="panel"><h2>Live impersonations (${rows.filter(() => false).length ? "" : ""}see audit for history)</h2></div>`}`;
}

function notificationsBody(
  rows: q.NotificationRow[],
  companies: q.CompanyListRow[],
  selectedCompany: string,
  impersonations: q.ImpersonationRow[]
): string {
  return `
<h1>Notifications <span class="muted">in-app always · email optional</span></h1>
<div class="panel">
  <h2>Compose</h2>
  <form method="post" action="/notifications/send">
    <label class="f">Audience</label>
    <select name="companyId" required>
      <option value="">— pick a company —</option>
      ${companies.map((c) => `<option value="${esc(c.id)}"${selectedCompany === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}
      <option value="__BROADCAST__">🔊 BROADCAST — every active/suspended company</option>
    </select>
    <label class="f">Category</label>
    <select name="category">
      ${["GENERAL", "ORDER", "INVENTORY", "SYSTEM"].map((cat) => `<option>${cat}</option>`).join("")}
    </select>
    <label class="f">Title (required, ≤200 chars)</label>
    <input name="title" maxlength="200" required style="width:100%">
    <label class="f">Message (≤2000 chars)</label>
    <textarea name="message" maxlength="2000" rows="3" style="width:100%"></textarea>
    <label class="f">In-app link (optional, e.g. /dashboard/orders)</label>
    <input name="link" style="width:100%">
    <label class="f" style="text-transform:none;letter-spacing:0">
      <input type="checkbox" name="emailCopy" value="1" style="width:auto"> Also email a copy to ADMIN_EMAIL (if set + toggle on)
    </label>
    <div style="margin-top:.8rem"><button>Send</button></div>
  </form>
</div>
${impersonations.length ? `<div class="banner">Active impersonations: ${impersonations.map((i) => `${esc(i.userEmail)} (by ${esc(i.impersonatedBy ?? "?")}, since ${fmtDate(i.startedAt)}) <form method="post" action="/impersonation/${esc(i.sessionId)}/end" style="display:inline"><button>End</button></form>`).join(" · ")}</div>` : ""}
<div class="panel"><h2>Sent (last 100)</h2>
${rows.length === 0 ? empty("Nothing sent yet.") : `<table><thead><tr><th>When</th><th>Company</th><th>To</th><th>Title</th><th>Category</th><th>Read</th></tr></thead><tbody>
${rows.map((n) => `<tr><td class="muted">${fmtDate(n.createdAt)}</td><td>${esc(n.companyName)}</td><td class="muted">${esc(n.userEmail ?? "company-wide")}</td><td>${esc(n.title)}</td><td>${esc(n.category)}</td><td>${n.isRead ? "yes" : "no"}</td></tr>`).join("")}
</tbody></table>`}
</div>`;
}

function syncBody(errors: q.SyncErrorRow[], stores: q.StoreRow[], status: string): string {
  return `
<h1>Sync health <span class="muted">cross-tenant triage</span></h1>
<form method="get" action="/sync" class="bar">
  <select name="status">${["PENDING", "RESOLVED", "IGNORED"].map((s) => `<option${status === s ? " selected" : ""}>${s}</option>`).join("")}</select>
  <button>Filter</button>
</form>
<div class="panel"><h2>Sync errors (${errors.length})</h2>
${errors.length === 0 ? empty("Nothing pending — clean 🎉") : `<table><thead><tr><th>When</th><th>Company</th><th>Store</th><th>Type</th><th>Message</th><th>Retries</th></tr></thead><tbody>
${errors.map((e) => `<tr><td class="muted">${fmtDate(e.createdAt)}</td><td><a href="/companies/${esc(e.companyId)}">${esc(e.companyName)}</a></td><td>${esc(e.storeName)}</td><td class="mono">${esc(e.errorType)}</td><td>${esc(e.errorMessage.slice(0, 160))}</td><td>${e.retryCount}</td></tr>`).join("")}
</tbody></table>`}
</div>
<div class="panel"><h2>Stores by freshness (${stores.length})</h2>
${stores.length === 0 ? empty("No stores connected anywhere.") : `<table><thead><tr><th>Store</th><th>Company</th><th>Platform</th><th>Last sync</th><th>Pending errors</th></tr></thead><tbody>
${stores.map((s) => `<tr><td>${esc(s.name)}</td><td><a href="/companies/${esc(s.companyId)}">${esc(s.companyName)}</a></td><td>${esc(s.platform)}</td><td class="muted">${fmtDate(s.lastSyncedAt)}</td><td>${s.errorCount > 0 ? `<span class="pill SUSPENDED">${s.errorCount}</span>` : "0"}</td></tr>`).join("")}
</tbody></table>`}
</div>`;
}

function keysBody(rows: q.ApiKeyRow[]): string {
  return `
<h1>API keys <span class="muted">${rows.length} shown</span></h1>
${rows.length === 0 ? empty("No API keys issued.") : `<div class="panel"><table><thead><tr><th>Key</th><th>Company</th><th>Status</th><th>Last used</th><th>Expires</th><th>Actions</th></tr></thead><tbody>
${rows.map((k) => {
  const revoked = Boolean(k.revokedAt);
  return `<tr><td>${esc(k.name)}<div class="muted mono">${esc(k.keyPrefix)}…</div></td>
  <td><a href="/companies/${esc(k.companyId)}">${esc(k.companyName)}</a></td>
  <td>${revoked ? '<span class="pill CLOSED">revoked</span>' : k.isActive ? pill("ACTIVE") : '<span class="pill CLOSED">inactive</span>'}</td>
  <td class="muted">${fmtDate(k.lastUsedAt)}</td><td class="muted">${fmtDate(k.expiresAt)}</td>
  <td>${!revoked ? `<form method="post" action="/keys/${esc(k.id)}/revoke" onsubmit="return confirm('Revoke this key?')"><button class="danger">Revoke</button></form>` : ""}</td></tr>`;
}).join("")}
</tbody></table></div>`}`;
}

function auditBody(rows: q.AuditRow[], search: string): string {
  return `
<h1>Audit trail <span class="muted">${rows.length} recent entries</span></h1>
<form method="get" action="/audit" class="bar">
  <input type="search" name="q" value="${esc(search)}" placeholder="Action, entity, summary, actor…">
  <button>Search</button>
</form>
${rows.length === 0 ? empty("No audit entries match.") : `<div class="panel"><table><thead><tr><th>When</th><th>Actor</th><th>Company</th><th>Action</th><th>Entity</th><th>Summary</th><th>IP</th></tr></thead><tbody>
${rows.map((a) => `<tr><td class="muted">${fmtDate(a.createdAt)}</td><td class="muted">${esc(a.actorEmail ?? "system")}</td><td>${esc(a.companyName ?? "—")}</td><td class="mono">${esc(a.action)}</td><td class="muted">${esc(a.entity)}${a.entityId ? ` <span class="mono">${esc(a.entityId.slice(0, 8))}…</span>` : ""}</td><td>${esc(a.summary ?? "")}</td><td class="muted mono">${esc(a.ipAddress ?? "")}</td></tr>`).join("")}
</tbody></table></div>`}`;
}


function observabilityBody(stats: q.StatsRow, breadcrumbs: q.ErrorBreadcrumbRow[], env: Env): string {
  const grafanaBase = env.GRAFANA_BASE_URL ?? "";
  const links = grafanaBase
    ? `<div class="panel"><h3 style="margin-top:0">Grafana Cloud</h3>
<p class="muted">Full dashboards, logs and alerting live in Grafana Cloud (opens in a new tab, uses your Grafana login).</p>
<div style="display:flex;gap:.75rem;flex-wrap:wrap">
  <a class="btn" href="${esc(grafanaBase)}" target="_blank" rel="noreferrer">Open Grafana →</a>
  <a class="btn" href="${esc(grafanaBase + "/explore")}" target="_blank" rel="noreferrer">Explore metrics →</a>
  <a class="btn" href="${esc(grafanaBase + "/alerting/notifications")}" target="_blank" rel="noreferrer">Alert rules →</a>
</div>
<p class="muted mono" style="margin-bottom:0">remote write: ${esc(env.GRAFANA_METRICS_PUSH_URL ?? "not configured")}</p></div>`
    : `<div class="panel"><h3 style="margin-top:0">Grafana Cloud</h3><p class="muted">Set the <span class="mono">GRAFANA_BASE_URL</span> worker var to show dashboard deep links here.</p><p class="muted mono" style="margin-bottom:0">remote write: ${esc(env.GRAFANA_METRICS_PUSH_URL ?? "not configured")}</p></div>`;

  const health = [
    { label: "Active companies", value: stats.companiesActive, sub: `${stats.companiesTotal} total · ${stats.companiesSuspended} suspended` },
    { label: "Total users", value: stats.usersTotal, sub: `${stats.usersSuspended} suspended · ${stats.activeSessions} live sessions` },
    { label: "Pending sync errors", value: stats.syncErrorsPending, sub: stats.syncErrorsPending > 0 ? "needs triage" : "clean" },
    { label: "Orders (7d)", value: stats.orders7d, sub: `${stats.ordersTotal} all-time` },
  ]
    .map(
      (t) =>
        `<div class="tile"><div class="k">${t.label}</div><div class="v" style="${t.value > 0 && t.label.includes("sync") ? "color:var(--amb)" : ""}">${t.value}</div><div class="muted">${t.sub}</div></div>`
    )
    .join("");

  const crumbs =
    breadcrumbs.length === 0
      ? empty("No errors recorded — clean 🎉")
      : `<div class="panel"><table><thead><tr><th>When</th><th>Source</th><th>Route</th><th>Status</th><th>Client</th><th>Message</th><th>Body</th><th>Request</th></tr></thead><tbody>
${breadcrumbs
    .map(
      (b) => {
        // The client column answers "who and from where" — the difference
        // between one user's bad input and an outage. The tenant id is shown
        // alongside so a breadcrumb can be tied to a report without a lookup.
        const client = [
          b.ipAddress ? esc(b.ipAddress) : null,
          b.userAgent ? `<span class="muted">${esc(shorten(b.userAgent, 40))}</span>` : null,
          b.userId ? `<span class="muted mono">user ${esc(shorten(b.userId, 12))}</span>` : null,
          b.companyId ? `<span class="muted mono">co ${esc(shorten(b.companyId, 12))}</span>` : null,
        ]
          .filter(Boolean)
          .join("<br>");

        // The body is already redacted before it is stored; shown in a title so
        // the table stays readable, with the full value available on hover.
        const body = b.body
          ? `<code class="mono muted" style="font-size:.75rem" title="${esc(b.body)}">${esc(shorten(b.body, 60))}</code>`
          : `<span class="muted">—</span>`;

        return `<tr><td class="muted">${fmtDate(b.createdAt)}</td><td class="muted">${esc(b.source)}</td><td class="mono">${esc(b.route ?? "—")}${b.method ? ` <span class="muted">${esc(b.method)}</span>` : ""}</td><td class="mono" style="${(b.status ?? 0) >= 500 ? "color:var(--red)" : ""}">${b.status ?? "—"}</td><td style="font-size:.78rem">${client || "—"}</td><td>${esc(b.message)}</td><td>${body}</td><td class="muted mono">${esc(b.requestId ?? "")}</td></tr>`;
      }
    )
    .join("")}
</tbody></table></div>`;

  return `
<h1>Observability <span class="muted">errors · metrics · alerts</span></h1>
<div class="tiles">${health}</div>
${links}
<h3 style="margin-bottom:.5rem">Error breadcrumbs <span class="muted">${breadcrumbs.length} most recent (of 200 kept)</span></h3>
${crumbs}
<p class="muted">Breadcrumbs are captured by the Backend on handled errors (4xx/409) and unhandled ones (5xx), with the client IP, User-Agent and the <strong>redacted</strong> request body — passwords, tokens and cookies are stripped before the write, and <span class="mono">/auth/*</span> bodies are withheld entirely. The table keeps the newest 200 rows; this view shows the latest 50. API errors feed the <span class="mono">mawzun_http_errors_total</span> counter pushed to Grafana every 15s.</p>`;
}
function settingsBody(adminEmail: string, notifyEmail: string, saved: boolean): string {
  return `
<h1>Settings</h1>
${saved ? '<div class="ok">Settings saved.</div>' : ""}
<div class="panel">
  <form method="post" action="/settings">
    <label class="f">ADMIN_EMAIL — receives email copies of notifications</label>
    <input name="adminEmail" type="email" value="${esc(adminEmail)}" placeholder="ops@mawzun.org" style="width:100%">
    <label class="f" style="text-transform:none;letter-spacing:0;margin-top:1rem">
      <input type="checkbox" name="notifyEmail" value="1" style="width:auto"${notifyEmail === "1" ? " checked" : ""}> Email me a copy when I send a notification (default OFF — in-app always works)
    </label>
    <div style="margin-top:1rem"><button>Save settings</button></div>
  </form>
  <p class="muted">The toggle and recipient persist in the <span class="mono">platform_settings</span> table (keys <span class="mono">admin.notifications.email</span>, <span class="mono">admin.notifications.recipient</span>). Mailtrap credentials come from worker secrets: MAILTRAP__APITOKEN. With the toggle OFF no email is ever sent; in-app notifications always work.</p>
</div>`;
}

function impersonationLanding(appOrigin: string, refreshToken: string, userName: string, sessionId: string): string {
  return page({
    title: "Impersonation ready",
    active: "/users",
    body: `
<h1>Impersonation session minted</h1>
<div class="banner">You are about to open <strong>${esc(userName)}</strong>'s workspace as an impersonated session. Everything is audit-logged (start + end). The session auto-expires in 8 hours, and ends immediately when you click "End impersonation" here.</div>
<div class="panel">
  <h2>Step 1 — open the app</h2>
  <p><a class="btn" href="${esc(appOrigin)}/impersonation?token=${encodeURIComponent(refreshToken)}" target="_blank" rel="noopener">Open app as ${esc(userName)} →</a></p>
  <p class="muted">The link carries the one-time refresh token; the app exchanges it via <span class="mono">POST /auth/refresh</span> and you land logged in as the user. A banner on every page announces the impersonation.</p>
  <h2>Step 2 — end it</h2>
  <form method="post" action="/impersonation/${esc(sessionId)}/end"><button class="danger">End impersonation now</button></form>
</div>`,
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch (e) {
      console.error("admin worker error:", e);
      return html(errorPage(e instanceof Error ? e.message : undefined), 500);
    }
  },
};

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!env.ADMIN_PASSWORD) return new Response("ADMIN_PASSWORD not set", { status: 500 });

  if (path === "/login" && request.method === "POST") {
    const form = await request.formData();
    const ok = await passwordMatches(String(form.get("password") ?? ""), env.ADMIN_PASSWORD);
    if (!ok) return html(gatePage("Wrong password."), 401);
    return new Response(null, {
      status: 303,
      headers: { Location: "/", "Set-Cookie": sessionCookie(await mintSession(env.ADMIN_PASSWORD)) },
    });
  }
  if (path === "/logout" && request.method === "POST") {
    return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": clearSessionCookie() } });
  }

  const authed = await validSession(request, env.ADMIN_PASSWORD);
  if (!authed) return html(gatePage(), 401);

  const body = await withSql(env, (sql) => routeInSql(request, env, url, sql));
  return body ?? html(notFoundPage(), 404);
}

function gatePage(error?: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mawzun admin</title><style>
body{font-family:system-ui,sans-serif;background:#0b0e14;color:#dfe5f1;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#11151f;padding:2rem;border-radius:12px;display:flex;flex-direction:column;gap:1rem;min-width:280px;border:1px solid #232a3a}
h2{margin:0;font-size:1rem;letter-spacing:.06em;text-transform:uppercase;color:#8a93a6}
input{padding:.6rem .8rem;border-radius:6px;border:1px solid #232a3a;background:#0b0e14;color:#fff;font-size:1rem}
button{padding:.6rem;border-radius:6px;border:0;background:#4c8dff;color:#fff;font-weight:700;cursor:pointer;font-size:1rem}
.err{color:#e05252;font-size:.9rem}</style></head><body>
<form method="post" action="/login"><h2>Mawzun admin</h2>
${error ? `<div class="err">${esc(error)}</div>` : ""}
<input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required>
<button>Enter</button></form></body></html>`;
}

async function routeInSql(request: Request, env: Env, url: URL, sql: Sql): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;
  const q_ = url.searchParams;
    const auditBase = {
      actorId: await m.resolvePlatformAdminActor(sql),
      ipAddress: request.headers.get("cf-connecting-ip") ?? null,
    };

    // ---------- GET pages ----------
    if (method === "GET" && path === "/") {
      const search = q_.get("q")?.trim() ?? "";
      const stats = await q.loadStats(sql);
      const results = search ? await q.globalSearch(sql, search) : [];
      return html(page({ title: "Overview", active: "/", body: overviewBody(stats, results, search) }));
    }

    if (method === "GET" && path === "/companies") {
      const search = q_.get("q")?.trim() ?? "";
      const status = q_.get("status") ?? "";
      const rows = await q.loadCompanies(sql, search, status);
      return html(page({ title: "Companies", active: "/companies", body: companiesBody(rows, search, status) }));
    }

    const companyMatch = path.match(/^\/companies\/([^/]+)$/);
    if (method === "GET" && companyMatch) {
      const id = companyMatch[1];
      const c = await q.loadCompany(sql, id);
      if (!c) return null;
      const [detail, users, stores, syncErrors, audit, notices] = await Promise.all([
        q.loadCompanyDetail(sql, id),
        q.loadUsers(sql, "", "", id),
        (await q.loadStores(sql)).filter((s) => s.companyId === id),
        (await q.loadSyncErrors(sql, "PENDING")).filter((e) => e.companyId === id).slice(0, 10),
        (await q.loadAudit(sql, "", 40)).filter((a) => a.companyName === c.name).slice(0, 10),
        (await q.loadNotifications(sql)).filter((n) => n.companyName === c.name).slice(0, 10),
      ]);
      return html(page({ title: c.name, active: "/companies", body: companyDetailBody(c, detail, users, stores, syncErrors, audit, notices) }));
    }

    if (method === "GET" && path === "/users") {
      const search = q_.get("q")?.trim() ?? "";
      const status = q_.get("status") ?? "";
      const rows = await q.loadUsers(sql, search, status);
      return html(page({ title: "Users", active: "/users", body: usersBody(rows, search, status) }));
    }

    if (method === "GET" && path === "/notifications") {
      const [rows, companies, impersonations] = await Promise.all([
        q.loadNotifications(sql),
        q.loadCompanies(sql, "", ""),
        q.loadActiveImpersonations(sql),
      ]);
      const sent = q_.get("sent");
      const flash = sent
        ? { kind: "ok" as const, text: sent === "1" ? "Notification sent." : `Broadcast sent to ${q_.get("count") ?? ""} companies.` }
        : undefined;
      return html(page({ title: "Notifications", active: "/notifications", body: notificationsBody(rows, companies, q_.get("company") ?? "", impersonations), flash }));
    }

    if (method === "GET" && path === "/sync") {
      const status = q_.get("status") ?? "PENDING";
      const [errors, stores] = await Promise.all([q.loadSyncErrors(sql, status), q.loadStores(sql)]);
      return html(page({ title: "Sync health", active: "/sync", body: syncBody(errors, stores, status) }));
    }

    if (method === "GET" && path === "/keys") {
      const rows = await q.loadApiKeys(sql);
      return html(page({ title: "API keys", active: "/keys", body: keysBody(rows) }));
    }

    if (method === "GET" && path === "/audit") {
      const search = q_.get("q")?.trim() ?? "";
      const rows = await q.loadAudit(sql, search);
      return html(page({ title: "Audit", active: "/audit", body: auditBody(rows, search) }));
    }

    if (method === "GET" && path === "/observability") {
      const stats = await q.loadStats(sql);
      const breadcrumbs = await withLogsSql(env, (logsSql) => q.loadErrorBreadcrumbs(logsSql, sql, 50));
      return html(page({ title: "Observability", active: "/observability", body: observabilityBody(stats, breadcrumbs, env) }));
    }

    if (method === "GET" && path === "/settings") {
      const rows = (await sql`SELECT key, value FROM platform_settings WHERE key LIKE 'admin.notifications.%'`) as unknown as { key: string; value: string }[];
      const recipient = rows.find((r) => r.key === "admin.notifications.recipient")?.value ?? env.ADMIN_EMAIL ?? "";
      const emailOn = (rows.find((r) => r.key === "admin.notifications.email")?.value ?? env.NOTIFY_EMAIL ?? "0") === "1";
      const saved = q_.get("saved") === "1";
      return html(page({ title: "Settings", active: "/settings", body: settingsBody(recipient, emailOn ? "1" : "0", saved) }));
    }

    // ---------- POST actions ----------
    if (method === "POST" && path.match(/^\/companies\/([^/]+)\/status$/)) {
      const id = path.split("/")[2];
      const input = await readBody(request);
      const status = formStr(input, "status");
      if (!["ACTIVE", "SUSPENDED", "CLOSED"].includes(status)) return html(errorPage("Bad status"), 400);
      const revoked = await m.setCompanyStatus(sql, id, status as m.CompanyStatus, formStr(input, "reason") || undefined, auditBase);
      if (revoked === null) return null;
      return Response.redirect(new URL(`/companies/${id}`, url.origin).toString(), 303);
    }

    if (method === "POST" && path.match(/^\/users\/([^/]+)\/status$/)) {
      const id = path.split("/")[2];
      const input = await readBody(request);
      const status = formStr(input, "status");
      if (!["ACTIVE", "SUSPENDED", "INVITED"].includes(status)) return html(errorPage("Bad status"), 400);
      const result = await m.setUserStatus(sql, id, status as m.UserStatus, auditBase);
      if (result === "notfound") return null;
      if (result === "owner-protected") {
        return html(page({ title: "Cannot suspend owner", active: "/users", body: `<div class="banner">Company owners cannot be suspended while their company exists — suspend the COMPANY instead (that revokes every user's sessions).</div><p><a class="btn" href="/users">Back to users</a></p>` }), 409);
      }
      if (result === "platform-admin" || result === "self") {
        return html(page({ title: "Blocked", active: "/users", body: `<div class="banner">Platform admin accounts cannot be managed from the admin UI.</div><p><a class="btn" href="/users">Back to users</a></p>` }), 409);
      }
      return Response.redirect(new URL("/users", url.origin).toString(), 303);
    }

    if (method === "POST" && path.match(/^\/users\/([^/]+)\/logout$/)) {
      const id = path.split("/")[2];
      await m.forceLogoutUser(sql, id, auditBase);
      return Response.redirect(new URL("/users", url.origin).toString(), 303);
    }

    if (method === "POST" && path.match(/^\/users\/([^/]+)\/impersonate$/)) {
      const id = path.split("/")[2];
      const adminEmail = env.ADMIN_EMAIL || auditBase.actorId || "platform-admin";
      const target = await m.startImpersonation(sql, id, adminEmail, auditBase);
      if (target.result !== "ok") {
        const why: Record<string, string> = {
          notfound: "User not found.",
          "platform-admin": "Cannot impersonate a platform admin.",
          suspended: "User is not ACTIVE.",
          "already-active": "An impersonation session for this user is already live — end it first (Notifications page).",
        };
        return html(page({ title: "Cannot impersonate", active: "/users", body: `<div class="banner">${esc(why[target.result] ?? "Blocked")}</div><p><a class="btn" href="/users">Back to users</a></p>` }), 409);
      }
      const appOrigin = env.APP_ORIGIN || "https://app.mawzun.org";
      return html(impersonationLanding(appOrigin, target.refreshToken!, target.userName!, target.sessionId!));
    }

    if (method === "POST" && path.match(/^\/impersonation\/([^/]+)\/end$/)) {
      const sessionId = path.split("/")[2];
      const result = await m.endImpersonation(sql, sessionId, auditBase);
      if (result === "notfound") return null;
      return Response.redirect(new URL("/audit", url.origin).toString(), 303);
    }

    if (method === "POST" && path === "/notifications/send") {
      const input = await readBody(request);
      const title = formStr(input, "title").trim();
      if (!title) return html(page({ title: "Notifications", active: "/notifications", body: '<div class="err">Title is required.</div>' }), 400);
      const message = formStr(input, "message");
      const category = (["GENERAL", "ORDER", "INVENTORY", "SYSTEM"].includes(formStr(input, "category")) ? formStr(input, "category") : "GENERAL") as "GENERAL" | "ORDER" | "INVENTORY" | "SYSTEM";
      const link = formStr(input, "link").trim() || null;
      const emailCopy = formStr(input, "emailCopy") === "1" || formStr(input, "emailCopy") === "on";

      // The saved toggle (platform_settings) is the source of truth; env is
      // only the default before the first save. With the toggle off, no email
      // is ever sent. Email failure logs and returns false — in-app rows are
      // already committed and never blocked.
      const settingRows = (await sql`SELECT key, value FROM platform_settings WHERE key LIKE 'admin.notifications.%'`) as unknown as { key: string; value: string }[];
      const emailOn = (settingRows.find((r) => r.key === "admin.notifications.email")?.value ?? env.NOTIFY_EMAIL ?? "0") === "1";
      const recipient = settingRows.find((r) => r.key === "admin.notifications.recipient")?.value ?? env.ADMIN_EMAIL ?? "";

      const companyId = formStr(input, "companyId");
      if (companyId === "__BROADCAST__") {
        const count = await m.broadcastNotification(sql, { title, message, category, link }, auditBase);
        if (emailCopy && emailOn && recipient) {
          await sendEmail(env, recipient, `[Mawzun] Broadcast: ${title}`, message, notifEmailHtml(title, message, link), "Admin Notification");
        }
        return Response.redirect(new URL(`/notifications?sent=broadcast&count=${count}`, url.origin).toString(), 303);
      }
      if (!companyId) return html(page({ title: "Notifications", active: "/notifications", body: '<div class="err">Pick a company first.</div>' }), 400);
      const userId = formStr(input, "userId").trim() || null;
      const notifId = await m.sendNotification(sql, { companyId, userId, title, message, category, link, emailCopy }, auditBase);
      if (!notifId) return null;
      if (emailCopy && emailOn && recipient) {
        await sendEmail(env, recipient, `[Mawzun] ${title}`, message, notifEmailHtml(title, message, link), "Admin Notification");
      }
      return Response.redirect(new URL("/notifications?sent=1", url.origin).toString(), 303);
    }

    if (method === "POST" && path.match(/^\/keys\/([^/]+)\/revoke$/)) {
      const id = path.split("/")[2];
      const result = await m.revokeApiKey(sql, id, auditBase);
      if (result === "notfound") return null;
      return Response.redirect(new URL("/keys", url.origin).toString(), 303);
    }

    if (method === "POST" && path === "/settings") {
      const input = await readBody(request);
      const adminEmail = formStr(input, "adminEmail").trim();
      const notifyEmail = formStr(input, "notifyEmail") === "1" || formStr(input, "notifyEmail") === "on" ? "1" : "0";
      await sql`INSERT INTO platform_settings (key, value) VALUES ('admin.notifications.email', ${notifyEmail})
        ON CONFLICT (key) DO UPDATE SET value = ${notifyEmail}, "updatedAt" = now()`;
      if (adminEmail) {
        await sql`INSERT INTO platform_settings (key, value) VALUES ('admin.notifications.recipient', ${adminEmail})
          ON CONFLICT (key) DO UPDATE SET value = ${adminEmail}, "updatedAt" = now()`;
      }
      return Response.redirect(new URL("/settings?saved=1", url.origin).toString(), 303);
    }

    return null;
}
