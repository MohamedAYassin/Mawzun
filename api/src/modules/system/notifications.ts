import { Router } from "express";
import { z } from "zod";
import { Permissions } from "../../constants/permissions.js";
import { requirePermission } from "../../middleware/authorize.js";
import { NotFoundError } from "../../shared/errors.js";
import { parsePagination, toPage } from "../../shared/pagination.js";
import { orderBy, pageSlice, searchFilter } from "../../shared/query.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
//
// A notification is either addressed to one user or to the whole company
// (`userId` null). Everyone therefore reads the union of "mine" and "ours",
// which is expressed once in `inboxScope` rather than repeated in each query.

export const NotificationFilterSchema = z.object({
  category: z.enum(["GENERAL", "ORDER", "INVENTORY", "SYSTEM"]).optional(),
  isRead: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

const SELECT = {
  id: true,
  title: true,
  message: true,
  category: true,
  link: true,
  isRead: true,
  readAt: true,
  createdAt: true,
} as const;

/** The rows this user is allowed to see: theirs plus the company-wide ones. */
function inboxScope(companyId: string, userId: string) {
  return { companyId, OR: [{ userId: null }, { userId }] };
}

const router = Router();
router.get(
  "/",
  requirePermission(Permissions.ViewNotifications),
  route(async (req: AuthedRequest) => {
    const input = parsePagination(req.query);
    const filter = NotificationFilterSchema.parse(req.query);

    return scoped(req, async (tx) => {
      const companyId = req.ctx.companyId!;
      const where = {
        ...inboxScope(companyId, req.ctx.userId),
        ...(filter.category ? { category: filter.category } : {}),
        ...(filter.isRead === undefined ? {} : { isRead: filter.isRead }),
        ...searchFilter(["title", "message"], input.search),
      };

      // Sequential: `tx` is ONE connection — racing statements on it is not parallel.
      const items = await tx.notification.findMany({
        where,
        orderBy: orderBy(input, ["createdAt", "title"], "createdAt"),
        ...pageSlice(input),
        select: SELECT,
      });
      const total = await tx.notification.count({ where });
      return toPage(items, total, input);
    });
  })
);

/** Cheap enough to poll: one count, no page. */
router.get(
  "/unread-count",
  requirePermission(Permissions.ViewNotifications),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const count = await tx.notification.count({
        where: { ...inboxScope(req.ctx.companyId!, req.ctx.userId), isRead: false },
      });
      return { count };
    })
  )
);

router.post(
  "/:id/read",
  requirePermission(Permissions.ViewNotifications),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const id = param(req, "id");
      const updated = await tx.notification.updateMany({
        where: { id, ...inboxScope(req.ctx.companyId!, req.ctx.userId) },
        data: { isRead: true, readAt: new Date() },
      });
      if (updated.count === 0) throw new NotFoundError("الإشعار غير موجود.");

      return tx.notification.findUniqueOrThrow({ where: { id }, select: SELECT });
    })
  )
);

/**
 * Marks everything as read.
 *
 * Company-wide notifications are per-recipient in effect — one user reading a
 * broadcast must not mark it read for everyone else — so only the rows this
 * user actually owns are touched.
 */
router.post(
  "/read-all",
  requirePermission(Permissions.ViewNotifications),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const result = await tx.notification.updateMany({
        where: {
          companyId: req.ctx.companyId!,
          userId: req.ctx.userId,
          isRead: false,
        },
        data: { isRead: true, readAt: new Date() },
      });
      return { updated: result.count };
    })
  )
);

router.delete(
  "/:id",
  requirePermission(Permissions.ViewNotifications),
  route(async (req: AuthedRequest) =>
    scoped(req, async (tx) => {
      const result = await tx.notification.deleteMany({
        where: { id: param(req, "id"), ...inboxScope(req.ctx.companyId!, req.ctx.userId) },
      });
      if (result.count === 0) throw new NotFoundError("الإشعار غير موجود.");
      return null;
    })
  )
);

export { router as notificationRoutes };
