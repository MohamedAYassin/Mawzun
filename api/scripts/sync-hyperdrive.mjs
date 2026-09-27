// Sync Heroku's current Postgres password into Cloudflare Hyperdrive.
//
// Heroku rotates DATABASE_URL credentials; Hyperdrive keeps its own copy of
// the origin password, so without this the workers die on the next rotation.
// Run on Heroku Scheduler (e.g. every 10 min) — ON Heroku the DATABASE_URL is
// just an env var, no API token needed for the Heroku side:
//
//   node scripts/sync-hyperdrive.mjs
//
// Required env (set once with `heroku config:set`):
//   CF_HYPERDRIVE_TOKEN  — Cloudflare API token with Hyperdrive Edit on the account
//   CF_ACCOUNT_ID        — Cloudflare account ID (dashboard URL)
//   CF_HYPERDRIVE_ID     — `npx wrangler hyperdrive list` (once created)
//   DATABASE_URL         — already present on every Heroku dyno
//
// The PATCH is idempotent: same values in → no-op effect. Only the password
// fingerprint is ever logged, never the password itself.

import { createHash } from "node:crypto";

const { DATABASE_URL, CF_HYPERDRIVE_TOKEN, CF_ACCOUNT_ID, CF_HYPERDRIVE_ID } = process.env;

function fail(msg) {
  console.error(`sync-hyperdrive: ${msg}`);
  process.exit(1);
}

if (!DATABASE_URL) fail("DATABASE_URL is not set");
if (!CF_HYPERDRIVE_TOKEN) fail("CF_HYPERDRIVE_TOKEN is not set");
if (!CF_ACCOUNT_ID) fail("CF_ACCOUNT_ID is not set");
if (!CF_HYPERDRIVE_ID) fail("CF_HYPERDRIVE_ID is not set");

const parsed = new URL(DATABASE_URL);
const [user, password] = parsed.username
  ? [decodeURIComponent(parsed.username), decodeURIComponent(parsed.password)]
  : fail("DATABASE_URL has no credentials");

const origin = {
  scheme: "postgres",
  host: parsed.hostname,
  port: Number(parsed.port || 5432),
  database: parsed.pathname.replace(/^\//, ""),
  user,
  password,
};

const fp = createHash("sha256").update(password).digest("hex").slice(0, 12);

const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/hyperdrive/configs/${CF_HYPERDRIVE_ID}`,
  {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${CF_HYPERDRIVE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ origin }),
  }
);

if (!res.ok) {
  fail(`Cloudflare API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
console.log(`sync-hyperdrive: origin password synced (fp ${fp})`);
