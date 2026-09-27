import { env } from "./config/env.js";
import { db, dbAdmin, POOL_BUDGET } from "./config/database.js";
import app from "./app.js";
import { provisionAppRole } from "../scripts/provision-db.mjs";

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
//
// `env` is imported for its side effect: it validates configuration at boot,
// so a missing JWT secret stops the process here with a readable message
// rather than at the first request that happens to need it.

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down.`);
  // closeRateLimitRedis() is intentionally NOT called here: ioredis holds one
  // socket that the process is about to drop anyway, and awaiting a wedged
  // socket would delay shutdown. The pool disconnect below is what matters.
  await Promise.allSettled([db.$disconnect(), dbAdmin.$disconnect()]);
  process.exit(0);
}

async function start(): Promise<void> {
  try {
    // Re-ensure the runtime role's grants on every boot. Normally a no-op
    // that costs a few milliseconds; after a DB restore, role drop, or
    // migrate reset it silently re-heals instead of letting every request
    // die with 'permission denied for schema public'.
    try {
      const result = await provisionAppRole(env.DATABASE_URL, env.DIRECT_DATABASE_URL);
      if (result.status === "skipped") console.log("db provision: " + result.reason);
      else console.log("db provision: " + result.status + " role " + result.role);
    } catch (error) {
      // Non-fatal: the role may already be fully granted, or the operator may
      // run behind a proxy that blocks cross-DB access. RLS policies still
      // protect data; a genuinely ungranted role fails loudly per-request.
      console.warn("db provision skipped:", error instanceof Error ? error.message : error);
    }

    await db.$connect();
  } catch (error) {
    console.error("Could not reach the database:", error);
    process.exit(1);
  }

  const server = app.listen(env.PORT, () => {
    console.log(`Mawzun API listening on port ${env.PORT} (${env.NODE_ENV}).`);
    // Log the resolved connection budget once. A pool cap that silently
    // differs from the intended one is invisible until it saturates under
    // load, which is the worst moment to discover it.
    //
    // Redis reports the CONFIGURED size, not the live one: the pool is built
    // lazily on first rate-limited request, so a process that never checks a
    // limit holds zero sockets.
    console.log(
      `db pool: ${POOL_BUDGET.total} connections (app=${POOL_BUDGET.app}, admin=${POOL_BUDGET.admin})` +
        ` | redis: ${env.REDIS_URL ? `${env.REDIS_POOL_MAX} pooled connection(s)` : "disabled (limiters fail open)"}`
    );
  });

  // Let in-flight requests finish before the pool is torn down.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => {
        void shutdown(signal);
      });
    });
  }
}

void start();
