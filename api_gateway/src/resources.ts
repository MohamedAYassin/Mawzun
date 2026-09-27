// Generic company-scoped CRUD for the AI API.
//
// The dashboard exposes ~30 resource families, each with the same five verbs.
// Hand-writing them here produced a surface where an agent could create an order
// but not a category, which is the gap this file closes. Writing 150 handlers by
// hand would also guarantee they drift apart — one soft-deleting, another
// hard-deleting, a third forgetting the company filter.
//
// So each resource is DECLARED once, and the five routes are generated from that
// declaration. This mirrors the Backend's `defineResource` on purpose: the two
// surfaces should agree about what "delete" means for the same table.
//
// Three rules the factory enforces so a declaration cannot get them wrong:
//
//   1. Every statement is scoped by `companyId`, and the value comes from the
//      verified API key — never from the request body.
//   2. Column names come from the declaration, never from input. A body key that
//      is not declared is IGNORED rather than interpolated, so a caller cannot
//      name a column to write (`companyId`, `deletedAt`, `isPlatformAdmin`).
//   3. Deleting soft-deletes when the table has `deletedAt`, and only removes
//      rows otherwise. Getting this backwards on a soft-delete table would
//      orphan the order lines that reference it.

import type { Sql } from "./auth";
import { json, type HandlerCtx, type Route } from "./routes";

export interface FieldSpec {
  /** Database column. Quoted as an identifier, never interpolated raw. */
  col: string;
  type: "string" | "text" | "int" | "num" | "bool" | "date" | "json";
  required?: boolean;
  max?: number;
  min?: number;
  /** Allowed values for a Postgres enum column. */
  values?: readonly string[];
  /** Reference to another company-scoped table; verified to exist on write. */
  fk?: { table: string; label: string };
  /** Applied when the field is absent on create. */
  fallback?: unknown;
}

export interface ResourceSpec {
  /** Route prefix, e.g. "/v1/categories". */
  path: string;
  table: string;
  /** Used in error messages: "category not found". */
  label: string;
  /** True when the table has `deletedAt` (soft delete) — see rule 3. */
  softDelete: boolean;
  /** True when the table has `updatedAt` that raw SQL must set explicitly. */
  hasUpdatedAt: boolean;
  /** Columns returned to the client. */
  select: string;
  fields: FieldSpec[];
  /** Column to sort by; defaults to createdAt when present. */
  orderBy?: string;
}

type Body = Record<string, unknown>;

const newId = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function fail(err: unknown): Response {
  if (err && typeof err === "object" && "status" in err) {
    const e = err as { status: number; message: string };
    return json({ error: e.message }, e.status);
  }
  // Postgres reports a constraint violation as a SQLSTATE. Surfacing it as a
  // 500 would be wrong twice over: the request was invalid (not the server), and
  // the caller learns nothing about how to fix it.
  //
  //   23505 unique_violation — a duplicate name/code. The Backend answers 409
  //         for the same situation (verified against POST
  //         /api/v1/catalog/categories with a name that already exists), so a
  //         500 here would make the two APIs disagree about the same input.
  //   23503 foreign_key_violation — a referenced row vanished between the
  //         check and the insert; a 400 is right because the body is at fault.
  //
  // 23505 is reachable in normal use, not just under a race: these tables are
  // unique on (companyId, name) WITHOUT deletedAt, so a soft-deleted row keeps
  // holding its name. Deleting then re-creating the same name lands here.
  const code = (err as { code?: string })?.code;
  if (code === "23505") return json({ error: "a record with that name or code already exists" }, 409);
  if (code === "23503") return json({ error: "referenced record not found" }, 400);
  // Anything else is a genuine server fault; do not leak SQL or a stack.
  return json({ error: "internal error" }, 500);
}

function bodyOf(ctx?: HandlerCtx): Body {
  const b = ctx?.body;
  return b && typeof b === "object" ? (b as Body) : {};
}

/**
 * Coerces one field, or rejects it.
 *
 * `undefined` means "absent", which is different from `null` ("explicitly
 * cleared") — a PATCH that omits a field must leave it alone, while a PATCH that
 * sends null must clear it. Collapsing the two is how a partial update wipes
 * columns it never mentioned.
 */
