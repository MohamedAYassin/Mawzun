// API-key authentication + shared DB access for the AI API.
//
// Keys live in the same `api_keys` table the dashboard's API-keys screen
// manages (SHA-256 of the plaintext key, companyId scope). The dashboard
// mints them; this service verifies them.

import postgres from "postgres";

// Workerd does not allow I/O objects (sockets) to be shared across request contexts,
// so the driver client is created per request and closed when the request ends
// (see withSql() in index.ts). Pooling inside one request keeps parallel queries cheap.
export type Sql = ReturnType<typeof postgres>;

// Hyperdrive path (production): the binding speaks the Postgres wire protocol
// over Cloudflare's internal network — pooled at the edge, no TLS fight, no
// per-query socket storm. One pooled client per request, closed in `finally`
// by the caller like every other client here.
export function makeHyperdriveSql(hd: Hyperdrive): Sql {
  return postgres(hd.connectionString, { max: 2, prepare: false });
}

export function makeSql(databaseUrl: string, env: { DATABASE_SSL?: string }): Sql {
  // postgres.js forwards unknown URL query params as Postgres startup GUCs;
  // `?schema=public` (a node-postgres-ism in the shared DATABASE_URL) becomes an
  // invalid `schema` parameter. Convert it to the driver's search_path option instead.
  // Same for `sslmode`/`ssl`: Heroku URLs carry `?sslmode=require`, which would also
  // be forwarded as an invalid GUC — read it as the TLS signal, then strip it.
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get("schema") || undefined;
  parsed.searchParams.delete("schema");
  const sslMode = (parsed.searchParams.get("sslmode") ?? parsed.searchParams.get("ssl") ?? "").toLowerCase();
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("ssl");
  const url = parsed;
  // Managed Postgres (Heroku/Supabase/Hyperdrive) requires TLS; local dev does not.
  // The URL's own sslmode wins when present so prod needs no extra flag.
  const ssl = env.DATABASE_SSL === "1" || sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full"
    ? "require"
    : env.DATABASE_SSL === "0"
      ? false
      : sslMode === "disable" || sslMode === "allow" || !parsed.hostname || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
        ? false
        : "require";
  return postgres(url.toString(), {
    max: 2,
    prepare: false, // required behind Hyperdrive
    ...(schema ? { connection: { search_path: schema } } : {}),
    // TLS decided above: URL sslmode wins, localhost defaults off, remote defaults on.
    ssl,
  });
}

export interface ApiKeyContext {
  companyId: string;
  keyId: string;
  keyName: string;
  /** Per-key throttle override; null = worker env defaults. */
  rateLimitMax: number | null;
  rateLimitWindowMs: number | null;
}

export async function verifyApiKey(sql: Sql, presented: string): Promise<ApiKeyContext | null> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(presented));
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const rows = await sql`
    SELECT id, "companyId", name, "rateLimitMax", "rateLimitWindowMs" FROM api_keys
    WHERE "keyHash" = ${hex} AND "revokedAt" IS NULL AND "deletedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > now())
    LIMIT 1`;
  if (rows.length === 0) return null;

  const key = rows[0];
  // Touch lastUsedAt without blocking the response on completion.
  await sql`UPDATE api_keys SET "lastUsedAt" = now() WHERE id = ${key.id}`;
  return {
    companyId: key.companyId,
    keyId: key.id,
    keyName: key.name,
    rateLimitMax: key.rateLimitMax == null ? null : Number(key.rateLimitMax),
    rateLimitWindowMs: key.rateLimitWindowMs == null ? null : Number(key.rateLimitWindowMs),
  };
}
