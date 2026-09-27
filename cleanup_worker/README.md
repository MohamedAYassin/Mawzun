# Mawzun Cleanup Worker

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![Build](https://github.com/MohamedAYassin/Mawzun/actions/workflows/cleanup_worker.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/cleanup_worker.yml)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Wrangler](https://img.shields.io/badge/Wrangler-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)

Deletes rows that have outlived their retention window, so the shared database
does not grow forever. Runs nightly at **02:17 UTC** on a Cloudflare cron.

This is a **maintenance service**. It owns no data and serves no users; its only
job is to remove what is provably dead.

Part of the Mawzun service split — every service talks to the **same Postgres
database** directly; no service-to-service calls.

| Directory | Domain | Role |
|---|---|---|
| [`api/`](../api) | `api.mawzun.org` | REST API — the only writer |
| [`frontend/`](../frontend) | `app.mawzun.org` | Dashboard — the product |
| [`web/`](../web) | `mawzun.org` | Marketing landing (static, no API) |
| [`api_gateway/`](../api_gateway) | `ai.mawzun.org` | Agent API (API-key auth) |
| [`shopify_integration/`](../shopify_integration) | — | Shopify → database ingestion |
| [`admin/`](../admin) | — | Cross-tenant back-office |
| [`uptime/`](../uptime) | `status.mawzun.org` | Uptime monitor |
| `cleanup_worker/` (this) | — | Nightly retention sweeps |
| [`api_docs/`](../api_docs) | `docs.mawzun.org` | Documentation for the agent API |

## What it cleans

| Table | Deletes | Default window |
|---|---|---|
| `sessions` | revoked or expired | 45 days |
| `password_reset_tokens` | expired, or used | 1 day |
| `notifications` | **read** rows only | 14 days |
| `sync_errors` | `RESOLVED` / `IGNORED` only | 90 days |
| `audit_logs` | all | 365 days |

Windows live in `wrangler.jsonc` as plain vars so an operator can change them
without reading the code. Setting one to `0` disables that sweep — useful if you
would rather keep everything.

## What it deliberately does NOT clean

Each of these is a decision, not an omission:

- **Unread notifications.** They are the user's inbox, and they are load-bearing
  in a way that is easy to miss: the low-stock alerts suppress duplicates only
  while an *unread* row with the same `action` key exists. Deleting unread rows
  would make every stock movement re-alert the same low-stock condition.
- **`PENDING` sync errors.** An unresolved import failure is an open problem
  someone still has to act on. Age does not make it disposable.
- **Revoked sessions younger than the window.** A *replayed* revoked token is
  how refresh-token theft is detected — the auth service revokes every session
  for that user when one arrives. Delete the row too early and the same stolen
  token just fails to match, so the alarm never fires. That is why this window
  (45 days) is longer than the longest refresh token (30 days for remember-me).
- **Soft-deleted API keys.** `deletedAt` rows are the record that a key existed
  and was revoked. They are already excluded from every query, so they cost
  nothing, and key history is exactly what you want after an incident.
- **Product images (R2 objects).** Soft-deleting a product only stamps
  `deletedAt` — its image rows and R2 objects stay, because
  `POST /products/:id/restore` sets `deletedAt` back to `null` and the product
  returns with its images. Deleting them would destroy files a user can
  legitimately bring back. Only a hard delete removes the object
  (`productImages.ts`), and hard delete is not this worker's business.
- **Orders, inventory, accounting.** Business records. A retention window for
  financial data is the company's decision under its own jurisdiction, not a
  default this worker should impose.

Two other stores already prune themselves, so this worker leaves them alone:
`error_log` keeps only the newest 200 rows (pruned on insert,
`observability/errorCapture.ts`) and the status page drops raw pings after 48
hours (`uptime/`, with 90 days of rollups kept).

## The guard that matters

Row-level security is enabled on every table this worker touches, and each
policy scopes rows to `current_setting('app.company_id')` — a setting a
background job cannot know, because it does not act for one company.

Connected as the **restricted app role**, this worker sees **zero rows**. Every
DELETE would match nothing and the run would report `deleted: 0` — a clean bill
of health while the database grew forever. A silent no-op that looks like
success is the worst possible failure mode for a cleanup job.

So it verifies up front that its connection bypasses RLS (owner or `BYPASSRLS`)
and **refuses to run otherwise**. In production this holds because Hyperdrive is
fed the owner credential — `api/scripts/sync-hyperdrive.mjs` pushes
`DATABASE_URL` into it, and `20260901000000_disable_force_rls_for_managed_postgres`
turns off `FORCE`, so the table owner bypasses its own policies.

`verify-sweeps.mjs` asserts both directions: the guard passes for the owner role
and refuses the restricted one.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /healthz` | liveness |
| `POST /run` | run the sweeps now, guarded by `x-admin-key` |

The manual route exists so a retention change can be verified immediately
instead of waiting for the next night.

```bash
curl -X POST http://localhost:8794/run -H "x-admin-key: $ADMIN_KEY"
```

Response:

```json
{
  "ok": true,
  "deleted": 128,
  "durationMs": 412,
  "retention": { "SESSION_RETENTION_DAYS": 45, "...": 0 },
  "sweeps": [{ "label": "sessions (revoked)", "deleted": 12 }]
}
```

One failing sweep does not abort the others — the tables are independent, and a
partial run beats none. Failures are reported per-sweep in the response and the
overall status becomes 500.

## Running it locally

```bash
npm install

# wrangler reads the Hyperdrive emulation string from the PROCESS ENV,
# not from .dev.vars — a trap worth knowing.
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://..."

cp .dev.vars.example .dev.vars   # fill in HEROKU_* and ADMIN_KEY
npm run dev                      # :8794
```

## Verifying

```bash
npx tsx verify-sweeps.mjs           # 17 checks — both sides of every boundary
npx tsx verify-rotation-chain.mjs   # 7 checks — the self-referencing FK
```

`verify-sweeps.mjs` seeds rows on **both sides of every boundary** (just inside
the retention window and just outside it), runs the real sweeps, and asserts
exactly one survives each pair. It also asserts the visibility guard refuses the
restricted role.

`verify-rotation-chain.mjs` covers an edge case the boundary checks do not:
`sessions."replacedById"` is a **self-referencing FK**. It seeds a real rotation
chain and asserts the sweep deletes chained sessions without erroring, and that
deleting a session another row points at nulls the link (`onDelete: SetNull`)
rather than leaving it dangling — while the predecessor's `revokedAt` stays
intact, so replay detection still works.

Both remove their fixtures in a `finally` block and are safe to re-run.

## Deploying

```bash
npx wrangler secret put HEROKU_API_TOKEN
npx wrangler secret put ADMIN_KEY
npm run build     # wrangler deploy --dry-run
npm run deploy
```

`HEROKU_APP_NAME` and the retention windows are plain vars in `wrangler.jsonc`.

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see the [public monorepo LICENSE](https://github.com/MohamedAYassin/Mawzun/blob/main/LICENSE).
You may use, modify and share this for personal and noncommercial purposes for
free. Hosting it as part of a commercial product or service requires a separate
license — open an issue or contact the author.
