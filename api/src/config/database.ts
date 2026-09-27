import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { env } from "./env.js";

// Two clients, because there are two genuinely different privilege levels.
// This is not an accident of history like the previous pair of clients.
//
//   db      - connects as the restricted application role. Row-level security
//             applies to every statement, so a company can only ever touch its
//             own rows. This is what all request handling uses.
//   dbAdmin - connects as the privileged role and bypasses those policies.
//             It exists for the small number of operations that must happen
//             before a company is known: looking a user up by email at login,
//             creating the first company at signup, rotating refresh tokens,
//             and platform-level administration.
//
// Rule of thumb: if the code has a companyId, use `db`. If it cannot have one
// yet, use `dbAdmin` and say why.

// Connection budget.
//
// Heroku Postgres essential-0 allows 20 connections. This dyno's share is 10,
// expressed as ONE number (`DB_POOL_MAX`, default 10) so the cap is a single
// fact rather than the sum of two pools that have to be reasoned about
// together. The budget is split below.
//
// Why a split at all: the two clients serve different traffic shapes.
//   db      - carries ALL request concurrency, so it gets the larger share.
//   dbAdmin - only pre-auth lookups, signup, token rotation and platform admin,
//             which are short and rare.
// An even split would waste capacity the request path could be using, which is
// the whole point of a pool — 10 real parallel queries instead of a queue.
//
// Prisma's pg adapter defaults each pool to `max: 10` on its own, which silently
// allowed 20 connections from a single dyno. Always set it explicitly.

const POOL_TOTAL = Number(process.env.DB_POOL_MAX ?? 10);
// 70/30 with both sides non-zero, so the split can never starve either client.
const APP_POOL_MAX = Math.max(1, Math.round(POOL_TOTAL * 0.7));
const ADMIN_POOL_MAX = Math.max(1, POOL_TOTAL - APP_POOL_MAX);

const onPoolError = (err: Error) =>
  console.error("[pg-pool] idle client error (auto-recovers on next query):", err.message);

export const db = new PrismaClient({
  adapter: new PrismaPg(
    {
      connectionString: env.DATABASE_URL,
      ssl: pgSsl(env.DATABASE_URL),
      max: APP_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    },
    { onPoolError }
  ),
});

export const dbAdmin = new PrismaClient({
  adapter: new PrismaPg(
    {
      connectionString: env.DIRECT_DATABASE_URL,
      ssl: pgSsl(env.DIRECT_DATABASE_URL),
      max: ADMIN_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    },
    { onPoolError }
  ),
});

/** The resolved budget, for the boot log — a misconfigured pool is otherwise
 *  invisible until it saturates under load. */
export const POOL_BUDGET = {
  total: APP_POOL_MAX + ADMIN_POOL_MAX,
  app: APP_POOL_MAX,
  admin: ADMIN_POOL_MAX,
} as const;

/**
 * TLS for remote hosts, plain TCP for localhost.
 *
 * Managed Postgres (Heroku included) refuses unencrypted connections, while a
 * local development server usually has no certificate set up. The host decides:
 * anything that is not loopback gets TLS, without verifying the chain — managed
 * providers rotate their own certificates, and the credential itself already
 * authenticates us.
 */
function pgSsl(connectionString: string) {
  const host = new URL(connectionString).hostname;
  if (["localhost", "127.0.0.1", "::1"].includes(host)) return undefined;
  return { rejectUnauthorized: false };
}

// The client handed to services: a transaction client, because every request
// runs inside a transaction that carries the company context.
export type Db = Prisma.TransactionClient;
/**
 * A transaction opened on the privileged connection.
 *
 * Structurally the same as `Db`; the separate name is the point, because it
 * states in the signature that the code deliberately sits outside row-level
 * security and should say why.
 */
export type AdminTx = Prisma.TransactionClient;
