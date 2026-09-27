// Admin session: HMAC(password, timestamp). No store, no JWT lib.
// (Carried over verbatim from the original single-file worker.)

const enc = new TextEncoder();

export const SESSION_TTL_MS = 12 * 60 * 60_000;

export async function hmac(password: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintSession(password: string): Promise<string> {
  const ts = String(Date.now());
  return `${ts}.${await hmac(password, ts)}`;
}

export async function validSession(req: Request, password: string): Promise<boolean> {
  const cookie = req.headers.get("Cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
  if (!m) return false;
  const [ts, sig] = decodeURIComponent(m[1]).split(".");
  if (!ts || !sig || !/^\d+$/.test(ts)) return false;
  if (Date.now() - Number(ts) > SESSION_TTL_MS) return false;
  const want = await hmac(password, ts);
  if (sig.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= sig.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export async function passwordMatches(presented: string, real: string): Promise<boolean> {
  // Hash both sides so timing doesn't leak the password length.
  const digest = async (s: string) => {
    const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };
  const [a, b] = await Promise.all([digest(presented), digest(real)]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const sessionCookie = (v: string) =>
  `admin_session=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`;

export const clearSessionCookie = () => `admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
