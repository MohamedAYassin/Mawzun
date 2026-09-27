import type { Request } from "express";
import { withCompanyScope, type RequestContext } from "../config/companyContext.js";
import type { Db } from "../config/database.js";

export interface AuthedRequest extends Request {
  ctx: RequestContext;
}

/**
 * Runs `fn` inside the request's company scope.
 *
 * Every handler does its database work through this. It opens one transaction
 * per call, applies the row-level security settings to that transaction, and
 * hands the transaction client to the callback. A handler needing several
 * operations should do them all inside a single `scoped` block so they share
 * one transaction.
 */
export function scoped<T>(req: AuthedRequest, fn: (tx: Db) => Promise<T>): Promise<T> {
  return withCompanyScope(req.ctx, fn);
}

/**
 * Reads a path parameter as a string.
 *
 * Express 5 types a parameter as `string | string[]` because a route may repeat
 * a segment; none of our routes do, so this narrows it once instead of casting
 * at every call site.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}
