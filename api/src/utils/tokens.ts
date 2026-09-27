import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque refresh tokens.
 *
 * The token is a random string handed to the client once; only its SHA-256
 * digest is stored. That way a dump of the sessions table does not yield
 * usable tokens, and lookup by digest is a single indexed equality.
 */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A short, unguessable identifier for the security stamp. */
export function newSecurityStamp(): string {
  return randomBytes(32).toString("base64url");
}
