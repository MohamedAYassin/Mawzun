import { Router } from "express";
import type { z } from "zod";
import type { Db } from "../config/database.js";
import { requirePermission } from "../middleware/authorize.js";
import { audit } from "./audit.js";
import { NotFoundError } from "./errors.js";
import { parsePagination, toPage, type PaginationInput } from "./pagination.js";
import { route } from "./route.js";
import { param, scoped, type AuthedRequest } from "./request.js";

// ---------------------------------------------------------------------------
// The shape every company-scoped resource exposes
// ---------------------------------------------------------------------------

export interface ResourceHandlers<TList, TDetail, TCreate, TUpdate, TFilter> {
  list(
    tx: Db,
    companyId: string,
    input: PaginationInput,
    filter: TFilter
  ): Promise<[TList[], number]>;
  detail(tx: Db, companyId: string, id: string): Promise<TDetail | null>;
  create(tx: Db, companyId: string, data: TCreate): Promise<TDetail>;
  update(tx: Db, companyId: string, id: string, data: TUpdate): Promise<TDetail>;
  remove(tx: Db, companyId: string, id: string): Promise<void>;
}

export interface ResourceConfig<TList, TDetail, TCreate, TUpdate, TFilter> {
  /** Name written to the audit log, e.g. "Product". */
  entity: string;
  /** Route path when this resource is mounted under a domain router. */
  path?: string;
  createSchema: z.ZodType<TCreate>;
  updateSchema: z.ZodType<TUpdate>;
  /** Reading requires one of these; writing requires one of `manage`. */
  view: string[];
  manage: string[];
  /** Small reference lists skip pagination and return a bare array. */
  unpaginated?: boolean;
  /**
   * Query-string filters beyond pagination. Parsed once here and handed to the
   * list handler as a value object, so each resource declares exactly which
   * filters it supports instead of reading `req.query` ad hoc.
   */
  filterSchema?: z.ZodType<TFilter>;
  handlers: ResourceHandlers<TList, TDetail, TCreate, TUpdate, TFilter>;
}

/**
 * Builds the standard five routes for a company-scoped resource.
 *
 * This router deliberately declares no authentication. It is always mounted
 * underneath a domain router, and every domain router is mounted after
 * `authenticate` in `createApiRouter` — so a request that reaches these
 * handlers already has a resolved `req.ctx`. Repeating `authenticate` here ran
 * the same user lookup twice per request for no additional guarantee; the
 * boundary test in tests/routing.test.ts is what keeps that honest.
 *
 * Every query goes through `scoped()`, so the company filter and row-level
 * security are applied by the infrastructure rather than remembered by the
 * author of each endpoint. The handlers receive `companyId` explicitly and
 * must use it — the database would reject a mismatch anyway, but passing it
 * makes every query an index lookup instead of a policy scan.
 */
export function defineResource<TList, TDetail, TCreate, TUpdate, TFilter = Record<string, unknown>>(
  config: ResourceConfig<TList, TDetail, TCreate, TUpdate, TFilter>
): Router {
  const router = Router();
  const { handlers, entity, unpaginated = false } = config;

  router.get(
    "/",
    requirePermission(...config.view),
    route(async (req: AuthedRequest) => {
      const input = parsePagination(req.query);
      const filter = (config.filterSchema?.parse(req.query) ?? {}) as TFilter;

      return scoped(req, async (tx) => {
        const companyId = requireCompany(req);
        if (unpaginated) {
          const [items] = await handlers.list(tx, companyId, input, filter);
          return items;
        }
        const [items, total] = await handlers.list(tx, companyId, input, filter);
        return toPage(items, total, input);
      });
    })
  );

  router.get(
    "/:id",
    requirePermission(...config.view),
    route(async (req: AuthedRequest) =>
      scoped(req, async (tx) => {
        const found = await handlers.detail(tx, requireCompany(req), param(req, "id"));
        if (!found) throw new NotFoundError("العنصر المطلوب غير موجود.");
        return found;
      })
    )
  );

  router.post(
    "/",
    requirePermission(...config.manage),
    route(
      async (req: AuthedRequest) =>
        scoped(req, async (tx) => {
          const companyId = requireCompany(req);
          const data = config.createSchema.parse(req.body);
          const created = await handlers.create(tx, companyId, data);
          await audit(tx, {
            action: `${camel(entity)}.created`,
            entity,
            entityId: idOf(created),
            summary: `تم إنشاء ${entity}.`,
          });
          return created;
        }),
      { status: 201, message: "تم الإنشاء بنجاح." }
    )
  );

  router.patch(
    "/:id",
    requirePermission(...config.manage),
    route(
      async (req: AuthedRequest) =>
        scoped(req, async (tx) => {
          const companyId = requireCompany(req);
          const data = config.updateSchema.parse(req.body);
          const updated = await handlers.update(tx, companyId, param(req, "id"), data);
          await audit(tx, {
            action: `${camel(entity)}.updated`,
            entity,
            entityId: idOf(updated),
            summary: `تم تحديث ${entity}.`,
            changes: data,
          });
          return updated;
        }),
      { message: "تم التحديث بنجاح." }
    )
  );

  router.delete(
    "/:id",
    requirePermission(...config.manage),
    route(async (req: AuthedRequest) =>
      scoped(req, async (tx) => {
        const companyId = requireCompany(req);
        const id = param(req, "id");
        await handlers.remove(tx, companyId, id);
        await audit(tx, {
          action: `${camel(entity)}.deleted`,
          entity,
          entityId: id,
          summary: `تم حذف ${entity}.`,
        });
        return null;
      })
    )
  );

  return router;
}

function requireCompany(req: AuthedRequest): string {
  if (!req.ctx.companyId) {
    throw new NotFoundError("هذا الحساب غير مرتبط بشركة.");
  }
  return req.ctx.companyId;
}

/** "ProductVariant" -> "productVariant", used to build audit action names. */
function camel(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * Audit entries need the row id. Handlers return whatever shape the endpoint
 * exposes, so the id is read off the result rather than requiring every
 * handler to also return it separately.
 */
function idOf(value: unknown): string | null {
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

