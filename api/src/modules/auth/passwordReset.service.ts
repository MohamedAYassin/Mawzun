import { createHash, randomBytes } from "node:crypto";
import { dbAdmin } from "../../config/database.js";
import { checkLimit } from "../../lib/rateLimit.js";
import { sendEmail } from "../../utils/mail.js";
import { BadRequestError } from "../../shared/errors.js";

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------
//
// Flow (owner-only):
//   POST /auth/forgot-password/check  { email } → { accountKind } so the form
//     can tell a tenant to ask their owner BEFORE they submit anything.
//   POST /auth/forgot-password        { email } → owner gets an email with a
//     reset link valid 24h. A tenant gets the same generic success response,
//     but nothing is sent. Throttled in Redis: one request per user per
//     RATE_LIMIT_RESET window.
//   POST /auth/reset-password         { token, newPassword } → consumes the
//     token, hashes the new password, bumps securityStamp (kills all sessions).

import { env } from "../../config/env.js";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type AccountKind = "owner" | "tenant" | "unknown";

/** Who is this email? Used by the pre-check so tenants are told upfront. */
export async function classifyEmail(email: string): Promise<AccountKind> {
  const user = await dbAdmin.user.findUnique({
    where: { email },
    select: {
      id: true,
      deletedAt: true,
      passwordHash: true,
      isPlatformAdmin: true,
      ownedCompany: { select: { id: true } },
    },
  });

  if (!user || user.deletedAt || !user.passwordHash) return "unknown";
  // Platform admins are neither company owners nor tenants; treat them as
  // owners so the self-service flow applies to them too.
  if (user.isPlatformAdmin || user.ownedCompany) return "owner";
  return "tenant";
}

/**
 * Owner flow: mint a reset token (24h), email the link. Throttled in Redis —
 * one live request per user per window (replaces the old "a recent token row
 * exists" DB check, which cost a query and diverged across dynos). The token
 * row itself is unchanged.
 */
export async function requestOwnerReset(
  email: string,
  fullName: string,
  userId: string
): Promise<{ sent: boolean; reason?: "rate-limited" }> {
  if (!env.RATE_LIMIT_RESET_DISABLED) {
    const throttle = await checkLimit(
      `rl:reset:${userId}`,
      env.RATE_LIMIT_RESET_MAX,
      env.RATE_LIMIT_RESET_WINDOW_MS
    );
    if (!throttle.allowed) return { sent: false, reason: "rate-limited" };
  }

  const token = randomBytes(32).toString("base64url");
  await dbAdmin.passwordResetToken.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MS),
    },
  });

  const link = `${env.PASSWORD_RESET_APP_ORIGIN}/reset-password?token=${token}`;
  const sent = await sendEmail(
    email,
    "Mawzun — إعادة تعيين كلمة المرور",
    [
      `مرحباً ${fullName},`,
      "",
      "تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في Mawzun.",
      "افتح الرابط التالي خلال ٢٤ ساعة لتعيين كلمة مرور جديدة:",
      link,
      "",
      "إذا لم تطلب ذلك، تجاهل هذه الرسالة — كلمة مرورك الحالية تبقى صالحة.",
      "لا يمكنك طلب رابط جديد قبل انتهاء صلاحية هذا الرابط.",
    ].join("\n"),
    [
      `<p>مرحباً ${fullName},</p>`,
      "<p>تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في Mawzun.</p>",
      `<p><a href="${link}">اضغط هنا لإعادة تعيين كلمة المرور</a> — الرابط صالح لمدة ٢٤ ساعة.</p>`,
      "<p>إذا لم تطلب ذلك، تجاهل هذه الرسالة — كلمة مرورك الحالية تبقى صالحة. لا يمكنك طلب رابط جديد قبل انتهاء صلاحية هذا الرابط.</p>",
    ].join(""),
    "password-reset"
  );

  return { sent };
}

/** Consumes a token and sets the new password. */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string
): Promise<void> {
  const record = await dbAdmin.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new BadRequestError(
      "رابط إعادة التعيين غير صالح أو منتهي الصلاحية. اطلب رابطاً جديداً."
    );
  }

  const { hashPassword } = await import("../../utils/password.js");
  const passwordHash = await hashPassword(newPassword);

  await dbAdmin.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        // Rotating the stamp revokes every live session for this user.
        securityStamp: randomBytes(24).toString("base64url"),
      },
    });
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
  });
}
