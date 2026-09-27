// Edge case the boundary checks do not cover: sessions reference each other.
//
// `sessions."replacedById"` is a self-referencing FK (onDelete: SetNull), used
// to record refresh-token rotation. A naive DELETE over a table with a
// self-reference can either fail on the constraint or leave a dangling link,
// and the nightly cron would then report an error (or worse, succeed while
// corrupting the chain).
//
// This seeds a real rotation chain and asserts the sweep handles it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { runAllSweeps } from "./src/sweeps.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = readFileSync(resolve(HERE, "../api/.env"), "utf8");
const url = env.match(/^DIRECT_DATABASE_URL="?([^"\n]+)"?/m)[1].replace(/\?schema=\w+$/, "");
const sql = postgres(url, { max: 2, prepare: false });

const RUN = `rot-${Date.now()}`;
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

const [user] = await sql`SELECT id FROM users LIMIT 1`;
if (!user) throw new Error("no user to attach sessions to");

const created = [];
let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  if (ok) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}  ${d}`); }
};

try {
  // Session B is the SUCCESSOR. Session A points at it.
  const [b] = await sql`
    INSERT INTO sessions (id, "userId", "refreshToken", "expiresAt", "revokedAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${user.id}, ${RUN + "-B"}, ${daysAgo(60)}, ${daysAgo(60)}, now(), now())
    RETURNING id`;
  const [a] = await sql`
    INSERT INTO sessions (id, "userId", "refreshToken", "expiresAt", "revokedAt", "replacedById", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${user.id}, ${RUN + "-A"}, ${daysAgo(60)}, ${daysAgo(60)}, ${b.id}, now(), now())
    RETURNING id`;
  created.push(a.id, b.id);

  const chain = (await sql`SELECT "replacedById" FROM sessions WHERE id = ${a.id}`)[0];
  check("fixture: rotation link is in place", chain.replacedById === b.id, `got ${chain.replacedById}`);

  // Run the real sweeps.
  const results = await runAllSweeps(sql, {
    SESSION_RETENTION_DAYS: 45,
    PASSWORD_RESET_RETENTION_DAYS: 1,
    NOTIFICATION_RETENTION_DAYS: 14,
    SYNC_ERROR_RETENTION_DAYS: 90,
    AUDIT_LOG_RETENTION_DAYS: 365,
  });

  const sessionSweeps = results.filter((r) => r.label.startsWith("sessions"));
  check("no sweep errored on the self-reference", sessionSweeps.every((r) => !r.error),
        JSON.stringify(sessionSweeps.filter((r) => r.error)));

  const left = await sql`SELECT count(*)::int n FROM sessions WHERE id IN (${a.id}, ${b.id})`;
  check("both chained sessions deleted", left[0].n === 0, `remaining=${left[0].n}`);

  // And the reverse direction: successor deleted while predecessor survives.
  // (Possible when the predecessor was rotated recently but the successor's own
  // expiry is already past.) The FK is SetNull, so this must not throw.
  const [p] = await sql`
    INSERT INTO sessions (id, "userId", "refreshToken", "expiresAt", "revokedAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${user.id}, ${RUN + "-P"}, ${daysAgo(-5)}, ${daysAgo(0.1)}, now(), now())
    RETURNING id`;
  const [s] = await sql`
    INSERT INTO sessions (id, "userId", "refreshToken", "expiresAt", "revokedAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, ${user.id}, ${RUN + "-S"}, ${daysAgo(60)}, ${daysAgo(60)}, now(), now())
    RETURNING id`;
  await sql`UPDATE sessions SET "replacedById" = ${s.id} WHERE id = ${p.id}`;
  created.push(p.id, s.id);

  const r2 = await runAllSweeps(sql, {
    SESSION_RETENTION_DAYS: 45, PASSWORD_RESET_RETENTION_DAYS: 1,
    NOTIFICATION_RETENTION_DAYS: 14, SYNC_ERROR_RETENTION_DAYS: 90, AUDIT_LOG_RETENTION_DAYS: 365,
  });
  check("deleting a pointed-at successor does not error",
        r2.filter((r) => r.label.startsWith("sessions")).every((r) => !r.error));

  const p2 = (await sql`SELECT "replacedById", "revokedAt" FROM sessions WHERE id = ${p.id}`)[0];
  check("predecessor survived (inside retention)", !!p2, "predecessor was deleted");
  check("predecessor's link was nulled, not dangling", p2 && p2.replacedById === null,
        p2 ? `replacedById=${p2.replacedById}` : "row gone");
  check("predecessor still revoked (replay detection intact)", p2 && p2.revokedAt !== null);
} finally {
  await sql`DELETE FROM sessions WHERE id = ANY(${created})`.catch(() => {});
  const n = (await sql`SELECT count(*)::int n FROM sessions WHERE "refreshToken" LIKE ${RUN + "%"}`)[0].n;
  console.log(`\ncleanup: fixtures removed (leftover: ${n})`);
  await sql.end({ timeout: 1 }).catch(() => {});
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
