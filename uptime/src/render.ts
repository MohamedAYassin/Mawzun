// HTML rendering for the status page. The shell lives in status-page.html
// (bundled as text via the wrangler "Text" rule), styles are a static asset
// at /status.css, and this module fills the {{TOKENS}} with live data.
import tpl from "./status-page.html";

export interface ServiceStatus {
  id: string;
  name: string;
  url: string;
  disabled: boolean;
  up: boolean | null;
  uptime90: number | null;
  latencyMs: number | null;
  lastError: string | null;
  days: { date: string; uptime: number | null }[];
}

export interface Incident {
  id: number;
  title: string;
  body: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

export function page(site: { name: string; url: string }, data: { services: ServiceStatus[]; incidents: Incident[]; overallUptime: number | null }): string {
  const anyDown = data.services.some((s) => s.up === false);
  const open = data.incidents.filter((i) => i.status !== "resolved");
  const past = data.incidents.filter((i) => i.status === "resolved");
  const rows = data.services
    .map((s) => {
      if (s.disabled) {
        return `<section class="svc disabled"><div class="svc-head"><span class="dot unknown"></span>
<strong>${esc(s.name)}</strong>
<span class="meta">not configured — give it a URL via <code>CHECKS</code> or <code>SHOPIFY_WEBHOOK_URL</code> to monitor it</span></div></section>`;
      }
      const dot = s.up === null ? "unknown" : s.up ? "up" : "down";
      const cells = Array.from({ length: 90 }, (_, i) => {
        // Map the last 90 calendar days onto available daily aggregates.
        const d = new Date(Date.now() - (89 - i) * 86_400_000).toISOString().slice(0, 10);
        const found = s.days.find((x) => x.date === d);
        const u = found?.uptime ?? null;
        const cls = u === null ? "nodata" : u >= 90 ? "up" : u >= 50 ? "degraded" : "down";
        const edge = i < 6 ? " tip-l" : i > 83 ? " tip-r" : "";
        const tip = `${d}: ${u === null ? "no data" : u + "% uptime"}`;
        return `<i class="${cls}${edge}" data-tip="${esc(tip)}"></i>`;
      }).join("");
      return `<section class="svc"><div class="svc-head"><span class="dot ${dot}"></span>
<strong>${esc(s.name)}</strong>
<span class="meta">${s.uptime90 !== null ? s.uptime90 + "% · 90d" : "no data yet"}${s.latencyMs !== null ? ` · ${s.latencyMs}ms` : ""}${s.lastError && !s.up ? ` · ${esc(s.lastError)}` : ""}</span>
<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.url.replace("https://", ""))}</a></div>
<div class="bars">${cells}</div></section>`;
    })
    .join("");
  const incidentCard = (i: Incident) => `<article class="inc ${i.status === "resolved" ? "resolved" : "open"}">
<div class="inc-head"><strong>${esc(i.title)}</strong>
<span class="pill">${esc(i.status)}</span></div>
${i.body ? `<p>${esc(i.body)}</p>` : ""}
<div class="meta">${fmtDate(i.createdAt)} UTC${i.status === "resolved" ? ` · resolved ${fmtDate(i.updatedAt)} UTC` : ""}</div></article>`;
  const uptimeBlock = data.overallUptime != null
    ? `<div class="uptime"><div class="uptime-label">Overall uptime · last 90 days</div><div class="uptime-value">${data.overallUptime}%</div><div class="uptime-hint">weighted across every enabled service, every check</div></div>`
    : "";
  // Replacement functions (not strings) so user data containing "$&" can't
  // inject into the pattern replacement.
  return tpl
    .replaceAll("{{SITE_NAME}}", () => esc(site.name))
    .replaceAll("{{SITE_URL}}", () => esc(site.url))
    .replace("{{BANNER_CLASS}}", () => (anyDown || open.length ? "bad" : "ok"))
    .replace("{{BANNER_TEXT}}", () => (anyDown || open.length ? "⚠ Ongoing issues — see incidents below" : "✓ All systems operational"))
    .replace("{{UPTIME_BLOCK}}", () => uptimeBlock)
    .replace("{{SERVICES}}", () => rows)
    .replace("{{INCIDENTS}}", () => [...open, ...past].map(incidentCard).join(""))
    .replace("{{NO_INCIDENTS}}", () => (data.incidents.length ? "" : `<p class="empty">No incidents recorded.</p>`));
}
