// PostgreSQL access for the webhook worker.
//
// Every Mawzun service shares one database; this worker never calls another
// service — it reads stores, writes orders/sync_errors directly.
//
// Bindings required:
//   DATABASE_URL  — the shared Postgres connection string
//   APP_SECRET    — key used to decrypt Shopify access tokens
//
// Column names: Prisma creates camelCase quoted identifiers ("companyId",
// "shopifyShopDomain", …) — every query must quote them exactly.

import postgres from "postgres";

// Workerd forbids sharing I/O objects across request contexts, so the client
// is created per request and closed by the caller (index.ts finally block).
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
  // `?schema=public` (a node-postgres-ism in the shared DATABASE_URL) becomes
  // an invalid `schema` parameter. Convert it to the driver's search_path.
  // Same for `sslmode`/`ssl`: Heroku URLs carry `?sslmode=require`, which would
  // also be forwarded as an invalid GUC — read it as the TLS signal, then strip it.
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get("schema") || undefined;
  parsed.searchParams.delete("schema");
  const sslMode = (parsed.searchParams.get("sslmode") ?? parsed.searchParams.get("ssl") ?? "").toLowerCase();
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("ssl");
  // Managed Postgres (Heroku/Supabase/Hyperdrive) requires TLS; local dev does not.
  // The URL's own sslmode wins when present so prod needs no extra flag.
  const ssl = env.DATABASE_SSL === "1" || sslMode === "require" || sslMode === "verify-ca" || sslMode === "verify-full"
    ? "require"
    : env.DATABASE_SSL === "0"
      ? false
      : sslMode === "disable" || sslMode === "allow" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
        ? false
        : "require";
  return postgres(parsed.toString(), {
    max: 2,
    prepare: false, // required behind Hyperdrive
    ...(schema ? { connection: { search_path: schema } } : {}),
    // TLS decided above: URL sslmode wins, localhost defaults off, remote defaults on.
    ssl,
  });
}

export interface StoreRow {
  id: string;
  companyId: string;
  name: string;
  platform: "CUSTOM" | "SHOPIFY";
  storeUrl: string;
  isActive: boolean;
  shopifyAccessToken: string; // sealed
  shopifyWebhookSecret: string;
  shopifyShopDomain: string;
  autoSyncEnabled: boolean;
}

export async function findStoreByDomain(
  sql: Sql,
  shopDomain: string
): Promise<StoreRow | null> {
  const rows = await sql`
    SELECT id, "companyId", name, platform, "storeUrl", "isActive",
           "shopifyAccessToken", "shopifyWebhookSecret", "shopifyShopDomain",
           "autoSyncEnabled"
    FROM stores
    WHERE "deletedAt" IS NULL
      AND platform = 'SHOPIFY'
      AND "isActive" = true
      AND ("shopifyShopDomain" = ${shopDomain} OR "storeUrl" LIKE ${"%" + shopDomain + "%"})
    LIMIT 1`;
  return (rows[0] as unknown as StoreRow) ?? null;
}

export async function touchSyncedAt(sql: Sql, storeId: string) {
  await sql`UPDATE stores SET "lastSyncedAt" = now() WHERE id = ${storeId}`;
}
