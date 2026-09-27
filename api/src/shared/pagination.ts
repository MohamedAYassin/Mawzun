import { z } from "zod";
import { env } from "../config/env.js";
import { ValidationError } from "./errors.js";

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(env.PAGINATION_MAX_PAGE_SIZE).default(10),
  search: z.string().trim().optional(),
  sortBy: z.string().trim().optional(),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  includeDeleted: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export type PaginationInput = z.infer<typeof PaginationSchema>;

/** The subset of a query a page needs. Resources with their own list schema satisfy this. */
export interface PageRequest {
  page: number;
  pageSize: number;
}

/** The subset a sorted query needs. */
export interface SortRequest {
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function parsePagination(query: unknown): PaginationInput {
  const result = PaginationSchema.safeParse(query ?? {});
  if (!result.success) {
    throw new ValidationError("معاملات التصفح غير صالحة.", result.error.issues);
  }
  return result.data;
}

export function toPage<T>(items: T[], total: number, { page, pageSize }: PageRequest): Page<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