function coerce(field: FieldSpec, raw: unknown): unknown {
  if (raw === undefined) return undefined;
  if (raw === null) return null;

  switch (field.type) {
    case "string":
    case "text": {
      if (typeof raw !== "string" && typeof raw !== "number") {
        throw { status: 400, message: `${field.col} must be a string` };
      }
      const s = String(raw).trim();
      if (s === "") return null;
      if (field.max && s.length > field.max) throw { status: 400, message: `${field.col} max ${field.max}` };
      if (field.values && !field.values.includes(s)) {
        throw { status: 400, message: `${field.col} must be one of: ${field.values.join(", ")}` };
      }
      return s;
    }
    case "int":
    case "num": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw { status: 400, message: `${field.col} must be a number` };
      if (field.type === "int" && !Number.isInteger(n)) throw { status: 400, message: `${field.col} must be an integer` };
      if (field.min !== undefined && n < field.min) throw { status: 400, message: `${field.col} min ${field.min}` };
      if (field.max !== undefined && n > field.max) throw { status: 400, message: `${field.col} max ${field.max}` };
      return n;
    }
    case "bool": {
      if (typeof raw !== "boolean") throw { status: 400, message: `${field.col} must be a boolean` };
      return raw;
    }
    case "date": {
      const d = new Date(String(raw));
      if (Number.isNaN(d.getTime())) throw { status: 400, message: `${field.col} must be a date` };
      return d.toISOString();
    }
    case "json":
      return raw;
  }
}

/** Verifies a foreign key exists IN THIS COMPANY before it is written. */
async function checkFk(sql: Sql, companyId: string, field: FieldSpec, value: unknown): Promise<string | null> {
  if (value === null || value === undefined) return null;
  const fk = field.fk;
  if (!fk) return String(value);
  const v = String(value);
  const rows = await sql`
    SELECT id FROM ${sql(fk.table)}
    WHERE "companyId" = ${companyId} AND id = ${v}
    LIMIT 1`;
  if (rows.length === 0) throw { status: 400, message: `${fk.label} not found` };
  return v;
}

/** Builds the column→value map for an insert, applying defaults. */
async function buildInsert(spec: ResourceSpec, sql: Sql, companyId: string, body: Body): Promise<Body> {
  const out: Body = {};
  for (const f of spec.fields) {
    let v = coerce(f, body[f.col]);
    if (v === undefined) {
      if (f.required) throw { status: 400, message: `${f.col} is required` };
      if (f.fallback !== undefined) v = f.fallback;
      else continue;
    }
    // coerce() maps "" to null so a PATCH can clear an optional field. On a
    // required column that null is a NOT NULL violation, which would surface as
    // a 500; an empty string is a client mistake, so say so.
    if (v === null && f.required) {
      throw { status: 400, message: `${f.col} is required` };
    }
    if (f.fk && v !== null) v = await checkFk(sql, companyId, f, v);
    out[f.col] = v;
  }
  return out;
}

/** Builds only the columns a PATCH actually mentioned. */
async function buildPatch(spec: ResourceSpec, sql: Sql, companyId: string, body: Body): Promise<Body> {
  const out: Body = {};
  for (const f of spec.fields) {
    let v = coerce(f, body[f.col]);
    if (v === undefined) continue;
    if (f.required && v === null) throw { status: 400, message: `${f.col} cannot be cleared` };
    if (f.fk && v !== null) v = await checkFk(sql, companyId, f, v);
    out[f.col] = v;
  }
  if (Object.keys(out).length === 0) throw { status: 400, message: "no updatable fields supplied" };
  return out;
}

/**
 * Registers the five routes for one resource onto the shared route tables.
 *
 * `all` receives every route; reads and writes share one table here (unlike the
 * Backend, where they are separate files) because the factory is the only
 * producer and splitting it would mean two registries for one concept.
 */
