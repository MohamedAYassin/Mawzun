import type { PageRequest, SortRequest } from "./pagination.js";

/**
 * Query fragments shared by every list endpoint.
 *
 * These return plain objects that Prisma accepts, so each repository keeps its
 * own fully typed `where` while the repeated parts — soft-delete filtering,
 * case-insensitive search, validated sorting — are written once.
 */

/** Most models keep history, so the default is to hide soft-deleted rows. */
export function notDeleted(includeDeleted: boolean): Record<string, unknown> {
  return includeDeleted ? {} : { deletedAt: null };
}

/** Case-insensitive `contains` across the given columns. */
export function searchFilter(fields: readonly string[], search?: string): Record<string, unknown> {
  const term = search?.trim();
  if (!term || fields.length === 0) return {};
  return {
    OR: fields.map((field) => ({ [field]: { contains: term, mode: "insensitive" as const } })),
  };
}

/**
 * Sorts by the requested column when it is in the allow-list, otherwise by the
 * fallback. The allow-list is what stops a client from sorting on an
 * unindexed column and turning every list into a sequential scan.
 */
export function orderBy(
  input: SortRequest,
  allowed: readonly string[],
  fallback: string
): Record<string, unknown> {
  const field = input.sortBy && allowed.includes(input.sortBy) ? input.sortBy : fallback;
  return { [field]: input.sortDir ?? "desc" };
}

export function pageSlice({ page, pageSize }: PageRequest): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
