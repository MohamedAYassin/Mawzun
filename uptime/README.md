# Mawzun Status

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![Build](https://github.com/MohamedAYassin/Mawzun/actions/workflows/uptime.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/uptime.yml)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare_D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Wrangler](https://img.shields.io/badge/Wrangler-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)

Self-hosted uptime monitor that fits in one Cloudflare Worker: cron pings
every service you configure, stores history in one D1 database, renders a
clean status page, alerts on Telegram when something goes down or recovers,
and costs $0 on Cloudflare's free tier. No vendor, no build step, no
framework — two small TypeScript files plus config.

- **Configurable services, no code edits** — the whole service list is one
  JSON env var (`CHECKS`): add/remove/rename services, set expected body
  content, all without touching code.
- **90-day uptime bars** per service + overall uptime, served from daily
  rollups so page reads stay flat forever.
- **Telegram alerts** on down/recovered transitions (optional).
- **Incidents** with an HTTP admin API — no SQL console needed.
- **Edge-cached** (60 s) so repeat views cost zero database reads.

## How it works

```
cron (*/5 min) ──► ping every CHECKS entry ──► D1: pings + daily rollups
GET /           ──► status page (reads rollups only)
GET /api/status ──► same data as JSON
```

Raw pings are trimmed after 90 days; the page reads the tiny `rollups`
table, so a page view costs the same on day 900 as on day 1.

## Requirements

- A Cloudflare account, Node 18+, `npx`
- (That's it — no Heroku, no Postgres, no domain required, though a custom
  domain is nicer than `*.workers.dev`)

## Setup (one time, ~5 minutes)

```bash
npm install
cp .dev.vars.example .dev.vars   # optional, for local dev

npx wrangler login
npx wrangler d1 create mawzun-status
# paste the returned database_name + database_id into wrangler.jsonc

npx wrangler deploy
npx wrangler domains add status.your-domain.org   # or use the workers.dev URL
```

The worker runs on built-in defaults (the Mawzun services) until you
configure it. Set production config with either style:

```bash
npx wrangler secret put ADMIN_KEY              # secrets (keys, tokens)
# or edit the "vars" block in wrangler.jsonc   # non-secrets, then redeploy
```

## Configuration

Every variable, with defaults. All are optional — see
[`.dev.vars.example`](.dev.vars.example) for a copy-paste file.

| Variable | Default | What it does |
|---|---|---|
| `CHECKS` | built-in list | JSON array replacing the service list — see below |
| `SHOPIFY_WEBHOOK_URL` | empty | Shortcut: points the `webhook` check at `<url>/healthz`. Empty shows the entry greyed out as "not configured" |
| `SITE_NAME` | `Mawzun` | Name in the page title, banner link and alt text |
| `SITE_URL` | `https://mawzun.org` | Where the header logo links to |
| `ADMIN_KEY` | unset | Required for `POST /run` and the incident endpoints. Generate: `node -e "console.log(crypto.randomUUID())"` |
| `TELEGRAM_BOT_TOKEN` | unset | Bot token from [@BotFather](https://t.me/BotFather) — keep as a secret |
| `TELEGRAM_CHAT_ID` | unset | Chat to alert. Message your bot, then read `chat.id` from `https://api.telegram.org/bot<TOKEN>/getUpdates` |

Alerts fire only on transitions (up→down, down→up), never repeatedly, and
both Telegram vars must be set.

### The service list (`CHECKS`)

`CHECKS` replaces the built-in list entirely. Each entry:

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Unique key; uptime history is stored under it — keep it stable when renaming a service |
| `name` | yes | Display name |
| `url` | yes | `http(s)` URL, or `""` to show the entry greyed out ("not configured") |
| `contains` | no | Substring the response body must include, on top of HTTP 200 — catches "200 but serving the error page" |

Example — a typical self-hosted stack (set in `wrangler.jsonc` vars, or
`npx wrangler secret put CHECKS`):

```jsonc
"CHECKS": "[{\"id\":\"site\",\"name\":\"Website\",\"url\":\"https://example.com/\"},{\"id\":\"app\",\"name\":\"Dashboard\",\"url\":\"https://app.example.com/\"},{\"id\":\"api\",\"name\":\"API\",\"url\":\"https://api.example.com/healthz\",\"contains\":\"ok\"},{\"id\":\"webhook\",\"name\":\"Shopify sync\",\"url\":\"\"}]"
```

Readable form of the same value:

```json
[
  { "id": "site",    "name": "Website",      "url": "https://example.com/" },
  { "id": "app",     "name": "Dashboard",    "url": "https://app.example.com/" },
  { "id": "api",     "name": "API",          "url": "https://api.example.com/healthz", "contains": "ok" },
  { "id": "webhook", "name": "Shopify sync", "url": "" }
]
```

A malformed `CHECKS` value fails loudly with a precise error (bad field,
duplicate id, non-http URL) instead of silently monitoring the wrong thing.

The built-in default (used when `CHECKS` is empty): Mawzun's Website,
Dashboard, API, AI API, Docs, plus a greyed-out Shopify sync row that comes
alive when you set `SHOPIFY_WEBHOOK_URL`.

### Branding

`SITE_NAME`/`SITE_URL` handle the text. The header logos and favicon are
plain files in [`public/`](public/) — replace `logo_scale.svg`,
`mawzun_black.svg` and `favicon.svg` with your own (keep the filenames or
edit `public/` references in `src/index.ts`) and redeploy.

## Incidents

Open incidents turn the page banner red. Manage them over HTTP (needs
`ADMIN_KEY`) — no database console required:

```bash
# open
curl -X POST https://status.your-domain.org/api/incidents \
  -H "x-admin-key: $ADMIN_KEY" -H "content-type: application/json" \
  -d '{"title":"API degraded","body":"Heroku dyno saturated, scaling up."}'

# resolve (id from the create response)
curl -X POST https://status.your-domain.org/api/incidents/1/resolve \
  -H "x-admin-key: $ADMIN_KEY"
```

Prefer SQL? Same table via `npx wrangler d1 execute mawzun-status --remote`:

```sql
INSERT INTO incidents (title, body, createdAt, updatedAt)
VALUES ('API slow', 'Scaling up.', unixepoch('now') * 1000, unixepoch('now') * 1000);

UPDATE incidents SET status = 'resolved', updatedAt = unixepoch('now') * 1000 WHERE id = 1;
```

## HTTP API

| Route | Auth | Purpose |
|---|---|---|
| `GET /` | — | Status page (banner, overall uptime, 90-day bars, incidents) |
| `GET /api/status` | — | Same data as JSON — embed it anywhere |
| `POST /run` | `x-admin-key` | Trigger a check round now instead of waiting for cron |
| `POST /api/incidents` | `x-admin-key` | Open an incident `{title, body?}` |
| `POST /api/incidents/:id/resolve` | `x-admin-key` | Resolve an incident |

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # set ADMIN_KEY, drop a CHECKS value if you like
npm run dev                      # http://localhost:8793 with a local D1
curl -X POST http://localhost:8793/run -H "x-admin-key: $ADMIN_KEY"
```

Local D1 starts empty: run `POST /run` once to see real bars appear.

To verify that the build compiles and all checks pass without errors:

```bash
npm run check    # runs typecheck, dry-run build bundle, and unit tests
```

- `npm run typecheck` — validates TypeScript types (`tsc --noEmit`)
- `npm run build` — verifies Worker compilation and assets bundling (`wrangler deploy --dry-run`)
- `npm test` — runs test suite for configuration and checks validation (`scripts/checks-test.mts`)
- `npm run check` — runs all of the above in sequence (mirrored in CI on every push/PR)

## Changing the cadence

Edit `triggers.crons` in `wrangler.jsonc` (Cloudflare cron syntax, `*/5 * * * *`
= every 5 min; Workers cron granularity bottoms out at 5 minutes) and redeploy.

## Repo layout

```
src/index.ts    worker: cron, page, JSON, incident + run endpoints
src/checks.ts   Check type, default list, CHECKS parsing/validation
scripts/        checks-test.mts — config-parsing checks (npm test)
public/         logos + favicon (replace with your branding)
wrangler.jsonc  worker config: D1 binding, cron, non-secret vars
```

## Part of the Mawzun service split

Every service talks to the **same Postgres database** directly; there are no
service-to-service calls.

| Directory | Domain | Role |
|---|---|---|
| [`api/`](../api) | `api.mawzun.org` | REST API — the only writer |
| [`frontend/`](../frontend) | `app.mawzun.org` | Dashboard — the product |
| [`web/`](../web) | `mawzun.org` | Marketing landing (static, no API) |
| [`api_gateway/`](../api_gateway) | `ai.mawzun.org` | Agent API (API-key auth) |
| [`shopify_integration/`](../shopify_integration) | — | Shopify → database ingestion |
| [`admin/`](../admin) | — | Cross-tenant back-office |
| `uptime/` (this) | `status.mawzun.org` | Uptime monitor |
| [`cleanup_worker/`](../cleanup_worker) | — | Nightly retention sweeps |
| [`api_docs/`](../api_docs) | `docs.mawzun.org` | Documentation for the agent API |

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see [LICENSE](LICENSE). You may use, modify and share this monitor for
personal and noncommercial purposes for free. Hosting it as part of a
commercial product or service requires a separate license — open an issue
or contact the author.
