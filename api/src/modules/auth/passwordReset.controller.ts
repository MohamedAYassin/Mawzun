import { z } from "zod";
import { dbAdmin } from "../../config/database.js";
import { route } from "../../shared/route.js";
import type { AuthedRequest } from "../../shared/request.js";
import { assertHuman } from "./turnstile.js";
import {
  classifyEmail,
  requestOwnerReset,
  resetPasswordWithToken,
} from "./passwordReset.service.js";

// ---------------------------------------------------------------------------
// Public password-reset endpoints. Responses never reveal whether an email
// exists — except the owner/tenant distinction, which the product explicitly
// wants surfaced so tenants are told to ask their owner before submitting.
// ---------------------------------------------------------------------------

const EmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("بريد إلكتروني غير صالح.").max(320),
});

// Submit carries the bot-check token: sending reset emails is the abuse
// vector, so the check lives here, not on the harmless pre-check.
const SubmitSchema = EmailSchema.extend({
  turnstileToken: z.string().min(1).optional(),
});

const GENERIC_OK =
  "إذا كان البريد الإلكتروني مسجلاً لدينا وله صلاحية إعادة التعيين الذاتية، فستصلك رسالة تحتوي على الرابط خلال دقائق.";

const TENANT_HINT =
  "هذا الحساب داخل شركة يديرها المالك. للحفاظ على أمان مساحة العمل، يرجى طلب إعادة تعيين كلمة المرور من مالك الشركة.";

/**
 * Pre-check: lets the form tell a tenant to ask their owner BEFORE they
 * submit. accountKind is "owner" | "tenant" | "unknown".
 */
export const forgotPasswordCheck = route(
  async (req: AuthedRequest) => {
    const { email } = EmailSchema.parse(req.body);
    const accountKind = await classifyEmail(email);
    return { accountKind, message: accountKind === "tenant" ? TENANT_HINT : GENERIC_OK };
  },
  { message: "تم التحقق." }
);

/**
 * Submit: owner → email a 24h link (one per 24h, even if used). Tenant →
 * nothing is sent, the response repeats the ask-your-owner hint. Unknown
 * email → the generic message, zero information leaked.
 */
export const forgotPassword = route(
  async (req: AuthedRequest) => {
    const { email, turnstileToken } = SubmitSchema.parse(req.body);
    await assertHuman(turnstileToken, req.ip);

    const kind = await classifyEmail(email);
    if (kind === "tenant") {
      // Stubborn tenant submitted anyway: send nothing, say it again.
      return { tenant: true as const, message: TENANT_HINT };
    }
    if (kind === "owner") {
      const user = await dbAdmin.user.findUnique({
        where: { email },
        select: { id: true, fullName: true },
      });
      if (user) await requestOwnerReset(email, user.fullName, user.id);
    }
    return { tenant: false as const, message: GENERIC_OK };
  },
  { message: "تم استلام الطلب." }
);

/** Consumes the emailed token and sets the new password. */
export const resetPassword = route(
  async (req: AuthedRequest) => {
    const Schema = z.object({
      token: z.string().min(10).max(200),
      newPassword: z
        .string()
        .min(8, "كلمة المرور يجب ألا تقل عن ٨ أحرف.")
        .max(128, "كلمة المرور طويلة جداً."),
    });
    const { token, newPassword } = Schema.parse(req.body);
    await resetPasswordWithToken(token, newPassword);
    return { reset: true as const };
  },
  { message: "تم تعيين كلمة المرور الجديدة بنجاح. يمكنك تسجيل الدخول الآن." }
);
