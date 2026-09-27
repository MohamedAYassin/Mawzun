// Retry policy for the API transport.
//
// WHY THIS IS A SEPARATE MODULE
//
// It used to live inline in `http.ts`, and the only way to test it was to copy
// the decision table into the test file. That test passed whether or not the
// transport actually used the policy — edit `http.ts` and the suite stayed
// green. Pulling the decisions out here means the test imports the same
// functions the transport calls, so a change that breaks the behaviour fails
// the test.
//
// WHAT IS RETRIED, AND WHAT DELIBERATELY IS NOT
//
// Retried — failures where a second attempt can plausibly succeed:
//   * a network error. The request never reached the server, or the reply never
//     came back, so nothing was applied.
//   * 5xx and 429. The server was briefly unable to answer: a 5xx is a bug or
//     an overload, a 429 is a rate limit that clears.
//
// NOT retried:
//   * any other 4xx. A 400, 401, 403, 404 or 422 is the server's settled
//     answer. Repeating it wastes a round-trip and delays a message that will
//     not change.
//   * non-idempotent writes. Repeating a POST whose response was lost can
//     create the row twice, and the server cannot tell a retry from a second
//     request. This is the one case where retrying is actively harmful, so it
//     is off unless the caller opts in.

/** Statuses worth a second attempt: rate-limited or server-side failure. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Whether a method may be repeated without changing the outcome.
 *
 * GET, PUT and DELETE are idempotent by HTTP definition — repeating them is
 * the same as doing them once. POST and PATCH are not, so they are excluded
 * and a caller that knows its endpoint is safe to repeat must say so.
 */
export function isRetryableMethod(method: string): boolean {
  return method === "GET" || method === "PUT" || method === "DELETE";
}

/** Whether this request may be retried at all, given its method and options. */
export function mayRetryRequest(
  method: string,
  options: { retryOnWrite?: boolean; skipRetry?: boolean } = {},
): boolean {
  if (options.skipRetry) return false;
  return isRetryableMethod(method) || options.retryOnWrite === true;
}

/** The upper bound on retries, so a misconfiguration cannot cause a storm. */
export const MAX_RETRY_COUNT = 5;

/**
 * Reads the configured retry count.
 *
 * `raw` is passed in rather than read from `import.meta.env` here so this
 * function can be tested: `import.meta.env` only exists inside a Vite bundle.
 * The transport supplies the real value.
 *
 * A non-numeric or negative value is treated as 0 — "misconfigured" and "off"
 * should behave the same, and both are safer than retrying more than asked.
 */
export function parseRetryCount(raw: string | undefined): number {
  if (raw === undefined || raw === "") return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), MAX_RETRY_COUNT);
}

/** Base delay between attempts. Doubled on each subsequent attempt. */
export const RETRY_BASE_DELAY_MS = 300;

/** The backoff for a given attempt (1-based), with no jitter. */
export function retryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}
