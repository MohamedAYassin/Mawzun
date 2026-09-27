// Shared transport for every Mawzun API call.
//
// This is the only place that knows about fetch, the response envelope, the
// bearer token and refresh rotation. Domain clients (auth, users, company, ...)
// describe endpoints; they never touch any of that.
//
// Two things it guarantees:
//   1. A rejected response always becomes an ApiError carrying the server's
//      message, so callers never have to unwrap a success flag by hand.
//   2. A 401 triggers exactly one refresh across the whole app — concurrent
//      calls share a single in-flight promise rather than stampeding.

import { isRetryableStatus, mayRetryRequest, parseRetryCount, retryDelayMs } from "./retry";
import { announceSessionChanged, announceSessionExpired, identityChanged } from "./session-events";

// Re-exported: callers that already import from ./http keep working, and this
// stays the one place the transport is wired up.
export { announceSessionExpired } from "./session-events";
/** Where the backend serves its API. Matches createApiRouter's mount point. */
export const API_PREFIX = "/api/v1";

// In dev, calls go through the same-origin passthrough at
// src/routes/api/public/proxy/$.ts, which relays to the local backend on
// port 5000 (the backend sends no CORS headers, hence the relay). In
// production the app calls the backend directly.
export const ORIGIN =
      (import.meta.env.VITE_API_ORIGIN as string | undefined) ??
      (import.meta.env.DEV ? "/api/public/proxy" : "https://api.mawzun.org");

/** The envelope every endpoint returns, success or failure. */
export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T | null;
  code?: string;
  details?: unknown;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** A failed API call. `message` is already in Arabic, straight from the server. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The server refused and the session cannot be recovered. */
  get isSessionExpired(): boolean {
    return this.status === 401;
  }

  /** The caller is authenticated but not allowed. Used to shape the UI. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /**
   * Raised when an operation would break the "a company always has exactly one
   * owner" invariant. The backend returns 409 COMPANY_OWNER_PROTECTED.
   */
  get isOwnerProtected(): boolean {
    return this.code === "COMPANY_OWNER_PROTECTED";
  }
}

// ---------------------------------------------------------------------------
// Session storage
// ---------------------------------------------------------------------------

const TOKEN_KEY = "mawzun.accessToken";
const REFRESH_KEY = "mawzun.refreshToken";

export const session = {
  get accessToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  },
  get refreshToken(): null {
    // The refresh token lives in an HttpOnly cookie issued by the backend and
    // is deliberately NOT readable here: anything JavaScript could read, XSS
    // could exfiltrate. executeRefresh() relies on the cookie alone.
    return null;
  },
  get isAuthenticated(): boolean {
    // Route guards run this during SSR too, where localStorage does not
    // exist. On the server there is never a session, so the guards redirect
    // instead of crashing the Worker.
    if (typeof window === "undefined") return false;
    return Boolean(localStorage.getItem(TOKEN_KEY));
  },

  set(accessToken: string): void {
    // Detect a change of identity, not just of token.
    //
    // Signing in as someone else must not leave the previous account's cached
    // principal in place — that is how one user's name, company and
    // permissions stayed on screen until a manual reload. But a token REFRESH
    // (same person, new expiry) must NOT wipe the cache, or the app would
    // refetch every screen once an hour for no reason.
    //
    // Comparing the token's subject distinguishes the two without every call
    // site having to remember. The payload is read, never trusted: it is only
    // used to notice "this is a different person", and the server still
    // validates the signature on every request.
    const previous = localStorage.getItem(TOKEN_KEY);

    localStorage.setItem(TOKEN_KEY, accessToken);
    // Legacy key from the pre-cookie era; remove it so a stale token from
    // before the switch can never be replayed.
    localStorage.removeItem(REFRESH_KEY);

    if (identityChanged(previous, accessToken)) {
      announceSessionChanged();
    }
  },

  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    // Legacy keys from before the token pair was introduced. Reading them back
    // would make the app believe it is logged in with a credential the backend
    // no longer accepts.
    localStorage.removeItem("token");
    localStorage.removeItem("roles");
    localStorage.removeItem("permissions");
  },
};

