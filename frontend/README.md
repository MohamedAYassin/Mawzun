# Mawzun App

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React_19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TanStack Start](https://img.shields.io/badge/TanStack_Start-FF4154?logo=reactquery&logoColor=white)](https://tanstack.com/start)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)](https://vite.dev/)

The **product application** — login, register, password reset, and the whole
dashboard. **TanStack Start** (React + TypeScript + Vite), Arabic-first RTL.
Served at **app.mawzun.org**.

Part of the microservice split:

| Directory | Domain | Role |
|---|---|---|
| [`api/`](../api) | `api.mawzun.org` | REST API — the only writer |
| `frontend/` (this) | `app.mawzun.org` | Dashboard — the product |
| [`web/`](../web) | `mawzun.org` | Marketing landing (static, no API) |
| [`api_gateway/`](../api_gateway) | `ai.mawzun.org` | Agent API (API-key auth) |
| [`shopify_integration/`](../shopify_integration) | — | Shopify → database ingestion |
| [`admin/`](../admin) | — | Cross-tenant back-office |
| [`uptime/`](../uptime) | `status.mawzun.org` | Uptime monitor |
| [`cleanup_worker/`](../cleanup_worker) | — | Nightly retention sweeps |
| [`api_docs/`](../api_docs) | `docs.mawzun.org` | Documentation for the agent API |

The landing was extracted to `web/`; `/` here smart-redirects —
signed-out → `/login`, signed-in → `/dashboard/sales-overview`.

## What it serves

**48 dashboard destinations** across 8 modules, plus the auth screens.

| Module | Screens |
|---|---|
| لوحة التحكم | sales / inventory / accounting overview, reports |
| المبيعات | add-sale, orders, confirmation, customers, coupons, order sources, transactions |
| المخزون | products, product family, stocks, transactions, warehouses, locations, adjustments, transfers, stock counts, alerts |
| المشتريات | purchase orders, vendors, consignment, supplier overview, stock operations, transactions |
| التجهيز والشحن | fulfillment lists, production, batches, scanning (POS), shipping overview, carriers, returns |
| البيانات الأساسية | directory, stores, payment methods |
| الإضافات | apps |
| الإعدادات | system settings, users, access, API keys, integrations, sync errors, change password |

## Architecture notes

- **All API calls go through `src/lib/api/*`.** In dev they pass through the
  same-origin route `src/routes/api/public/proxy/$.ts`; in production
  `src/lib/api/http.ts` calls the backend origin directly.
- **Session model.** Access token in `localStorage`; the refresh token is an
  `HttpOnly; Secure` cookie the JS can never read. Silent refresh rotates the
  pair via `credentials: "include"`. The route guard bounces unauthenticated
  visitors to `/login?redirect=<path>`.
- **Theme is token-driven.** Dark mode is a `[data-theme='dark']` attribute on
  `<html>` that swaps semantic custom properties in `src/index.css`. Prefer
  `var(--text-primary)` / `var(--color-*)` over literal colours — a hardcoded
  value that looks right in light mode is usually invisible in dark mode.
- **`/dashboard/scanning` is deliberately full-screen** — a POS surface with no
  sidebar. That is the design, not a missing layout.
- **Uploads.** Any image field accepts a pasted URL or a file; the shared picker
  in `src/lib/useImageUpload.ts` posts to the backend, which stores to
  Cloudflare R2 and returns the public URL.

## Development

```sh
npm install
npm run dev        # :8080 (or --port 8081 to run beside another dev server)
```

The backend must be running on `:5000` — see `../api/README.md`.

## Build & deploy

```sh
npm run build      # → .output/ (nitro: .output/server worker + .output/public assets)
npm run deploy     # build + wrangler deploy
```

`wrangler.jsonc` targets the `mawzun-app` Worker. The backend must allowlist this
app's origin in `CORS_ORIGIN`.

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see the [public monorepo LICENSE](https://github.com/MohamedAYassin/Mawzun/blob/main/LICENSE).
You may use, modify and share this for personal and noncommercial purposes for
free. Hosting it as part of a commercial product or service requires a separate
license — open an issue or contact the author.
