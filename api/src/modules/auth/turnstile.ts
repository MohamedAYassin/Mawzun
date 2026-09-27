// Cloudflare Turnstile bot check for login/signup.
//
// Fail-closed when TURNSTILE_SECRET is set (production): a missing or invalid
// token rejects the request. Fail-open when unset (local dev without keys).
// The frontend sends the widget token as `turnstileToken`.

import { env } from "../../config/env.js";
import { BadRequestError } from "../../shared/errors.js";

export async function assertHuman(token: string | undefined, ip?: string): Promise<void> {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) {
    throw new BadRequestError("تحقق مكافحة البوت مطلوب. حدّث الصفحة وحاول مجدداً.");
  }
  let res: Response;
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
    if (ip) body.set("remoteip", ip);
    res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new BadRequestError("تعذر التحقق من مكافحة البوت. حاول مجدداً.");
  }
  const data = (await res.json().catch(() => null)) as { success?: boolean } | null;
  if (!data?.success) {
    throw new BadRequestError("فشل التحقق من مكافحة البوت. حدّث الصفحة وحاول مجدداً.");
  }
}
