/** Base class for anything the API intends to return as a client-visible error. */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, code: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(message = "الطلب غير صالح.", details?: unknown) {
    super(message, 400, "BAD_REQUEST", details);
  }
}

export class ValidationError extends AppError {
  constructor(message = "البيانات المدخلة غير صالحة.", details?: unknown) {
    super(message, 422, "VALIDATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "غير مصرح بالدخول.") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "ليس لديك الصلاحية الكافية.") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "العنصر المطلوب غير موجود.") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "يوجد تعارض مع البيانات الحالية.", details?: unknown) {
    super(message, 409, "CONFLICT", details);
  }
}

/**
 * Raised when an operation would break the "a company always has exactly one
 * owner" invariant — deleting the owner, or stripping their authority.
 */
export class CompanyOwnerProtectedError extends AppError {
  constructor(message = "لا يمكن حذف أو تعديل مالك الشركة.") {
    super(message, 409, "COMPANY_OWNER_PROTECTED");
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
