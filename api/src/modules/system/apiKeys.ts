import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { audit } from "../../shared/audit.js";
import { env } from "../../config/env.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { notDeleted, orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";
import { generateOpaqueToken, hashToken } from "../../utils/tokens.js";

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------
//
// The plaintext key exists for exactly one response and is never recoverable:
// only its SHA-256 digest is stored. That is the same property as a password,
// and it means a leaked database yields no working credentials.
//
// Keys are shown by prefix afterwards so a human can tell which key is which
// without the secret being available.

export const CreateApiKeySchema = z.object({
  name: z.string().trim().min(1, "الاسم مطلوب.").max(100),
  expiresAt: z.coerce.date().nullish(),
  rateLimitMax: z.coerce.number().int().positive().max(100000).nullish(),
  rateLimitWindowMs: z.coerce.number().int().positive().max(3600000).nullish(),
});

export const UpdateApiKeySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.coerce.date().nullish(),
  rateLimitMax: z.coerce.number().int().positive().max(100000).nullish(),
  rateLimitWindowMs: z.coerce.number().int().positive().max(3600000).nullish(),
});

export const ApiKeyFilterSchema = z.object({
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  isActive: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  rateLimitMax: true,
  rateLimitWindowMs: true,
  createdAt: true,
  createdBy: { select: { id: true, fullName: true } },
} as const;

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewApiKeys),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = ApiKeyFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const where = {
        companyId: req.ctx.companyId!,
        ...notDeleted(input.includeDeleted),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
        ...searchFilter(["name", "keyPrefix"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.apiKey.findMany({
        where,
        orderBy: orderBy(input, ["name", "createdAt", "lastUsedAt"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.apiKey.count({ where });
      return toPage(items, total, input);
    });
  })
);

router.get(
  "/:id",
  requirePermission(Permissions.ViewApiKeys),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const key = await tx.apiKey.findFirst({
        where: { id: param(req, "id"), companyId: req.ctx.companyId!, deletedAt: null },
        select: SELECT,
      });
      if (!key) throw new NotFoundError("مفتاح API غير موجود.");
      return key;
    })
  )
);

/**
 * Issues a key.
 *
 * The response carries `token` — the only time it exists in plaintext
 * anywhere. Everything afterwards refers to the key by id or prefix.
 */
router.post(
  "/",
  requirePermission(Permissions.ManageApiKeys),
  route(
    async (req: AuthedRequest) => {
      const data = CreateApiKeySchema.parse(req.body);

      return scoped(req, async (tx) => {
        const live = await tx.apiKey.count({
          where: { companyId: req.ctx.companyId!, deletedAt: null },
        });
        if (live >= env.MAX_API_KEYS_PER_COMPANY) {
          throw new ConflictError(
            `الحد الأقصى ${env.MAX_API_KEYS_PER_COMPANY} مفاتيح API لكل شركة. احذف مفتاحاً غير مستخدم أولاً.`
          );
        }

        const plaintext = `mz_${generateOpaqueToken(32)}`;
        const prefix = plaintext.slice(0, 12);

        const created = await tx.apiKey.create({
          data: {
            companyId: req.ctx.companyId!,
            name: data.name,
            keyHash: hashToken(plaintext),
            keyPrefix: prefix,
            expiresAt: data.expiresAt ?? null,
            rateLimitMax: data.rateLimitMax ?? null,
            rateLimitWindowMs: data.rateLimitWindowMs ?? null,
            createdById: req.ctx.userId,
          },
          select: SELECT,
        });

        await audit(tx, {
          action: "apiKey.created",
          entity: "ApiKey",
          entityId: created.id,
          summary: `تم إنشاء مفتاح API "${created.name}".`,
        });

        return { ...created, token: plaintext };
      });
    },
    {
      status: 201,
      message: "تم إنشاء المفتاح. انسخه الآن فلن يظهر مرة أخرى.",
    }
  )
);

router.patch(
  "/:id",
  requirePermission(Permissions.ManageApiKeys),
  route(
    async (req: AuthedRequest) => {
      const id = param(req, "id");
      const data = UpdateApiKeySchema.parse(req.body);

      return scoped(req, async (tx) => {
        const existing = await tx.apiKey.findFirst({
          where: { id, companyId: req.ctx.companyId!, deletedAt: null },
          select: { id: true },
        });
        if (!existing) throw new NotFoundError("مفتاح API غير موجود.");

        const updated = await tx.apiKey.update({ where: { id }, data, select: SELECT });

        await audit(tx, {
          action: "apiKey.updated",
          entity: "ApiKey",
          entityId: id,
          summary: `تم تحديث مفتاح API "${updated.name}".`,
          changes: data,
        });

        return updated;
      });
    },
    { message: "تم تحديث المفتاح بنجاح." }
  )
);

/**
 * Revokes a key immediately.
 *
 * Revocation is a distinct state from deletion: the row stays so the audit
 * trail keeps a record of what existed, but `revokedAt` makes it fail
 * authentication from this moment on.
 */
router.post(
  "/:id/revoke",
  requirePermission(Permissions.ManageApiKeys),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const key = await tx.apiKey.findFirst({
        where: { id, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!key) throw new NotFoundError("مفتاح API غير موجود.");

      const updated = await tx.apiKey.update({
        where: { id },
        data: { isActive: false, revokedAt: new Date() },
        select: SELECT,
      });

      await audit(tx, {
        action: "apiKey.revoked",
        entity: "ApiKey",
        entityId: id,
        summary: `تم إبطال مفتاح API "${key.name}".`,
      });

      return updated;
    })
  )
);

router.delete(
  "/:id",
  requirePermission(Permissions.ManageApiKeys),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const key = await tx.apiKey.findFirst({
        where: { id, companyId: req.ctx.companyId!, deletedAt: null },
        select: { id: true, name: true },
      });
      if (!key) throw new NotFoundError("مفتاح API غير موجود.");

      await tx.apiKey.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, revokedAt: new Date() },
      });

      await audit(tx, {
        action: "apiKey.deleted",
        entity: "ApiKey",
        entityId: id,
        summary: `تم حذف مفتاح API "${key.name}".`,
      });

      return null;
    })
  )
);

export { router as apiKeyRoutes };
