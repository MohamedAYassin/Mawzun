# Mawzun AI API

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Wrangler](https://img.shields.io/badge/Wrangler-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)

REST API that lets AI agents work with a company's data — **the agent is the
integration**. Authenticated with Mawzun API keys minted in the dashboard
(الإضافات → مفاتيح API). Served at **ai.mawzun.org**.
Full reference: **https://docs.mawzun.org**

Part of the Mawzun service split — every service talks to the **same Postgres
database** directly; no service-to-service calls.

| Directory | Domain | Role |
|---|---|---|
| [`api/`](../api) | `api.mawzun.org` | REST API — the only writer |
| [`frontend/`](../frontend) | `app.mawzun.org` | Dashboard — the product |
| [`web/`](../web) | `mawzun.org` | Marketing landing (static, no API) |
| `api_gateway/` (this) | `ai.mawzun.org` | Agent API (API-key auth) |
| [`shopify_integration/`](../shopify_integration) | — | Shopify → database ingestion |
| [`admin/`](../admin) | — | Cross-tenant back-office |
| [`uptime/`](../uptime) | `status.mawzun.org` | Uptime monitor |
| [`cleanup_worker/`](../cleanup_worker) | — | Nightly retention sweeps |
| [`api_docs/`](../api_docs) | `docs.mawzun.org` | Documentation for the agent API |

## What it serves

**21 resource families × 5 verbs** (list, read, create, update, delete) plus six
read-only endpoints for the large or computed ones.

| Area | Resource families |
|---|---|
| Catalog | categories, brands, uoms, tax-rates, attributes, attribute-values |
| Inventory | warehouses, storage-locations, operation-types, reorder-points, stock-counts |
| Sales | order-sources, payment-methods, cancel-reasons, shipping-returns, fulfillment-batches |
| Purchasing | purchase-orders |
| Shipping | governorates, cities, carriers |
| Production | production-batches |

Read-only, because they are large or need joins a generic filter cannot express:

| Endpoint | Notes |
|---|---|
| `GET /v1/products`, `GET /v1/products/:id` | variants, images, category, brand, uom |
| `GET /v1/orders`, `GET /v1/orders/:id` | accepts a Mawzun order number, a Shopify external number, or an external id |
| `GET /v1/customers`, `GET /v1/customers/:id` | |
| `GET /v1/notifications` | |
| `GET /v1/coupons` | |
| `GET /v1/vendors` | full CRUD lives in the Backend |

`GET /` lists every endpoint, derived from the route table rather than
hand-maintained.

Auth: `Authorization: Bearer <key>`. Missing or bad key → `401` with an Arabic
message. Keys are stored as a SHA-256 hash and checked against `expiresAt`.

## The factory

Each resource is **declared once** in `src/resourceSpecs.ts` and the five routes
are generated from that declaration, mirroring the Backend's `defineResource` so
the two surfaces agree about what "delete" means for the same table. Three rules
the factory enforces so a declaration cannot get them wrong:

1. **Every statement is scoped by `companyId`**, and the value comes from the
   verified API key — never from the request body.
2. **Column names come from the declaration, never from input.** A body key that
   is not declared is ignored rather than interpolated, so a caller cannot name a
   column to write (`companyId`, `deletedAt`, `isPlatformAdmin`).
3. **Delete soft-deletes when the table has `deletedAt`**, and only removes rows
   otherwise. Getting this backwards would orphan rows that reference it.

### Deliberately excluded

- `countries` — a global table with no `companyId`, so it cannot be
  company-scoped. Exposing it would leak every tenant's view, or let one company
  edit rows another depends on.
- `product-images` — already reachable: `POST`/`PATCH /v1/products` accept
  `images[]` and replace the set atomically.
- `api-keys`, `sessions`, `stores`, `sync-errors` — operator and security
  surfaces. A key that can mint keys, or read sealed store tokens, is a
  privilege-escalation path rather than a business action.

## Database access (Hyperdrive)

Production goes through a shared Hyperdrive config (`mawzun-db`, bound as
`HYPERDRIVE`): pooled at the edge, no per-query socket storm, ~3-4 counted
queries per request against the 100k/day free budget. The Hyperdrive ID in
`wrangler.jsonc` is public and safe to commit — the password lives only in
Cloudflare's control plane.

**Rotation.** Heroku rotates `DATABASE_URL`; Hyperdrive keeps its own copy of
the origin password. `api/scripts/sync-hyperdrive.mjs` (Heroku Scheduler,
every 10 min) PATCHes the current password into Hyperdrive, so Heroku stays the
source of truth and rotations heal within minutes.

## Development

```sh
npm install

# wrangler refuses a Hyperdrive binding without a local connection string.
# It reads this from the PROCESS ENV, not from .dev.vars — a trap worth knowing.
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://..."

npm run dev        # :8791
npm run typecheck
npm run build      # wrangler deploy --dry-run
npm run deploy
```

Without the binding, the worker falls back to resolving `DATABASE_URL` live from
Heroku's Platform API (`HEROKU_API_TOKEN` + `HEROKU_APP_NAME`).

## Verifying

```sh
npx tsx verify-resources.mjs   # 115 checks — every resource family × every verb
```

Asserts each documented endpoint exists and answers with the expected shape, so
the docs and the route table cannot drift apart.

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see the [public monorepo LICENSE](https://github.com/MohamedAYassin/Mawzun/blob/main/LICENSE).
You may use, modify and share this for personal and noncommercial purposes for
free. Hosting it as part of a commercial product or service requires a separate
license — open an issue or contact the author.