export function defineResource(spec: ResourceSpec, all: Route[]): void {
  const push = (method: string, pattern: string, handler: Route["handler"]) =>
    all.push({ method, segments: pattern.split("/").filter(Boolean), handler });

  const orderCol = spec.orderBy ?? (spec.select.includes("createdAt") ? "createdAt" : "id");

  // ── LIST ──────────────────────────────────────────────────────────────────
  push("GET", spec.path, async (sql, companyId, _p, url) => {
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
    const search = url.searchParams.get("search");
    const activeOnly = url.searchParams.get("activeOnly") === "true";

    const hasName = spec.fields.some((f) => f.col === "name");
    const hasActive = spec.fields.some((f) => f.col === "isActive");
    const rows = await sql`
      SELECT ${sql.unsafe(spec.select)} FROM ${sql(spec.table)}
      WHERE "companyId" = ${companyId}
        ${spec.softDelete ? sql`AND "deletedAt" IS NULL` : sql``}
        ${search && hasName ? sql`AND name ILIKE ${"%" + search + "%"}` : sql``}
        ${activeOnly && hasActive ? sql`AND "isActive" = true` : sql``}
      ORDER BY ${sql(orderCol)} DESC
      LIMIT ${limit} OFFSET ${offset}`;
    return json({ items: rows, count: rows.length, limit, offset });
  });

  // ── DETAIL ────────────────────────────────────────────────────────────────
  push("GET", `${spec.path}/:id`, async (sql, companyId, p) => {
    const rows = await sql`
      SELECT ${sql.unsafe(spec.select)} FROM ${sql(spec.table)}
      WHERE "companyId" = ${companyId} AND id = ${p.id}
        ${spec.softDelete ? sql`AND "deletedAt" IS NULL` : sql``}
      LIMIT 1`;
    if (rows.length === 0) return json({ error: `${spec.label} not found` }, 404);
    return json(rows[0]);
  });

  // ── CREATE ────────────────────────────────────────────────────────────────
  push("POST", spec.path, async (sql, companyId, _p, _u, ctx) => {
    try {
      const values = await buildInsert(spec, sql, companyId, bodyOf(ctx));
      const id = newId();
      const row: Body = { id, companyId, ...values };
      // Prisma's @updatedAt is applied by the client, so raw SQL writes it.
      if (spec.hasUpdatedAt) row.updatedAt = nowIso();
      if (spec.select.includes("createdAt")) row.createdAt = nowIso();

      const cols = Object.keys(row);
      await sql`INSERT INTO ${sql(spec.table)} ${sql(row, ...cols)}`;

      const created = await sql`
        SELECT ${sql.unsafe(spec.select)} FROM ${sql(spec.table)}
        WHERE "companyId" = ${companyId} AND id = ${id} LIMIT 1`;
      return json(created[0], 201);
    } catch (e) {
      return fail(e);
    }
  });

  // ── UPDATE ────────────────────────────────────────────────────────────────
  push("PATCH", `${spec.path}/:id`, async (sql, companyId, p, _u, ctx) => {
    try {
      const values = await buildPatch(spec, sql, companyId, bodyOf(ctx));
      if (spec.hasUpdatedAt) values.updatedAt = nowIso();

      const cols = Object.keys(values);
      const updated = await sql`
        UPDATE ${sql(spec.table)} SET ${sql(values, ...cols)}
        WHERE "companyId" = ${companyId} AND id = ${p.id}
        ${spec.softDelete ? sql`AND "deletedAt" IS NULL` : sql``}
        RETURNING id`;
      if (updated.length === 0) return json({ error: `${spec.label} not found` }, 404);

      const rows = await sql`
        SELECT ${sql.unsafe(spec.select)} FROM ${sql(spec.table)}
        WHERE "companyId" = ${companyId} AND id = ${p.id} LIMIT 1`;
      return json(rows[0]);
    } catch (e) {
      return fail(e);
    }
  });

  // ── DELETE ────────────────────────────────────────────────────────────────
  push("DELETE", `${spec.path}/:id`, async (sql, companyId, p) => {
    // Soft delete where the table supports it: the row is referenced by
    // historical documents (an order keeps its category), so removing it
    // outright would orphan them. Matches the Backend's behaviour for the same
    // table, which is the point of mirroring it.
    const removed = spec.softDelete
      ? await sql`
          UPDATE ${sql(spec.table)} SET "deletedAt" = now()
          WHERE "companyId" = ${companyId} AND id = ${p.id} AND "deletedAt" IS NULL
          RETURNING id`
      : await sql`
          DELETE FROM ${sql(spec.table)}
          WHERE "companyId" = ${companyId} AND id = ${p.id}
          RETURNING id`;
    if (removed.length === 0) return json({ error: `${spec.label} not found` }, 404);
    return json({ deleted: true, id: p.id, soft: spec.softDelete });
  });
}
