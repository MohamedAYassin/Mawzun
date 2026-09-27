# Contributing to Mawzun

Thanks for your interest. This document covers how to get set up, what we expect
from a change, and how to get it merged.

## Before you start

- **Read [`AGENTS.md`](AGENTS.md)** if you use an AI coding assistant. It covers
  the constraints that apply to agent-authored changes, which are the same ones
  that apply to human ones.
- **Open an issue first for anything substantial.** A new endpoint, a schema
  change, a new service, or a behavioural change to an existing one. It is much
  cheaper to agree on an approach before the code exists than after. Small fixes
  — a typo, a broken link, an obvious bug — can go straight to a pull request.
- **Check the service README.** Each service documents its own layout, env vars
  and deploy path. `api/README.md` is the most detailed and the best starting
  point for understanding the system.

## Repository layout

This repository is the **merged** view: nine services in one tree so the whole
architecture can be read end to end.

| Directory | Service |
|---|---|
| `api/` | REST API (Express + Prisma + PostgreSQL) |
| `frontend/` | Dashboard application |
| `web/` | Marketing landing page |
| `api_gateway/` | Agent API for AI clients |
| `shopify_integration/` | Shopify webhook ingestion |
| `admin/` | Cross-tenant back-office |
| `uptime/` | Public status page |
| `cleanup_worker/` | Nightly retention sweeps |
| `api_docs/` | Static API documentation |

Each service is also developed in its own repository, where its history and CI
live. This tree is assembled from those. If you are working on a service you
have write access to, **open your pull request there** — changes made directly
to a service's files here are overwritten the next time the tree is merged. For
everything else, a pull request here is fine.

## Getting set up

Each service is self-contained. Pick the one you are working on:

```bash
cd api                 # or frontend, api_gateway, …
npm install
cp .env.example .env   # then fill in the values the README describes
```

You need **Node.js 22** (see each service's `.nvmrc`) and **PostgreSQL 16** for
anything that touches the database. Worker services additionally need a
Cloudflare account for `wrangler`; most can be developed locally with
`wrangler dev`.

Nothing here requires paid infrastructure to run or to test. The test suites use
a local database.

## Making a change

1. **Branch from `main`.** Use a descriptive name: `fix/invoice-rounding`,
   `feat/stock-transfer-endpoint`.
2. **Keep the change focused.** One concern per pull request. A refactor mixed
   with a behaviour change cannot be reviewed properly, and will be sent back.
3. **Match the surrounding code.** Naming, structure, error handling and
   comment density should look like the file you are editing.
4. **Comment the reason, not the mechanics.** Explain why something surprising
   is the way it is. `// retry once: the cache is per-process, so the first call
   after a deploy can race` earns its place; `// increment i` does not.
5. **No dead code.** Removing a feature means removing its types, helpers, CSS
   and imports too.

### Arabic UI text

The dashboard is Arabic-first and RTL. UI strings must be **formal Modern
Standard Arabic (فصحى)** — no colloquialisms or slang. If you are adding a
string and are not confident, say so in the pull request and a maintainer will
review the wording.

Layout changes must be checked in RTL. In a right-to-left document `flex-end`
resolves to the *left* edge, and `margin-left` is not visually "left" — both
have caused real bugs here.

## Tests must pass

**A pull request is not mergeable until CI is green.** That means:

```bash
npx tsc --noEmit    # typecheck — must be clean, no new errors
npm test            # test suite — must pass
```

for the service you changed, plus `npm run build` for the frontends.

Beyond that, "it compiles" is not "it works":

- **Run the change.** Start the service and exercise it. An endpoint that
  compiles and returns the wrong shape is still broken.
- **For a UI change, open the page and look at it** — at desktop width *and* a
  narrow viewport (~390px). Layout bugs do not show up in a typecheck.
- **If you add a test, prove it can fail.** Break the code on purpose once and
  confirm the test catches it. A test that passes against broken code is
  measuring nothing, and we would rather have no test than a false one.
- **Re-run the neighbouring tests**, not just the one you added.

CI runs the same commands. If it passes locally and fails in CI, the usual cause
is a service you did not run — check whether your change touches more than one.

## Pull requests

A good pull request here:

- **Explains the problem, not just the diff.** What was wrong, what you changed,
  and why this approach over the alternatives you considered.
- **Says how you verified it.** "Ran the endpoint, got this response" or
  "opened the page at 1920 and 390, screenshots attached" — not "should work".
- **Notes what you did not do.** Known gaps, follow-up work, or edge cases you
  deliberately left out. This is genuinely useful; it is not a weakness.
- **Keeps the diff reviewable.** If it is large, say where the reviewer should
  start.

Small, honest pull requests get merged quickly. Large ones that mix concerns
take much longer, and usually end up split anyway.

## Security

**Do not open a public issue for a security problem.** Report it privately by
contacting a maintainer directly — see the repository's contact details.

Never commit secrets. No tokens, passwords, connection strings, API keys or
private keys — not in code, not in a test fixture, not in a comment. Use
`.env` (gitignored) or the platform's secret store. If you commit one by
accident, say so immediately: a rotated key is a minor inconvenience, a leaked
one is not.

## Licence

By contributing, you agree that your contributions are licensed under the same
terms as this repository. See [`LICENSE`](LICENSE).
