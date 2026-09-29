# Mawzun
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="preview/mawzun_white.svg">
       
  <img src="preview/mawzun_black.svg" alt="موزون" width="220">
</picture>



[![License](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Heroku](https://img.shields.io/badge/Heroku-430098?logo=heroku&logoColor=white)](https://www.heroku.com/)

An **Arabic-first business operations platform (ERP)** for small and mid-sized
businesses: sales, inventory, purchasing, production, fulfillment, shipping and
accounting in one RTL dashboard, with Shopify sync and a company-scoped API for
AI agents.

This repository is the **public distribution of the whole system** — every
service, in one place, so the architecture can be read end to end. Each service
is also developed in its own private repository; this tree is synced from those.

## Preview

https://github.com/user-attachments/assets/c7a22d41-cd9b-4347-ab9f-815ececb5a8c


## What is here

| Directory | Service | Domain | Stack |
|---|---|---|---|
| [`api/`](api/) | Backend REST API | `api.mawzun.org` | Express + Prisma + PostgreSQL |
| [`frontend/`](frontend/) | Dashboard application | `app.mawzun.org` | TanStack Start (React, SSR) |
| [`web/`](web/) | Marketing landing page | `mawzun.org` | TanStack Start (React, SSR) |
| [`api_gateway/`](api_gateway/) | Agent API | `ai.mawzun.org` | Cloudflare Worker + Hyperdrive |
| [`shopify_integration/`](shopify_integration/) | Shopify webhooks | — | Cloudflare Worker + Hyperdrive |
| [`admin/`](admin/) | Platform back-office | — | Cloudflare Worker + Hyperdrive |
| [`uptime/`](uptime/) | Status page | `status.mawzun.org` | Cloudflare Worker |
| [`cleanup_worker/`](cleanup_worker/) | Nightly retention sweeps | — | Cloudflare Worker + Hyperdrive |
| [`api_docs/`](api_docs/) | API documentation | `docs.mawzun.org` | Static HTML |

There are **no service-to-service calls**. Every service reads the same
PostgreSQL database directly, which is what keeps the topology this simple.

## Continuous integration

Every service has its own workflow, and the badges below are their current
state. Path filters keep the cost proportional to the change: editing the
landing page does not spin up a PostgreSQL instance.

Only two suites run tests. The API's needs a real database because it asserts on
row-level security — a mocked client would pass whether or not the policies were
there — and uptime's exercises its check logic. The rest are gated by typecheck
and build. All of them must pass before a change is merged; see
[CONTRIBUTING.md](CONTRIBUTING.md).

| Workflow | What it gates | Runs on |
|---|---|---|
| [![api](https://github.com/MohamedAYassin/Mawzun/actions/workflows/api.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/api.yml) | `api/` — build + test suite (PostgreSQL, row-level security) | changes under `api/` |
| [![frontend](https://github.com/MohamedAYassin/Mawzun/actions/workflows/frontend.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/frontend.yml) | `frontend/` — typecheck + build | changes under `frontend/` |
| [![web](https://github.com/MohamedAYassin/Mawzun/actions/workflows/web.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/web.yml) | `web/` — typecheck + build | changes under `web/` |
| [![api_gateway](https://github.com/MohamedAYassin/Mawzun/actions/workflows/api_gateway.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/api_gateway.yml) | `api_gateway/` — typecheck + build (wrangler dry run) | changes under `api_gateway/` |
| [![shopify_integration](https://github.com/MohamedAYassin/Mawzun/actions/workflows/shopify_integration.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/shopify_integration.yml) | `shopify_integration/` — typecheck + build (wrangler dry run) | changes under `shopify_integration/` |
| [![admin](https://github.com/MohamedAYassin/Mawzun/actions/workflows/admin.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/admin.yml) | `admin/` — typecheck + build (wrangler dry run) | changes under `admin/` |
| [![uptime](https://github.com/MohamedAYassin/Mawzun/actions/workflows/uptime.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/uptime.yml) | `uptime/` — typecheck + build + check tests | changes under `uptime/` |
| [![cleanup_worker](https://github.com/MohamedAYassin/Mawzun/actions/workflows/cleanup_worker.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/cleanup_worker.yml) | `cleanup_worker/` — typecheck + build (wrangler dry run) | changes under `cleanup_worker/` |
| [![codeql](https://github.com/MohamedAYassin/Mawzun/actions/workflows/codeql.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/codeql.yml) | CodeQL security analysis (JavaScript/TypeScript) | weekly + manual |

## Architecture in one paragraph

A company is the tenant boundary. Every row that belongs to a company carries a
`companyId`, and PostgreSQL row-level security enforces isolation in the
database rather than relying on each query to remember a filter. The API runs as
two roles: a restricted role subject to those policies, and a privileged one
used only for identity resolution, migrations and platform administration. The
Cloudflare Workers reach the same database through Hyperdrive, which pools
connections at the edge so a Worker cannot exhaust the database's connection
budget.

## Notable design decisions

- **Permissions are server-resolved.** A JWT carries identity only — permissions
  are recomputed from roles and ownership on every request, so revoking a role
  takes effect immediately instead of at token expiry.
- **Deletes are soft by default.** `deletedAt` is stamped rather than rows being
  removed, and list endpoints filter on it. The cleanup worker only hard-deletes
  what is provably past its retention window.
- **Shopify is opt-in.** The Shopify pipeline is off on the shared SaaS by
  default; a self-hosted instance enables it with an env var.
- **Fail open on cache.** Rate limiting uses a hosted Redis. If it is
  unreachable the limiters pass requests through — a cache must never take login
  down. An unset `REDIS_URL` takes the same path.

## Running it

Each service is self-contained. `cd` into one and read its README:

```bash
cd api            # the backend — start here, everything else talks to it
```

Every service needs its own environment. Each ships a `.env.example` (or
`.dev.vars.example` for Workers) documenting every variable it reads; copy it and
fill in the values. No service requires secrets from another to build.

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — you may read, run and modify this for
any noncommercial purpose. Commercial use requires a separate license.

Copyright is retained; this is source-available, not open source in the OSI
sense. See the LICENSE file for the exact terms.