// ---------------------------------------------------------------------------
// Query strings
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined;

/**
 * Builds a query string, dropping null/empty so defaults apply server-side.
 *
 * Generic rather than `Record<string, QueryValue>`: the callers pass named
 * query interfaces, and those do not carry an index signature, so a record
 * type would reject every one of them.
 */
export function toQuery<T extends object>(params: T = {} as T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// ---------------------------------------------------------------------------
// Core request
// ---------------------------------------------------------------------------

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** FormData is sent as-is, without a JSON content type. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Skips the automatic refresh-and-retry on 401. Used by refresh itself. */
  skipRefresh?: boolean;
  /**
   * Opts a write out of the transient-failure retry.
   *
   * Set on anything that must not be repeated — a webhook acknowledgement, a
   * one-time token redemption — where a duplicate is worse than an error the
   * user can act on.
   */
  skipRetry?: boolean;
  /**
   * Allows retrying a non-idempotent write (POST/PATCH) on a network error.
   *
   * Off by default, because a retry after a lost response can create the row
   * twice and the server cannot tell the two requests apart. Enable only where
   * the endpoint is safe to repeat.
   */
  retryOnWrite?: boolean;
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------
//
// The decisions live in ./retry so they can be imported and tested directly;
// see that file for what is retried and, more importantly, what is not.

const RETRY_COUNT = parseRetryCount(import.meta.env.VITE_API_RETRY_COUNT as string | undefined);

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function buildUrl(path: string): string {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${ORIGIN}${API_PREFIX}${suffix}`;
}

async function parse(response: Response): Promise<never> {
  let envelope: ApiEnvelope<unknown>;
  try {
    envelope = (await response.json()) as ApiEnvelope<unknown>;
  } catch {
    // A proxy that is down, or an HTML error page where JSON was expected.
    throw new ApiError(
      "تعذّر الوصول إلى الخادم. تحقق من الاتصال ثم أعد المحاولة.",
      response.status,
      "NETWORK_ERROR",
    );
  }

  throw new ApiError(
    envelope.message || "حدث خطأ غير متوقع.",
    response.status,
    envelope.code ?? "ERROR",
    envelope.details,
  );
}

async function send(
  path: string,
  options: RequestOptions,
  accessToken: string | null,
): Promise<Response> {
  const headers = new Headers();
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  let body: BodyInit | undefined;
  if (options.formData) {
    // Let the browser set the multipart boundary.
    body = options.formData;
  } else if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const method = options.method ?? "GET";
  const url = buildUrl(path);

  // A retry is only safe when the request can be repeated without changing the
  // outcome. See ./retry for why POST is excluded unless the caller opts in.
  const mayRetry = RETRY_COUNT > 0 && mayRetryRequest(method, options);
  const maxAttempts = mayRetry ? RETRY_COUNT + 1 : 1;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        credentials: "include",
        signal: options.signal,
      });

      // Retry a transient server-side failure, but hand back the LAST response
      // so the caller still sees a real status and body rather than a
      // synthetic error.
      if (mayRetry && attempt < maxAttempts && isRetryableStatus(response.status)) {
        await delay(retryDelayMs(attempt), options.signal);
        continue;
      }
      return response;
    } catch (error) {
      // An aborted request is the caller's decision, not a failure to retry.
      if (error instanceof DOMException && error.name === "AbortError") throw error;

      lastError = error;
      if (!mayRetry || attempt === maxAttempts) throw error;
      await delay(retryDelayMs(attempt), options.signal);
    }
  }

  // Unreachable: the loop either returns a response or throws. Kept so the
  // function has a definite exit for the type checker.
  throw lastError ?? new Error("unreachable");
}

/** Turns a finished response into either its payload or a thrown ApiError. */
async function unwrap<T>(response: Response): Promise<T> {
  // 204 carries no body, so there is nothing to parse.
  if (response.status === 204) return null as T;
  if (!response.ok) return parse(response);

  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!envelope.success || envelope.data === null || envelope.data === undefined) {
    // A 2xx that says it failed is still a failure; the envelope is the truth.
    throw new ApiError(
      envelope.message || "حدث خطأ غير متوقع.",
      response.status,
      envelope.code ?? "ERROR",
    );
  }
  return envelope.data;
}

// ---------------------------------------------------------------------------
// Refresh, de-duplicated
// ---------------------------------------------------------------------------

let refreshPromise: Promise<string> | null = null;

async function executeRefresh(): Promise<string> {
  // No body token: the HttpOnly cookie set at login is the credential. If it
  // is missing, the backend answers 401 and the session-expired flow takes over.
  const response = await fetch(buildUrl("/auth/refresh"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    credentials: "include",
  });

  if (!response.ok) {
    session.clear();
    announceSessionExpired();
    return parse(response);
  }

  const envelope = (await response.json()) as ApiEnvelope<{
    tokens: { accessToken: string; refreshToken: string };
  }>;
  if (!envelope.success || !envelope.data) {
    session.clear();
    announceSessionExpired();
    throw new ApiError("انتهت صلاحية الجلسة.", 401, "UNAUTHORIZED");
  }

  // The refresh rotation arrives as the new HttpOnly cookie; only the access
  // token needs storing here.
  session.set(envelope.data.tokens.accessToken);
  return envelope.data.tokens.accessToken;
}

/**
 * Performs a request, refreshing the access token once if it has expired.
 *
 * Concurrent 401s share one refresh: the first caller starts it and everyone
 * else awaits the same promise. Without that, a page firing six requests on
 * mount would rotate the refresh token six times and revoke its own session.
 */
async function withRefresh(path: string, options: RequestOptions): Promise<Response> {
  const first = await send(path, options, session.accessToken);
  if (first.status !== 401 || options.skipRefresh) return first;

  // Keep the server's message from the first attempt. It is the reason the call
  // was refused; reporting the refresh failure instead would blame the wrong
  // thing and hide the actual answer. parse() throws, so a bare .catch(() => null)
  // discarded the message and every 401 that reached a refresh attempt surfaced
  // as "انتهت صلاحية الجلسة." even when the server had said why (wrong password,
  // revoked session, suspended company).
  let original: ApiError | null = null;
  try {
    await parse(first);
  } catch (error) {
    original = error instanceof ApiError ? error : null;
  }

  if (!refreshPromise) {
    refreshPromise = executeRefresh().finally(() => {
      refreshPromise = null;
    });
  }

  let accessToken: string;
  try {
    accessToken = await refreshPromise;
  } catch {
    // Refresh itself failed; the session is gone and has already been cleared.
    throw original ?? new ApiError("انتهت صلاحية الجلسة.", 401, "UNAUTHORIZED");
  }

  // Retry once with the fresh token. A second 401 means the server revoked the
  // session rather than the token merely being stale.
  const retried = await send(path, { ...options, skipRefresh: true }, accessToken);
  if (retried.status === 401) {
    session.clear();
    announceSessionExpired();
    throw original ?? new ApiError("انتهت صلاحية الجلسة.", 401, "UNAUTHORIZED");
  }
  return retried;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return unwrap<T>(await withRefresh(path, options));
}

/**
 * Performs a request and hands back the untouched response.
 *
 * For bodies that are not the JSON envelope — images, exports, anything the
 * browser should consume as a blob. It lives here rather than beside the one
 * caller that needs it so a binary response gets the same refresh-and-retry as
 * an ordinary call; an image that 401s mid-session is not special.
 */
export async function requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
  return withRefresh(path, options);
}

// ---------------------------------------------------------------------------
// Convenience verbs
// ---------------------------------------------------------------------------

export const http = {
  // Q defaults to `object` rather than a keyed record: TypeScript cannot
  // infer Q while T is given explicitly, so any narrower default would be used
  // instead of the inference and reject every named query interface. The query
  // contract is enforced one level up, by each client's own typed parameter.
  get: <T, Q extends object = object>(path: string, query?: Q, signal?: AbortSignal) =>
    request<T>(`${path}${toQuery(query ?? {})}`, { method: "GET", signal }),

  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),

  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),

  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),

  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", formData }),
};
