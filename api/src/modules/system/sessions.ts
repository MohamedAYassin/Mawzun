import { Router } from "express";
import { Permissions } from "../../constants/permissions.js";
import { audit } from "../../shared/audit.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { param, scoped, type AuthedRequest } from "../../shared/request.js";
import { route } from "../../shared/route.js";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
//
// Lets a signed-in user see and end the sessions that are actually live, rather
// than only being able to log themselves out. Replaces the previous tab, which
// offered a single "log out" button precisely because no endpoint existed to
// list anything.
//
// Two scopes, decided server-side from the caller's permissions:
//
//   everyone          their OWN sessions
//   ManageUsers       every member's sessions in the company
//
// The split exists because a session row carries `ipAddress` and `userAgent`.
// Letting any employee read every colleague's device and address would turn a
// self-service screen into a surveillance tool; the owner/admin role that
// already manages users is the one that legitimately needs the company view.
//
// Excluded from both scopes, deliberately:
//   * users with `isPlatformAdmin` — platform staff belong to no company, so a
//     company screen listing their activity would be both confusing and a leak.
//   * sessions with `impersonatedBy` set — those are minted by platform staff
//     impersonating a member. They are surfaced to the affected user by the
//     persistent in-app banner instead (TopBar), which is the right place for
//     that signal, and "log out of all sessions" still revokes them.
//
// RLS note: `sessions` is protected by a policy that scopes rows through the
// owning user's company, so these queries run on the ordinary restricted client
// inside `scoped()`. A caller can never reach another company's rows — that is
// enforced by the database, not by the `where` clauses below.

const router = Router();

/** Hard bound on one response. Live sessions are naturally few (one per
 *  device, and expired ones are excluded), so this is a guard against a
 *  pathological account rather than a paging parameter the UI would need. */
const MAX_ROWS = 500;

interface LiveSessionRow {
  id: string;
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  expiresAt: Date;
}

router.get(
  "/",
  route(async (req: AuthedRequest) => {
    const ctx = req.ctx;
    const seesWholeCompany = ctx.permissions.has(Permissions.ManageUsers);

    return scoped(req, async (tx) => {
      // Flat selects only. A `select` that pulls a relation makes Prisma issue
      // that relation as a SECOND statement, and on a transaction client two
      // concurrent statements race — the reason every list in this codebase
      // hydrates by hand instead.
      const sessions = (await tx.session.findMany({
        where: {
          revokedAt: null,
          expiresAt: { gt: new Date() },
          // Impersonation sessions are minted by platform staff signing in AS a
          // member, so they are "admin sessions" and are excluded here.
          //
          // The trade-off is real and worth stating: this also means a user
          // cannot see or end an admin's impersonation from this screen. That
          // signal is delivered instead by the persistent in-app banner
          // (TopBar), which is the right place for it — the user is told, and
          // "log out of all sessions" still revokes these rows.
          impersonatedBy: null,
          // Narrowing to the caller here, not after the fact: a non-admin must
          // never have another member's row cross the wire at all.
          ...(seesWholeCompany ? {} : { userId: ctx.userId }),
        },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
        select: {
          id: true,
          userId: true,
          userAgent: true,
          ipAddress: true,
          createdAt: true,
          expiresAt: true,
        },
      })) as LiveSessionRow[];

      if (sessions.length === 0) return { sessions: [], scope: seesWholeCompany ? "company" : "own" };

      const userIds = [...new Set(sessions.map((s) => s.userId))];
      const users = await tx.user.findMany({
        where: { id: { in: userIds }, deletedAt: null },
        // Platform staff are excluded here rather than in the query above so
        // the rule is stated once, next to the reason.
        select: { id: true, fullName: true, email: true, isPlatformAdmin: true },
      });
      const byId = new Map(
        users.filter((u) => !u.isPlatformAdmin).map((u) => [u.id, u])
      );

      const items = sessions.flatMap((s) => {
        const user = byId.get(s.userId);
        // Missing from the map means either a deleted user (the FK cascade
        // removes the session anyway) or a platform admin, which this screen
        // deliberately does not list.
        if (!user) return [];
        return [
          {
            id: s.id,
            userAgent: s.userAgent,
            ipAddress: s.ipAddress,
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
            /** True for the session making this request — the UI marks it and
             *  warns before ending it, since that logs the caller out. */
            isCurrent: s.id === ctx.sessionId,
            user: { id: user.id, fullName: user.fullName, email: user.email },
          },
        ];
      });

      return { sessions: items, scope: seesWholeCompany ? "company" : "own" };
    });
  })
);

router.delete(
  "/:id",
  route(async (req: AuthedRequest) => {
    const ctx = req.ctx;
    const id = param(req, "id");
    const canManageOthers = ctx.permissions.has(Permissions.ManageUsers);

    return scoped(req, async (tx) => {
      const session = await tx.session.findUnique({
        where: { id },
        select: { id: true, userId: true, revokedAt: true },
      });

      // Not found covers both "no such session" and "another company's
      // session": RLS hides the latter, so the two are indistinguishable from
      // here — which is the point, and why this cannot leak existence.
      if (!session) throw new NotFoundError("الجلسة غير موجودة.");

      // Authorisation is re-derived from the loaded row, not from the list the
      // client saw. A caller who guesses an id must not be able to end a
      // colleague's session just because the endpoint accepts one.
      if (session.userId !== ctx.userId && !canManageOthers) {
        throw new ForbiddenError("لا يمكنك إنهاء جلسة مستخدم آخر.");
      }

      // Idempotent: ending an already-ended session is a no-op success, not an
      // error. Two admins clicking at once should not see a failure.
      if (session.revokedAt) return { id, revoked: false, alreadyRevoked: true };

      await tx.session.update({ where: { id }, data: { revokedAt: new Date() } });

      // Only the privileged case is audited. Ending your own session is an
      // ordinary logout, and writing a trail row for it would bury the entries
      // that actually matter — an admin terminating someone else's access.
      if (session.userId !== ctx.userId) {
        await audit(tx, {
          action: "session.revoked",
          entity: "session",
          entityId: id,
          summary: "تم إنهاء جلسة مستخدم بواسطة الإدارة.",
        });
      }

      return { id, revoked: true, alreadyRevoked: false, wasCurrent: id === ctx.sessionId };
    });
  })
);

export { router as sessionRoutes };
