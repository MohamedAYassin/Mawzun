# AGENTS.md

Guidance for AI coding agents working in this repository. If you are a human
contributor, [CONTRIBUTING.md](CONTRIBUTING.md) is the file you want — this one
covers the things that specifically trip up an agent.

## What this repository is

One product, nine services, assembled here so the whole architecture can be read
end to end. Each service also lives in its own repository, where development
happens; this tree carries the merged result. **Treat it as generated**: editing
a service's files here means the next merge overwrites your edit.

| Directory | What it is | Stack |
|---|---|---|
| `api/` | REST API — the only writer | Express 5 + Prisma + PostgreSQL |
| `frontend/` | Dashboard application | TanStack Start (React, SSR) |
| `web/` | Marketing landing page | TanStack Start (React, SSR) |
| `api_gateway/` | Agent API (API-key auth) | Cloudflare Worker + Hyperdrive |
| `shopify_integration/` | Shopify webhook ingestion | Cloudflare Worker + Hyperdrive |
| `admin/` | Cross-tenant back-office | Cloudflare Worker + Hyperdrive |
| `uptime/` | Public status page | Cloudflare Worker + D1 |
| `cleanup_worker/` | Nightly retention sweeps | Cloudflare Worker + Hyperdrive |
| `api_docs/` | Static documentation | Hand-written HTML |

There are **no service-to-service calls**. Every service reads the same
PostgreSQL database directly. That is the architecture's central decision and
the source of most of its constraints.

## Before you change anything

1. **Read the service's own README.** Each one documents its layout, env vars
   and deploy path. `api/README.md` is the deepest and the best starting point.
2. **Find the nearest existing example.** This codebase is consistent by
   convention rather than by abstraction: a new endpoint, page or worker route
   almost always has a close relative to copy from. Matching it is faster and
   more correct than inventing a structure.
3. **Run the service's checks.** See *Commands* below. Nothing is done until
   `tsc` is clean and the tests pass.

## Rules that are not negotiable

- **Never commit secrets.** No tokens, passwords, connection strings, API keys
  or private keys. `.env.example` documents the variables a service needs;
  real values go in `.env` (gitignored) or the platform's secret store.
- **Never commit generated or local state.** `node_modules/`, `dist/`,
  `.output/`, `.wrangler/`, `*.tsbuildinfo`, dev logs and scratch files. If you
  create a temporary file while debugging, remove it before you finish — a
  leftover scratch file is how local paths and credentials end up published.
- **Do not hand-edit across service boundaries.** A change that touches three
  services is three changes, each reviewed and committed in its own service.
- **Tests must pass.** A change is not complete because it compiles; see
  *Verifying your work*.

## Commands

Per service (run from inside the service directory):

```bash
# api/
npm install
npx tsc --noEmit          # typecheck — must be clean
npm test                  # test suite
npm run dev               # dev server on :5000

# frontend/  (and web/)
npm install
npx tsc --noEmit
npm run build             # production build

# any Cloudflare Worker (api_gateway, shopify_integration, admin, uptime, cleanup_worker)
npm install
npx tsc --noEmit
npx wrangler deploy --dry-run   # verifies config + bundling without deploying
```

**Typecheck is not optional and is not the same as a build.** Several bugs in
this codebase's history compiled cleanly and failed at runtime.

## Verifying your work

Compiling is necessary, not sufficient. What "verified" means here:

- **Run it.** Start the service and exercise the change. A passing typecheck on
  an endpoint that returns the wrong shape is still a broken endpoint.
- **For a UI change, open the page and look at it** — at desktop *and* a narrow
  viewport (~390px). Layout bugs do not appear in a typecheck.
- **A test that cannot fail is worthless.** If you add a check, break the code
  on purpose once and confirm the check fails. If it still passes, the test is
  measuring nothing.
- **Re-run the neighbouring checks** after a change, not just the one you added.

## Things that will bite you

Each of these is a real failure that shipped, not a hypothetical.

- **Column names are camelCase and quoted.** Prisma creates `"companyId"`,
  `"createdAt"`, `"orderNumber"`. Snake_case in raw SQL is a runtime error, not
  a warning.
- **IDs are TEXT, not uuid.** `WHERE "companyId" = $1::uuid` fails with
  `operator does not exist: text = uuid`. Cast with `::text`.
- **Enum values come from the database, not from memory.** Query `pg_enum` for
  the real members. A guessed allow-list passes validation and then fails at the
  driver, which is worse than no validation.
- **Row-level security scopes reads.** The restricted database role sees only
  its own company's rows, so a query that "returns nothing" may be correct
  behaviour rather than a bug. Privileged operations use the owner connection.
- **Cloudflare Workers cannot share I/O objects across requests.** Build the
  database client per request and close it in a `finally`. A module-level client
  fails at runtime.
- **The merge is one-way.** Editing a service's files in this tree is discarded
  on the next merge. Change the service repository.
- **`frontend/` and `web/` are separate deployments.** A fix in the dashboard
  does not affect the landing page, and vice versa.

## Style

- **Match the surrounding code.** Naming, structure and comment density should
  look like the file you are editing, not like a different project.
- **Comment the reason, not the mechanics.** `// retry once: the token cache is
  per-process and the first call after a deploy can race` is useful;
  `// increment i` is not. Explain *why* something surprising is the way it is.
- **Arabic UI text is formal (فصحى).** No colloquialisms. The dashboard is
  Arabic-first and RTL; test layout changes in RTL, where `flex-end` resolves to
  the left edge and `margin-left` is not "left" in the visual sense.
- **No dead code.** If you remove a feature, remove its types, helpers, CSS and
  imports too. Unused exports accumulate and mislead.

## When you are unsure

Ask, or leave the code alone. A wrong change that compiles is more expensive
than an unmade one: it looks correct, so it survives review and gets built on.
