import type { NextFunction, Request, RequestHandler, Response } from "express";
import { isAppError, ConflictError, NotFoundError, ValidationError } from "./errors.js";
import { captureError } from "../observability/errorCapture.js";
import { env } from "../config/env.js";
import { formatMegabytesAr } from "./formatBytes.js";

/**
 * Prisma unique-constraint violation → 409 with the fields involved, so a
 * duplicate row reads as "this value already exists" instead of a 500.
 */
function toConflictError(err: unknown): ConflictError | null {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  ) {
    const meta = (err as { meta?: { target?: string[] | string } }).meta;
    const raw = Array.isArray(meta?.target) ? meta!.target.join(", ") : meta?.target ?? "";
    const field = raw.split("_")[0];
    return new ConflictError(`هذه القيمة مستخدمة بالفعل${field ? ` (${field}).` : "."}`);
  }
  return null;
}

/**
 * Prisma "record not found" (P2025) from update/delete-by-id → 404, so a
 * stale or bogus id reads as "gone" instead of a 500. This complements the
 * findFirst+NotFoundError pattern used by read endpoints.
 */
function toNotFoundError(err: unknown): NotFoundError | null {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "P2025"
  ) {
    return new NotFoundError("العنصر غير موجود.");
  }
  return null;
}

/**
 * body-parser JSON syntax errors carry status 400 and a `body`/`type` marker;
 * surfacing them as 400 keeps malformed clients out of the 500 bucket.
 */
function toBadRequestError(err: unknown): Error | null {
  if (
    err instanceof SyntaxError &&
    "status" in err &&
    (err as { status?: number }).status === 400 &&
    "body" in err
  ) {
    const e = err as Error & { status: number };
    Object.defineProperty(e, "statusCode", { value: 400, configurable: true });
    Object.defineProperty(e, "code", { value: "BAD_REQUEST", configurable: true });
    e.message = "صيغة JSON غير صالحة.";
    return e;
  }
  return null;
}

/**
 * multer rejects an oversized upload (or a wrong field name) by throwing a
 * MulterError with a `code`. Untranslated it fell through to the 500 branch, so
 * a user who picked a 12 MB photo saw "حدث خطأ غير متوقع" — an unexpected server
 * fault — and every such upload wrote a 5xx breadcrumb, which is noise that
 * hides real outages.
 *
 * These are client mistakes, so they answer 400 with the actual reason. The size
 * message is generated from UPLOAD_MAX_BYTES, the same value multer enforced, so
 * it can never name a limit the server is not applying.
 */
function toUploadError(err: unknown): Error | null {
  if (
    err &&
    typeof err === "object" &&
    (err as { name?: string }).name === "MulterError"
  ) {
    const code = (err as { code?: string }).code;
    const message =
      code === "LIMIT_FILE_SIZE"
        ? `حجم الصورة يتجاوز ${formatMegabytesAr(env.UPLOAD_MAX_BYTES)}.`
        : code === "LIMIT_UNEXPECTED_FILE"
          ? "حقل الملف غير متوقع. أرسل الصورة في الحقل «file»."
          : "تعذر قراءة الملف المرفوع.";
    const e = new Error(message) as Error & { statusCode?: number; code?: string };
    Object.defineProperty(e, "statusCode", { value: 400, configurable: true });
    Object.defineProperty(e, "code", { value: "BAD_REQUEST", configurable: true });
    return e;
  }
  return null;
}

/** The envelope every endpoint returns, success or failure. */
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T | null;
}

export function ok<T>(res: Response, data: T, message = "تم بنجاح.", status = 200): void {
  res.status(status).json({ success: true, message, data } satisfies ApiEnvelope<T>);
}

export function created<T>(res: Response, data: T, message = "تم الإنشاء بنجاح."): void {
  ok(res, data, message, 201);
}

