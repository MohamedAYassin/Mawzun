# Mawzun Admin

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Wrangler](https://img.shields.io/badge/Wrangler-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)

The **platform back-office**: a password-gated Cloudflare Worker that lets
platform staff work across every tenant — browse companies and users, suspend
and close accounts, force-logout and impersonate, triage sync errors, send
notifications, revoke API keys, and read the error breadcrumb trail.

It deliberately has **no build step and no framework** — one Worker, server-
rendered HTML, so it keeps working during an incident when the dashboard might
not.

Part of the Mawzun service split — every service talks to the **same Postgres
database** directly; no service-to-service calls.

| Directory | Domain | Role |
|---|---|---|
| [`api/`](../api) | `api.mawzun.org` | REST API — the only writer |
| [`frontend/`](../frontend) | `app.mawzun.org` | Dashboard — the product |
| [`web/`](../web) | `mawzun.org` | Marketing landing (static, no API) |
| [`api_gateway/`](../api_gateway) | `ai.mawzun.org` | Agent API (API-key auth) |
| [`shopify_integration/`](../shopify_integration) | — | Shopify → database ingestion |
| `admin/` (this) | — | Cross-tenant back-office |
| [`uptime/`](../uptime) | `status.mawzun.org` | Uptime monitor |
| [`cleanup_worker/`](../cleanup_worker) | — | Nightly retention sweeps |
| [`api_docs/`](../api_docs) | `docs.mawzun.org` | Documentation for the agent API |

## Screens

| Route | What it does |
|---|---|
| `/` | Overview — companies, signups, users, sessions, products, orders |
| `/companies` | Every company: status, owner, counts. Suspend / close |
| `/companies/:id` | Detail, plus **log in as** (impersonation) |
| `/users` | Every user across tenants. Suspend, force logout, impersonate |
| `/notifications` | Compose a notification to one company or all |
| `/sync` | Cross-tenant sync-error triage — pending / resolved / ignored |
| `/keys` | API keys, with revoke |
| `/audit` | The platform audit trail |
| `/observability` | Error breadcrumbs, metrics links, alert config |
| `/settings` | Admin email, notification copies |

## Auth

A single `ADMIN_PASSWORD` gates the whole Worker. Sessions are
`HMAC(password, timestamp)` in a cookie — no store, no JWT library — and the
gate is enforced **server-side on every request**: a forged, missing, malformed
or stale cookie gets `401`, not a rendered page. Password comparison hashes both
sides so timing does not leak length.

Impersonation stamps `sessions.impersonatedBy` with `ADMIN_EMAIL`, which drives
the in-app banner so an impersonated session is never mistaken for a real one.

## Setup

```sh
npm install
```

Put the password and Heroku token in `.dev.vars` (local only, gitignored):

```
ADMIN_PASSWORD=<pick-a-strong-one>
ADMIN_EMAIL=admin@mawzun.org
HEROKU_APP_NAME=mawzun
HEROKU_API_TOKEN=<heroku auth:token>
```

```sh
# wrangler refuses a Hyperdrive binding without a local connection string.
# It reads this from the PROCESS ENV, not from .dev.vars — a trap worth knowing.
# Use DIRECT_DATABASE_URL (the privileged role): the app role sees zero rows under RLS.
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://..."

npm run dev        # :8792
npm run typecheck
npm run build      # wrangler deploy --dry-run
```

## Production

```sh
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put HEROKU_API_TOKEN
npm run deploy
```

DB access mirrors `api_gateway`: a shared Hyperdrive binding in production, live
Heroku Platform API resolution locally.

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see the [public monorepo LICENSE](https://github.com/MohamedAYassin/Mawzun/blob/main/LICENSE).
You may use, modify and share this for personal and noncommercial purposes for
free. Hosting it as part of a commercial product or service requires a separate
license — open an issue or contact the author.
