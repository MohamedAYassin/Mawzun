# Mawzun Docs

Repository: <https://github.com/MohamedAYassin/Mawzun>

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-F38020?logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
[![HTML](https://img.shields.io/badge/HTML-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)

Documentation site for the **Mawzun AI API** — deployed to
**docs.mawzun.org**. Pure static HTML/CSS: no build step, no framework. Any
static host works — Cloudflare Pages, Workers Assets, or plain
`npx wrangler pages deploy .`

Part of the Mawzun service split:

| Directory | Domain | Role |
|---|---|---|
| [`api/`](../api) | `api.mawzun.org` | REST API — the only writer |
| [`frontend/`](../frontend) | `app.mawzun.org` | Dashboard — the product |
| [`web/`](../web) | `mawzun.org` | Marketing landing (static, no API) |
| [`api_gateway/`](../api_gateway) | `ai.mawzun.org` | Agent API (API-key auth) |
| [`shopify_integration/`](../shopify_integration) | — | Shopify → database ingestion |
| [`admin/`](../admin) | — | Cross-tenant back-office |
| [`uptime/`](../uptime) | `status.mawzun.org` | Uptime monitor |
| [`cleanup_worker/`](../cleanup_worker) | — | Nightly retention sweeps |
| `api_docs/` (this) | `docs.mawzun.org` | Documentation for the agent API |

## Structure

- `index.html` — the full API reference (single page, sidebar nav)

## Content source of truth

The docs describe `../api_gateway`'s routes. **When you change an endpoint in
`api_gateway/src/resources.ts` or `resourceSpecs.ts`, update `index.html` to
match.** `api_gateway/verify-resources.mjs` checks the endpoints exist, so a
mismatch between the docs and the route table is catchable rather than silent.

## Deploy

```sh
# Cloudflare Pages (dashboard: connect this folder) or:
npx wrangler pages deploy . --project-name mawzun-docs
```

Then attach `docs.mawzun.org` as the custom domain.

## License

Released under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
— see the [public monorepo LICENSE](https://github.com/MohamedAYassin/Mawzun/blob/main/LICENSE).
You may use, modify and share this for personal and noncommercial purposes for
free. Hosting it as part of a commercial product or service requires a separate
license — open an issue or contact the author.
