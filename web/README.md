# Mawzun Home

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![Build](https://github.com/MohamedAYassin/Mawzun/actions/workflows/web.yml/badge.svg)](https://github.com/MohamedAYassin/Mawzun/actions/workflows/web.yml)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Wrangler](https://img.shields.io/badge/Wrangler-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)

The **Arabic-first marketing landing** for Mawzun, served at **mawzun.org**.
A single TanStack Start page (SSR + prerendered SPA shell) built to a
Cloudflare Worker — no API calls, no runtime state, no data layer.

Part of the microservice split:

| Directory | Domain | Role |
|---|---|---|
| [`api/`](../api) | `api.mawzun.org` | REST API — the only writer |
| [`frontend/`](../frontend) | `app.mawzun.org` | Dashboard — the product |
| `web/` (this) | `mawzun.org` | Marketing landing (static, no API) |
| [`api_gateway/`](../api_gateway) | `ai.mawzun.org` | Agent API (API-key auth) |
| [`shopify_integration/`](../shopify_integration) | — | Shopify → database ingestion |
| [`admin/`](../admin) | — | Cross-tenant back-office |
| [`uptime/`](../uptime) | `status.mawzun.org` | Uptime monitor |
| [`cleanup_worker/`](../cleanup_worker) | — | Nightly retention sweeps |
| [`api_docs/`](../api_docs) | `docs.mawzun.org` | Documentation for the agent API |

## What it serves

| Route | Screen |
|---|---|
| `/` | Landing (`pages/Welcome`) |
| `/privacy`, `/terms` | Legal pages |
| anything else | Not-found screen |

Paths the landing does not own (`/login`, `/register`, `/forgot-password`,
`/dashboard`…) exit to the app origin (`VITE_APP_ORIGIN`) — see
`src/lib/navigation.ts`.

## Architecture notes

- **No API layer.** The landing is static content: it holds no clients, no
  session state, no fetch calls. Every data operation lives in the app
  frontend. (`lib/api/*` used to ship here for a dashboard-redirect guard that
  read a token from another origin's `localStorage` — unreachable cross-origin,
  so it was dead and was removed.)
- **Standalone Vite config.** `vite.config.ts` wires the stack directly —
  `@tailwindcss/vite`, `vite-tsconfig-paths`, `@tanstack/react-start`,
  build-only `nitro` (`cloudflare-module` preset), `@vitejs/plugin-react`. It
  includes a prerender preview shim so the SPA-shell prerender pass serves the
  nitro worker.

## Development

```sh
npm run dev        # :8082
```

## Build & deploy

```sh
npm run typecheck  # tsc --noEmit
npm run build      # → .output/ (nitro: .output/server worker + .output/public assets)
npm run check      # typecheck + build (the same gate CI runs)
npm run deploy     # build + wrangler deploy
npx wrangler deploy --dry-run   # verify without publishing
```

### The build gate

**A green build is required before anything is merged or deployed.** The
[`Build`](.github/workflows/build.yml) workflow runs on every push to `main`
and every pull request targeting `main`, and must pass:

1. `npm ci` — clean install from the lockfile
2. `npm run typecheck` — `tsc --noEmit`
3. `npm run build` — full vite build (including the SPA-shell prerender)
4. `npx wrangler deploy --dry-run` — the Worker bundle actually assembles

Run the same thing locally before pushing: `npm run check`.

`wrangler.jsonc` targets the `mawzun-homepage` Worker, with `main` at
`.output/server/index.mjs` and assets from `.output/public`.

## Configuration

See [`.env.example`](.env.example). Vite bakes `VITE_*` values at build time.

| Variable | Default | What it does |
|---|---|---|
| `VITE_APP_ORIGIN` | `https://app.mawzun.org` (dev: `http://localhost:8081`) | Origin that `/login`, `/register`, `/dashboard`… exit to |

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see [LICENSE](LICENSE). You may use, modify and share this landing for
personal and noncommercial purposes for free. Hosting it as part of a
commercial product or service requires a separate license — open an issue
or contact the author.
