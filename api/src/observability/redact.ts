// Redaction for anything logged out of a request.
//
// The breadcrumb trail records what a failing request actually contained, which
// is what makes it useful — but a request body is also where credentials live.
// This module is the single place that decides what may be written down, so the
// rule is stated once instead of being re-implemented (and eventually
// forgotten) at each capture site.
//
// The default is to REMOVE, not to keep: a key is redacted when its name looks
// like a credential, and the auth routes withhold the body entirely rather than
// relying on that name matching. Over-redacting costs a little debugging
// context; under-redacting writes a password into a log database.

/** Value substituted for anything withheld. */
export const REDACTED = "[REDACTED]";

/**
 * Key names whose values are never written.
 *
 * Deliberately broad, because a false positive only hides an innocuous field
 * from an error trail while a false negative writes a credential into a log
 * database — the two are not comparable.
 *
 * But NOT so broad that it eats ordinary business fields, because a log that
 * redacts the thing you are debugging is also a failure. Two rules keep it
 * honest, and both were found by testing the pattern rather than by reading it:
 *
 *   Word-anchored short tokens. A bare /pin/ matches "shipping", /card/ matches
 *   "discarded", and a bare /ssn/ matches "bypassNote" (bypa-SSN-ote) — every
 *   one of which is an ordinary field that would have silently disappeared.
 *   \bssn\b cannot match inside a longer word.
 *
 *   Spelled-out key variants. `api[_-]?key`, `access[_-]?key` and
 *   `key[_-]?hash` are named rather than covered by a bare `key`, because `key`
 *   would also swallow `permissionKeys` (permission names, useful in a log) and
 *   `keyPrefix` (a non-secret display value). An API key and a stored key digest
 *   are credentials; a permission name is not.
 *
 * The long, unambiguous tokens (password, secret, token, auth) stay unanchored
 * so camelCase and prefixes still match: `\bpass` would MISS `currentPassword`,
 * which is exactly the field a password-change bug report needs redacted.
 */
const SENSITIVE_KEY =
  /password|passwd|passcode|\bpass\b|\bpwd\b|secret|token|api[_-]?key|access[_-]?key|key[_-]?hash|auth|credential|cookie|session|jwt|bearer|signature|\botp\b|\bpin\b|\bcard|iban|\bcvc\b|\bcvv\b|\bssn\b|account/i;

/** True when this key's value must not be written. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Truncates without splitting a character.
 *
 * `String.prototype.slice` counts UTF-16 code units, so cutting between the two
 * halves of a surrogate pair (an emoji, and plenty of Arabic letters with
 * combining marks) leaves a lone surrogate — which is not valid UTF-8 and turns
 * into a replacement character or an encoding error on the way to Postgres.
 * This repo has already had one multi-layer mojibake incident; the guard is
 * cheap.
 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = max - 1;
  const code = value.charCodeAt(cut);
  // A high surrogate as the last kept unit means the pair is split — back off.
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return value.slice(0, cut) + "…";
}

/** How deep to walk before giving up. Bodies are shallow; a deep or cyclic
 *  structure is either hostile or a bug, and must not hang the request. */
const MAX_DEPTH = 6;

/**
 * Replaces sensitive values with a marker, recursively.
 *
 * Returns a structure that is safe to `JSON.stringify`. Non-plain values
 * (Dates, Buffers, class instances) become strings: their own `toJSON` could
 * emit anything, and a logged value must not be able to surprise us.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return "[depth limit]";

  if (typeof value === "string") {
    // A long string is far more likely to be a pasted token or a document than
    // something worth reading in an error trail.
    return truncate(value, 300);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return "[unloggable]";

  if (Array.isArray(value)) {
    // Cap the length too: a 10k-row array would blow the column on its own.
    const kept = value.slice(0, 50).map((item) => redact(item, depth + 1));
    if (value.length > 50) kept.push(`[+${value.length - 50} more]`);
    return kept;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (count++ >= 100) {
        out["…"] = "[more keys omitted]";
        break;
      }
      out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }

  return String(value);
}

/**
 * Route prefixes whose request bodies are never recorded.
 *
 * A hard rule rather than a name-based one, because these bodies carry the
 * credentials themselves: a login body IS the password, a refresh body IS the
 * session token, and a reset body IS the account-recovery token. Name matching
 * would have to be perfect for every one of them; withholding the body cannot
 * be wrong. The fields are already covered by SENSITIVE_KEY, but this does not
 * depend on that staying true as the schemas change.
 */
const BODY_WITHHELD_PREFIXES = ["/api/v1/auth/"];

function isBodyWithheld(route: string): boolean {
  return BODY_WITHHELD_PREFIXES.some((prefix) => route.startsWith(prefix));
}

/**
 * The body as it should be logged: a redacted JSON string, or a marker saying
 * why it is absent.
 *
 * Never throws — a body that cannot be serialised (a cyclic structure, a Proxy
 * that fights `Object.entries`) must not turn a handled error into an
 * unhandled one on the way out.
 */
export function bodyForLog(route: string, body: unknown, max = 2000): string | null {
  if (isBodyWithheld(route)) return "[withheld: credentials]";
  if (body === undefined || body === null) return null;
  // An empty object is what Express leaves for a bodyless request; recording it
  // would add noise to every GET without adding information.
  if (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0) return null;

  try {
    const json = JSON.stringify(redact(body));
    if (json === undefined) return null;
    return truncate(json, max);
  } catch {
    return "[unserialisable body]";
  }
}
