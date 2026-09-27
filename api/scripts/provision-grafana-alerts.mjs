#!/usr/bin/env node
// Provisions Grafana Cloud alerting for Mawzun:
//   1. An email contact point (GRAFANA_ALERT_EMAIL)
//   2. Four conservative alert rules (error-rate spike, sync backlog,
//      auth-failure spike, service down)
//
// Usage:
//   GRAFANA_API_TOKEN=<token> GRAFANA_ALERT_EMAIL=ops@mawzun.org \
//     GRAFANA_BASE_URL=https://mohamedayassin.grafana.net node scripts/provision-grafana-alerts.mjs
//
// Idempotent: re-running updates the existing Mawzun contact point and rules.
// The rules reference metrics pushed by the Backend (mawzun_* series) and are
// evaluated every 1 minute with a 3-minute lookback.
//
// NOTE: run this AFTER the Backend has pushed at least one metrics cycle so
// the rule queries find their series.

const token = process.env.GRAFANA_API_TOKEN;
const baseUrl = process.env.GRAFANA_BASE_URL; // e.g. https://mohamedayassin.grafana.net
const email = process.env.GRAFANA_ALERT_EMAIL;

if (!token || !baseUrl || !email) {
  console.error("GRAFANA_API_TOKEN, GRAFANA_BASE_URL and GRAFANA_ALERT_EMAIL are required");
  process.exit(1);
}

const api = async (path, method, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};

// 1. Contact point (email)
const contacts = await api("/api/v1/provisioning/contact-points", "GET");
const existing = contacts.find((c) => c.name === "Mawzun alerts (email)");
const contactBody = {
  name: "Mawzun alerts (email)",
  type: "email",
  settings: { addresses: email },
  disableResolveMessage: false,
};
let contactUid;
if (existing) {
  contactUid = existing.uid;
  await api(`/api/v1/provisioning/contact-points/${contactUid}`, "PUT", {
    ...contactBody,
    uid: contactUid,
  });
  console.log(`contact point updated: ${contactUid}`);
} else {
  const created = await api("/api/v1/provisioning/contact-points", "POST", contactBody);
  contactUid = created.uid;
  console.log(`contact point created: ${contactUid}`);
}

// 2. Alert rules — one rule group, evaluated every minute
const DS = "grafanacloud-prom"; // default managed-prometheus data source uid on Grafana Cloud
const expr = (query) => ({
  datasourceUid: DS,
  model: {
    datasource: { type: "prometheus", uid: DS },
    editorMode: "code",
    expr: query,
    instant: false,
    intervalMs: 1000,
    legendFormat: "__auto",
    maxDataPoints: 43200,
    range: true,
    refId: "A",
  },
  refId: "A",
  relativeTimeRange: { from: 300, to: 0 },
});

const rules = [
  {
    title: "Mawzun: high 5xx rate",
    condition: "C",
    for: "5m",
    annotations: { summary: "Backend 5xx rate above 2% for 5 minutes" },
    data: [
      { ...expr("sum(rate(mawzun_http_errors_total{class=\"5xx\"}[5m])) / clamp_min(sum(rate(mawzun_http_requests_total[5m])), 0.001)") },
      { refId: "C", model: { datasource: { type: "__expr__", uid: "__expr__" }, expression: "$A > 0.02", type: "math", condition: "C" }, relativeTimeRange: { from: 0, to: 0 } },
    ],
  },
  {
    title: "Mawzun: sync error backlog",
    condition: "C",
    for: "15m",
    annotations: { summary: "Pending sync errors above 10 for 15 minutes" },
    data: [
      { ...expr("mawzun_sync_errors_pending") },
      { refId: "C", model: { datasource: { type: "__expr__", uid: "__expr__" }, expression: "$A > 10", type: "math", condition: "C" }, relativeTimeRange: { from: 0, to: 0 } },
    ],
  },
  {
    title: "Mawzun: auth failure spike",
    condition: "C",
    for: "5m",
    annotations: { summary: "More than 20 failed logins per minute for 5 minutes (possible credential stuffing)" },
    data: [
      { ...expr("sum(rate(mawzun_auth_events_total{type=\"login_failed\"}[5m])) * 60") },
      { refId: "C", model: { datasource: { type: "__expr__", uid: "__expr__" }, expression: "$A > 20", type: "math", condition: "C" }, relativeTimeRange: { from: 0, to: 0 } },
    ],
  },
  {
    title: "Mawzun: backend silent (no metrics)",
    condition: "C",
    for: "10m",
    annotations: { summary: "Backend stopped pushing metrics — dyno down or metrics pipeline broken" },
    data: [
      { ...expr("count_over_time(mawzun_http_requests_total[10m])") },
      { refId: "C", model: { datasource: { type: "__expr__", uid: "__expr__" }, expression: "$A == 0", type: "math", condition: "C" }, relativeTimeRange: { from: 0, to: 0 } },
    ],
  },
];

const groupPayload = {
  name: "Mawzun",
  folderUid: "general",
  rules: rules.map((r) => ({
    title: r.title,
    condition: r.condition,
    for: r.for,
    annotations: r.annotations,
    labels: { team: "mawzun" },
    ruleGroup: "Mawzun",
    execErrState: "Error",
    noDataState: "OK",
    data: r.data,
  })),
  interval: "1m",
};

try {
  const groups = await api("/api/v1/provisioning/rule-groups", "GET");
  const existingGroup = groups.find((g) => g.name === "Mawzun");
  if (existingGroup) {
    await api(`/api/v1/provisioning/folders/general/rule-groups/Mawzun`, "PUT", groupPayload);
    console.log(`rule group updated (${rules.length} rules)`);
  } else {
    await api("/api/v1/provisioning/rule-groups", "POST", groupPayload);
    console.log(`rule group created (${rules.length} rules)`);
  }
} catch (e) {
  // Folder "general" may not be addressable; fall back to no folderUid
  const fallback = { ...groupPayload, folderUid: undefined };
  await api("/api/v1/provisioning/rule-groups", "POST", fallback);
  console.log(`rule group created without folder (${rules.length} rules)`);
}

console.log("\nDone. Rules evaluate every minute; email contact:", email);
console.log("Test: temporarily stop the Backend (or set a bad push URL) — the");
console.log("'backend silent' rule should fire within ~10 min and send a recovery");
console.log("email when it restarts.");