/**
 * Wraps an async handler that writes to the response itself.
 *
 * `route()` covers handlers that return data to be enveloped as JSON. Use this
 * one when the response body is not JSON — a file, an image, a stream — so the
 * handler keeps direct access to `Response`.
 *
 * The request type is generic so a handler can declare `AuthedRequest` and
 * reach `req.ctx` without casting, which is safe because every route is
 * mounted behind `authenticate`.
 */
export function handler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}

/** Turns a Zod failure into a 422 with per-field detail. */
export function toValidationError(err: unknown): ValidationError | null {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    return new ValidationError(
      "البيانات المدخلة غير صالحة.",
      issues.map((i) => ({ field: i.path.join("."), message: i.message }))
    );
  }
  return null;
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  if (res.headersSent) return next(err);

  // Built once, used by all three capture sites below.
  //
  // The route is the path WITHOUT its query string: a query string can carry a
  // token (`?access_token=...`) and is the one part of a URL most likely to
  // hold a secret. The body is passed RAW — captureError redacts it, because
  // the rules for that belong in one place rather than three.
  //
  // IP and User-Agent come from the request so a breadcrumb answers "who hit
  // this and from where", which is the difference between one user's bad input
  // and an outage.
  const ctx = {
    route: _req.originalUrl ? _req.originalUrl.split(String.fromCharCode(63))[0] : undefined,
    method: _req.method,
    requestId: _req.requestId,
    ipAddress: _req.ip,
    userAgent: _req.headers["user-agent"],
    body: _req.body,
    // Set by `authenticate`. Absent on public routes (login, signup, reset),
    // which is correct: nobody is signed in yet.
    userId: _req.ctx?.userId,
    companyId: _req.ctx?.companyId ?? undefined,
  };

  const validation = toValidationError(err);
  if (validation) {
    // Logged like every other handled failure, and this is the case where the
    // request body IS the diagnosis.
    //
    // The response tells the CLIENT which field failed; without this line the
    // server keeps no record of what was sent, so "which payloads do users get
    // wrong" is unanswerable and a frontend sending the wrong type is
    // invisible. It is also the highest-volume 4xx, which is why the pruner
    // protects recent 5xx from being pushed out by it (see errorCapture.ts).
    //
    // Safe on the public auth routes too: `bodyForLog` withholds /auth/* bodies
    // wholesale, so a malformed login cannot write a password.
    void captureError(err, { ...ctx, status: validation.statusCode });
    res.status(validation.statusCode).json({
      success: false,
      message: validation.message,
      data: null,
      code: validation.code,
      details: validation.details,
    });
    return;
  }

  if (isAppError(err)) {
    void captureError(err, { ...ctx, status: err.statusCode });
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      data: null,
      code: err.code,
      details: err.details,
    });
    return;
  }

  const notFound = toNotFoundError(err);
  if (notFound) {
    res.status(notFound.statusCode).json({
      success: false,
      message: notFound.message,
      data: null,
      code: notFound.code,
    });
    return;
  }

  const conflict = toConflictError(err);
  if (conflict) {
    res.status(conflict.statusCode).json({
      success: false,
      message: conflict.message,
      data: null,
      code: conflict.code,
    });
    return;
  }

  if (toBadRequestError(err)) {
    void captureError(err, { ...ctx, status: 400 });
    res.status(400).json({
      success: false,
      message: (err as Error).message,
      data: null,
      code: "BAD_REQUEST",
    });
    return;
  }

  // Oversized / malformed multipart uploads: a client mistake, not a fault.
  const upload = toUploadError(err);
  if (upload) {
    void captureError(upload, { ...ctx, status: 400 });
    res.status(400).json({
      success: false,
      message: upload.message,
      data: null,
      code: "BAD_REQUEST",
    });
    return;
  }

  console.error("Unhandled error:", err);
  // Breadcrumb + Grafana counter - fire-and-forget, never delays the response.
  void captureError(err, { ...ctx, status: 500 });
  res.status(500).json({
    success: false,
    message: "حدث خطأ غير متوقع.",
    data: null,
    code: "INTERNAL_ERROR",
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    message: "المسار غير موجود.",
    data: null,
    code: "NOT_FOUND",
  });
}
