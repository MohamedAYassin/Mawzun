// Secret box: AES-256-GCM sealing for Shopify access tokens at rest.
//
// The backend seals the merchant's Admin API token before it touches the
// database; the webhook worker opens it when calling Shopify. Keyed by
// APP_SECRET via HKDF. Ciphertext: base64url(iv || ciphertext || tag).
// NOTE: keep byte-format in sync with shopify_integration/src/secretbox.ts.

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "mawzun-shopify-token", "", 32));
}

export function sealToken(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64url");
}

export function openToken(sealed: string, secret: string): string {
  const raw = Buffer.from(sealed, "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(raw.length - 16);
  const ct = raw.subarray(12, raw.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
