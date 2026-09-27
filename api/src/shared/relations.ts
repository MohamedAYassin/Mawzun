import type { Db } from "../config/database.js";

/**
 * Rows a loader returns. All that is required is the join key: every loader
 * returns a different set of relation keys, and the merged result is typed by
 * the caller's second type argument, not by the loaders.
 *
 * Deliberately NOT `& Record<string, unknown>`: Prisma's generated result types
 * for nested selects are concrete object types, and requiring an index signature
 * rejects them. Runtime behaviour is identical — the extra keys are spread in
 * by Object.assign below.
 */
type LoaderRow = { id: string };
type Loader = (ids: string[]) => PromiseLike<LoaderRow[]>;

/**
 * Loads a page's relations with one query EACH, in sequence, and merges the
 * results by row id.
 *
 * WHY THIS EXISTS
 *
 * Prisma fetches every relation in a `select` with its own SQL statement, and it
 * issues those statements CONCURRENTLY. When the query runs on a transaction
 * client — which is a single Postgres connection — that means two statements in
 * flight on one socket. pg warns about it today:
 *
 *   Calling client.query() when the client is already executing a query is
 *   deprecated and will be removed in pg@9.0
 *
 * and pg 9 will reject it outright. Postgres serialises statements on a
 * connection anyway, so the concurrency buys nothing: it is a race with no
 * payoff.
 *
 * Round-trips are unchanged. Prisma was going to issue these same statements
 * either way; this just stops them overlapping.
 *
 * TYPING
 *
 * The return type is the INPUT row type plus the merged keys. Callers describe
 * what they get with a type argument, e.g.
 *
 *   await mergeRelations<Row, { product: Product }>(tx, rows, [...])
 *
 * The loaders themselves are typed loosely on purpose: each carries different
 * keys, and a strict signature would pin the result to whichever loader came
 * first.
 */
export async function mergeRelations<TRow extends { id: string }, TMerged extends object>(
  _tx: Db,
  rows: TRow[],
  loaders: Loader[]
): Promise<Array<TRow & TMerged>> {
  if (rows.length === 0) return [] as Array<TRow & TMerged>;

  const ids = rows.map((r) => r.id);
  const merged = new Map<string, Record<string, unknown>>(ids.map((id) => [id, {}]));

  for (const load of loaders) {
    // Sequential by construction: awaited inside the loop, never Promise.all.
    const batch = await load(ids);
    for (const row of batch) {
      const target = merged.get(row.id);
      if (!target) continue;
      const { id: _id, ...rest } = row;
      Object.assign(target, rest);
    }
  }

  return rows.map((row) => ({ ...row, ...merged.get(row.id) })) as Array<TRow & TMerged>;
}
