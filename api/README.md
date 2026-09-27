# Mawzun API

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![CI](https://github.com/MohamedAYassin/Mawzun/actions/workflows/api.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/api.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express_5-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Node.js](https://img.shields.io/badge/Node.js_22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Heroku](https://img.shields.io/badge/Heroku-430098?logo=heroku&logoColor=white)](https://www.heroku.com/)

The **Mawzun** ERP backend: **TypeScript**, **Express 5**, **Prisma** on
**PostgreSQL**, with multi-tenant isolation enforced by **row-level security**
in the database rather than by each query remembering a filter.

Part of the microservice split — every service talks to the **same Postgres
database** directly; there are no service-to-service calls.

| Directory | Domain | Role |
|---|---|---|
| `api/` (this) | `api.mawzun.org` | REST API — the only writer |
| [`frontend/`](../frontend) | `app.mawzun.org` | Dashboard — the product |
| [`web/`](../web) | `mawzun.org` | Marketing landing (static, no API) |
| [`api_gateway/`](../api_gateway) | `ai.mawzun.org` | Agent API (API-key auth) |
| [`shopify_integration/`](../shopify_integration) | — | Shopify → database ingestion |
| [`admin/`](../admin) | — | Cross-tenant back-office |
| [`uptime/`](../uptime) | `status.mawzun.org` | Uptime monitor |
| [`cleanup_worker/`](../cleanup_worker) | — | Nightly retention sweeps |
| [`api_docs/`](../api_docs) | `docs.mawzun.org` | Documentation for the agent API |

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript 5, strict |
| Runtime | Node.js 22 (`.nvmrc` — CI reads it, so prod and CI cannot drift) |
| Server | Express 5 |
| Data | Prisma ORM (multi-file schema in `prisma/schema/`) + PostgreSQL |
| Auth | JWT — access token in the body, refresh token in an `HttpOnly; Secure` cookie |
| Passwords | bcrypt (`bcryptjs`) |
| Validation | `zod` — request schemas, plus boot-time env validation in `src/config/env.ts` |
| Uploads | Cloudflare R2 via `@aws-sdk/client-s3`; `sharp` normalises to WebP |
| Cache | `ioredis` — rate limiting only, pooled at 2 connections, fails open |

## Layout

```text
Backend/
├── prisma/
│   ├── schema/          # multi-file schema (datasource, identity, catalog, sales, …)
│   ├── migrations/      # applied migrations (RLS, owner invariants, …)
│   └── seed.ts          # idempotent: plans + countries, optional demo company
├── scripts/             # operator scripts (provision-db, mint-platform-admin,
│                        # generate-traffic, provision-grafana-alerts, sync-hyperdrive)
├── src/
│   ├── config/          # env (zod, fails fast), database (app + admin roles), companyContext
│   ├── middleware/      # authenticate (JWT + securityStamp), authorize (requirePermission)
│   ├── modules/         # auth, catalog, company, finance, inventory, production,
│   │                    # purchasing, reports, role, sales, settings, shipping, system, user
│   ├── routes/index.ts  # mount order IS the security boundary
│   ├── shared/          # http envelope, resource factory, audit, storage (R2), request helpers
│   └── app.ts           # CORS allowlist, security headers, rate limiting, /healthz
└── tests/               # node:test — 131 cases
```

## Architecture notes

1. **Multi-tenancy by RLS.** Every company-scoped table carries a `companyId`
   defaulted from the `app.company_id` GUC; handlers run inside `scoped()`
   transactions that set it. Identity resolution (login/signup/refresh)
   deliberately uses the privileged connection first, because no company is
   known yet.
2. **Two database roles.** `DATABASE_URL` is the restricted role — it does
   **not** bypass RLS. `DIRECT_DATABASE_URL` is the privileged role, used only
   for migrations, seeding, and pre-tenant identity resolution.
3. **Server-resolved permissions.** JWTs carry identity only (`sub`,
   `companyId`, `securityStamp`). Permissions are resolved from roles +
   ownership on every request and are never trusted from the token.
4. **Refresh-token rotation** with replay detection: a replayed token revokes
   every session for that user. Cookie is
   `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`.
5. **Low-stock alerts** fire from the single stock-change choke point,
   transition-based with unread-dedupe so a product that stays low nags once.
6. **Uniform envelope.** Every endpoint returns `{success, message, data}`.
   Prisma `P2002` → 409, body-parser syntax errors → 400, zod failures → 422
   with per-field details.

## Development

```sh
npm install
cp .env.example .env      # the committed example is the real local-dev config
npm run prisma:generate
npm run dev               # :5000
```

`npm run start` is the production entry: build → `prisma migrate deploy` →
boot (role provisioning re-runs on every start).

## Tests

```sh
npm test        # 131 cases — hermetic, no network, no Redis
npm run check   # typecheck + test
```

The suite talks to **real PostgreSQL**, because row-level security only exists
in the database — a mocked client would pass whether or not the policies were
there. CI provisions Postgres and creates both roles before running it.

**The suite never touches Redis.** There is no local Redis; the real
`REDIS_URL` points at a hosted instance this project does not own.
`tests/setup.mjs` empties `REDIS_URL` (every limiter then fails open, its
documented behaviour) and blocks sockets to 6379/6380 outright, so a test that
tried to reach a cache fails loudly instead of silently depending on someone
else's server.

### Verifiers

Standalone checks that assert against a running database rather than in-process
state. Each is safe to re-run and cleans up after itself.

```sh
npx tsx verify-contract.mjs /sales/orders /catalog/products   # route existence
npx tsx verify-shapes.mjs          # relation loading on list endpoints
npx tsx verify-details.mjs         # detail endpoints return their relations
npx tsx verify-writes.mjs          # create + update round-trip
npx tsx verify-redaction.mjs       # credentials never reach error_log
npx tsx verify-auth-queries.mjs    # query counts per auth path
npx tsx verify-no-races.mjs        # no concurrent statements on one connection
npx tsx verify-return-number-race.mjs   # shipping-return reference allocation
npx tsx verify-onboarding.mjs      # first-run wizard state
npx tsx verify-ratelimit-logic.mjs # sliding-window logic (no Redis socket)
```

`verify-ratelimit-logic.mjs` reads `WINDOW_LUA` out of `src/lib/rateLimit.ts`
at run time and executes it in **fengari** (a pure-JS Lua VM) against a mock
`redis.call` with real sorted-set semantics, so the tested script cannot drift
from the shipped one — and no connection to Redis is opened.

## Configuration

See [`.env.example`](.env.example) — the committed example is the working local
config; only the Mailtrap token is a placeholder.

| Variable | What it does |
|---|---|
| `DATABASE_URL` | Application role — subject to RLS |
| `DIRECT_DATABASE_URL` | Privileged role — migrations, seeding, identity resolution |
| `JWT_SECRET` | Signs access tokens |
| `CORS_ORIGIN` | Allowlisted app origin(s) |
| `REDIS_URL` | Rate limiting. **Unset = every limiter fails open** (documented behaviour) |
| `R2_*` | Product image storage (Cloudflare R2) |
| `MAILTRAP__*` | Transactional email |
| `SHOPIFY_FEATURE_ENABLED` | SaaS-wide Shopify kill switch. Off: SHOPIFY store writes are rejected with self-host guidance |

> **Deploying to a host with a single database role?** Set both URLs to the same
> value. `scripts/provision-db.mjs` detects the shared role and skips
> provisioning. Tenant isolation then relies on the application-level `companyId`
> scoping that wraps every query (`scoped()` in `src/shared/request.ts`) instead
> of database RLS. Prefer two roles where the host allows it: the database then
> enforces isolation even if a query forgets its scope.

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see the [public monorepo LICENSE](https://github.com/MohamedAYassin/Mawzun/blob/main/LICENSE).
You may use, modify and share this for personal and noncommercial purposes for
free. Hosting it as part of a commercial product or service requires a separate
license — open an issue or contact the author.
