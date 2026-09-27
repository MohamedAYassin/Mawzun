// Shared secret box: AES-256-GCM encryption for Shopify access tokens at rest.
//
// The webhook worker and the backend both need the merchant's Admin API token
// to call Shopify, so it cannot be hashed — it is stored encrypted, keyed by
// APP_SECRET (32-byte key derived via HKDF). Ciphertext format: base64url(iv
// || ciphertext || tag).

const encoder = new TextEncoder();

async function deriveKey(secret: string): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    "HKDF",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode("mawzun-shopify-token"), info: new Uint8Array(0) },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function openToken(sealed: string, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  let bin = atob(sealed.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const iv = bytes.slice(0, 12);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    bytes.slice(12)
  );
  return new TextDecoder().decode(pt);
}
