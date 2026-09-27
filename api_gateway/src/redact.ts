// Redaction for anything logged out of a request.
//
// A copy of the Backend's src/observability/redact.ts, deliberately kept small:
// this Worker only logs server errors to Cloudflare's log store, so it needs
// the key rules and nothing else. The alternative — importing across services —
// would couple two separately-deployed Workers for one function.
//
// The default is to REMOVE, not to keep: a key is redacted when its name looks
// like a credential. Over-redacting costs a little debugging context;
// under-redacting writes a credential into a log.
//
// Only `redact` and `bodyForLog` are exported: the key predicate and the
// truncation helper are implementation details, and exporting them would be
// dead surface nothing imports.
//
// Two rules keep it honest, and both were found by testing the pattern rather
// than by reading it (the Backend's copy documents the same two):
//   - Short ambiguous tokens are word-anchored. A bare /pin/ matches
//     "shipping", /card/ matches "discarded", and a bare /ssn/ matches
//     "bypassNote" (bypa-SSN-ote) — ordinary fields that would silently vanish.
//   - Key variants are spelled out, so a bare `key` cannot swallow
//     `permissionKeys` (permission names, useful in a log) or `keyPrefix`.
//     An API key and a stored key digest are credentials; a permission is not.

const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /password|passwd|passcode|\bpass\b|\bpwd\b|secret|token|api[_-]?key|access[_-]?key|key[_-]?hash|auth|credential|cookie|session|jwt|bearer|signature|\botp\b|\bpin\b|\bcard|iban|\bcvc\b|\bcvv\b|\bssn\b|account/i;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/**
 * Truncates without splitting a character.
 *
 * `slice` counts UTF-16 code units, so cutting between the halves of a
 * surrogate pair leaves a lone surrogate — invalid UTF-8 that becomes a
 * replacement character or an encoding error downstream.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  let cut = max - 1;
  const code = value.charCodeAt(cut);
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
  return value.slice(0, cut) + "…";
}

/** How deep to walk before giving up. Bodies are shallow; a deep structure is
 *  either hostile or a bug and must not hang the request. */
const MAX_DEPTH = 6;

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return "[depth limit]";
  if (typeof value === "string") return truncate(value, 300);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return "[unloggable]";

  if (Array.isArray(value)) {
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
 * The body as it should be logged: redacted, truncated, or a marker.
 *
 * Never throws — a body that cannot be serialised must not turn a handled
 * error into an unhandled one on the way out.
 */
export function bodyForLog(body: unknown, max = 1000): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0) return null;
  try {
    const json = JSON.stringify(redact(body));
    if (json === undefined) return null;
    return truncate(json, max);
  } catch {
    return "[unserialisable body]";
  }
}
