# Mawzun Shopify Integration

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Wrangler](https://img.shields.io/badge/Wrangler-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)
[![Shopify](https://img.shields.io/badge/Shopify-7AB55C?logo=shopify&logoColor=white)](https://shopify.dev/)

The **Shopify webhook listener and order ingestion worker**. One job: Shopify
fires `orders/create` / `orders/updated`, this service verifies it, dedupes it,
writes the order into the shared Mawzun database, and records any failure in
`sync_errors` for the dashboard's sync-errors screen.

Part of the Mawzun service split — every service talks to the **same Postgres
database** directly; no service-to-service calls.

| Directory | Domain | Role |
|---|---|---|
| [`api/`](../api) | `api.mawzun.org` | REST API — the only writer |
| [`frontend/`](../frontend) | `app.mawzun.org` | Dashboard — the product |
| [`web/`](../web) | `mawzun.org` | Marketing landing (static, no API) |
| [`api_gateway/`](../api_gateway) | `ai.mawzun.org` | Agent API (API-key auth) |
| `shopify_integration/` (this) | — | Shopify → database ingestion |
| [`admin/`](../admin) | — | Cross-tenant back-office |
| [`uptime/`](../uptime) | `status.mawzun.org` | Uptime monitor |
| [`cleanup_worker/`](../cleanup_worker) | — | Nightly retention sweeps |
| [`api_docs/`](../api_docs) | `docs.mawzun.org` | Documentation for the agent API |

## Pipeline

```
Shopify POST /webhooks/orders/create
  → verify X-Shopify-Hmac-Sha256 (constant-time) against the store's webhook secret
  → find store by X-Shopify-Shop-Domain
  → re-fetch the order via Admin API (webhook bodies can lag)
  → dedupe on (companyId, storeId, externalId)   ← replays never duplicate
  → resolve customer by email → phone → create
  → INSERT order (status NEW) + line items (product matched by SKU)
  → touch stores.last_synced_at
  → any failure → INSERT sync_errors (PENDING) → still ack 200
```

Ingested orders enter as **NEW** — they do **not** commit stock. The company
confirms them like manual orders, so oversell protection still applies.

Two things worth knowing:

- **The Admin API re-fetch is deliberate.** A webhook body can arrive before
  Shopify has finished writing the order, so trusting it would store a partial
  order. The webhook is treated as a notification, not as the payload.
- **Failures still return 200.** A non-2xx makes Shopify retry, and a retry that
  fails the same way just burns the queue. The failure is recorded in
  `sync_errors` where a human can act on it, and replays are safe because of the
  dedupe key.

## Setup (per Shopify store)

1. In the Mawzun dashboard → **المتاجر**: add a store with platform `SHOPIFY`,
   paste the **Admin API access token** (custom app in Shopify admin) and the
   **webhook signing secret** (same custom app's notification section).
2. Point Shopify webhooks to
   `https://<your-worker>.<your-subdomain>.workers.dev/webhooks/orders/create`
   and `/webhooks/orders/updated`.
3. Order SKUs map to Mawzun products by `skuCode`. Unmapped SKUs are recorded as
   order items without a product and surfaced in sync errors.

> **Shopify is off by default on the shared SaaS.** The Backend's
> `SHOPIFY_FEATURE_ENABLED` kill switch rejects SHOPIFY store writes with
> self-host guidance; set it to `1` on a self-hosted instance to enable this
> pipeline.

## Configuration (wrangler secrets)

```sh
npx wrangler secret put DATABASE_URL   # shared Postgres connection string
npx wrangler secret put APP_SECRET     # key for encrypting Shopify tokens at rest
```

Shopify access tokens are stored **AES-256-GCM encrypted** (key derived via HKDF
from `APP_SECRET`), so a database dump does not expose them.

## Development

```sh
npm install
npm run dev        # wrangler dev on :8790
npm run typecheck
npm run build      # wrangler deploy --dry-run
npm run deploy
```

### Local smoke test

```sh
curl -X POST http://localhost:8790/webhooks/orders/create \
  -H "X-Shopify-Shop-Domain: test.myshopify.com" \
  -H "X-Shopify-Hmac-Sha256: bad" \
  -d '{}'   # → 401 invalid signature (store found, HMAC wrong)
```

## Verifying

```sh
npx tsx verify-ingest.mjs   # 30 checks
```

Covers the ingest invariants: HMAC verification, dedupe on replay, the customer
resolution chain, line-item matching, and that a failed ingest records a
`sync_errors` row rather than losing the order.

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

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see the [public monorepo LICENSE](https://github.com/MohamedAYassin/Mawzun/blob/main/LICENSE).
You may use, modify and share this for personal and noncommercial purposes for
free. Hosting it as part of a commercial product or service requires a separate
license — open an issue or contact the author.
