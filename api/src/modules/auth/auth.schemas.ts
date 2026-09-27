import { z } from "zod";

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("بريد إلكتروني غير صالح.")
  .max(320);

const password = z
  .string()
  .min(8, "كلمة المرور يجب ألا تقل عن ٨ أحرف.")
  .max(128, "كلمة المرور طويلة جداً.");

export const SignupSchema = z.object({
  // The company is created implicitly from this name. Users are never asked to
  // "create a company" as a separate step.
  companyName: z.string().trim().min(2, "اسم الشركة قصير جداً.").max(200),
  fullName: z.string().trim().min(2, "الاسم قصير جداً.").max(200),
  email,
  password,
  phoneNumber: z.string().trim().max(50).optional().nullable(),
  turnstileToken: z.string().min(1).optional(),
});

export const LoginSchema = z.object({
  email,
  password: z.string().min(1, "كلمة المرور مطلوبة."),
  rememberMe: z.boolean().optional().default(false),
  turnstileToken: z.string().min(1).optional(),
});

// The refresh token normally arrives as an HttpOnly cookie; a body value is
// still accepted for non-browser API clients.
export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, "توكن التحديث مطلوب.").optional(),
});

// allSessions revokes every session for the user; otherwise the current
// cookie (or an explicit body token from API clients) is revoked.
export const LogoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
  allSessions: z.boolean().optional().default(false),
});

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "كلمة المرور الحالية مطلوبة."),
    newPassword: password,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "كلمة المرور الجديدة يجب أن تختلف عن الحالية.",
    path: ["newPassword"],
  });

export type SignupInput = z.infer<typeof SignupSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
