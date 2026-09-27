// DB access for the admin worker — same shape as the API gateway's:
// Hyperdrive binding in prod, live Heroku Platform API resolution locally.
// One postgres client per request; `sql.end({timeout:1})` in finally.
// No module-level postgres() client: workerd forbids sharing I/O objects
// across requests, so a client built once at import time fails at runtime.

import postgres from "postgres";
import { makeDbUrlResolver } from "./dbUrlResolver.js";

export type Sql = ReturnType<typeof postgres>;

export interface Env {
  ADMIN_PASSWORD: string;
  HEROKU_API_TOKEN: string;
  HEROKU_APP_NAME: string;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_SSL?: string;
  DB_URL_TTL_MS?: string;
  // Optional overrides for impersonation + email copy.
  APP_ORIGIN?: string; // default https://app.mawzun.org
  ADMIN_EMAIL?: string; // where email copies of notifications go
  NOTIFY_EMAIL?: string; // "1" = email copy enabled
  // Dedicated logs database (Postgres). When set, error breadcrumbs are read
  // from here instead of the app database.
  LOG_DATABASE_URL?: string;
  // Grafana Cloud deep links (observability page). Optional: unset = links hidden.
  GRAFANA_BASE_URL?: string; // e.g. https://mohamedayassin.grafana.net
  GRAFANA_METRICS_PUSH_URL?: string; // informational display
  MAILTRAP__APITOKEN?: string;
  MAILTRAP_API_TOKEN?: string;
  MAILTRAP__SENDEREMAIL?: string;
  MAILTRAP_SENDER_EMAIL?: string;
  MAILTRAP__SENDERNAME?: string;
  MAILTRAP_SENDER_NAME?: string;
}

export function makeHyperdriveSql(hd: Hyperdrive): Sql {
  return postgres(hd.connectionString, { max: 2, prepare: false });
}

export function makeSql(databaseUrl: string, env: Env): Sql {
  const parsed = new URL(databaseUrl);
  const schema = parsed.searchParams.get("schema") || undefined;
  parsed.searchParams.delete("schema");
  const sslMode = (parsed.searchParams.get("sslmode") ?? parsed.searchParams.get("ssl") ?? "").toLowerCase();
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("ssl");
  const ssl =
    env.DATABASE_SSL === "1" || sslMode === "require" || sslMode.startsWith("verify")
      ? "require"
      : env.DATABASE_SSL === "0" || sslMode === "disable" || sslMode === "allow" || !parsed.hostname || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
        ? false
        : "require";
  return postgres(parsed.toString(), {
    max: 2,
    prepare: false,
    ...(schema ? { connection: { search_path: schema } } : {}),
    ssl,
  });
}

export async function withSql<T>(env: Env, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const resolver = makeDbUrlResolver(env);
  let sql: Sql;
  if (env.HYPERDRIVE) {
    sql = makeHyperdriveSql(env.HYPERDRIVE);
  } else {
    sql = makeSql(await resolver.get(), env);
  }
  try {
    return await fn(sql);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!env.HYPERDRIVE && /auth|password|credential|28P01|28000/i.test(msg)) {
      resolver.invalidate();
      const retry = makeSql(await resolver.get(), env);
      try {
        return await fn(retry);
      } finally {
        await retry.end({ timeout: 1 }).catch(() => {});
      }
    }
    throw e;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

/**
 * Dedicated logs-database connection (error breadcrumbs). Opens only when
 * LOG_DATABASE_URL is set; a null sql means "read breadcrumbs from the main
 * DB" — callers branch on it. Never uses the Heroku URL resolver: the logs
 * DB is a separate, stable database.
 */
export async function withLogsSql<T>(env: Env, fn: (sql: Sql | null) => Promise<T>): Promise<T> {
  if (!env.LOG_DATABASE_URL) return fn(null);
  const sql = makeSql(env.LOG_DATABASE_URL, { ...env, DATABASE_SSL: undefined });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

/** uuid v7 generator — Prisma's @default(uuid(7)) is client-side, so raw SQL
 *  inserts must supply their own ids. */
export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ts = Date.now();
  // 48 big-endian timestamp bits
  bytes[0] = (ts / 2 ** 40) & 0xff;
  bytes[1] = (ts / 2 ** 32) & 0xff;
  bytes[2] = (ts / 2 ** 24) & 0xff;
  bytes[3] = (ts / 2 ** 16) & 0xff;
  bytes[4] = (ts / 2 ** 8) & 0xff;
  bytes[5] = ts & 0xff;
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** SHA-256 hex digest — must match Backend's hashToken() (utils/tokens.ts). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Per-row unique id for multi-row SQL INSERTs: 48-bit millis timestamp +
 *  80 random bits, hex-encoded. (A single JS uuidv7() constant folded into a
 *  multi-row INSERT ... SELECT gives every row the SAME id → pkey violation.) */
export const SQL_UUID = `(lpad(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0') || substr(md5(random()::text || clock_timestamp()::text), 1, 20))::text`;

/** Opaque random token, base64url — matches Backend generateOpaqueToken shape. */
export function randomToken(bytes = 48): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
