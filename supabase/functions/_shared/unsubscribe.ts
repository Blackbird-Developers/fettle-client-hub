// Signed unsubscribe links for marketing emails. The link carries the address
// (base64url) and an HMAC of it, so nobody can unsubscribe someone else by
// editing the URL, and no lookup table is needed. Uses Web Crypto only, so it
// runs in the edge functions and under Vitest.

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function encodeEmailParam(email: string): string {
  return toBase64Url(encoder.encode(email));
}

/** The address from an `e` parameter, or null when it isn't valid base64url. */
export function decodeEmailParam(value: string): string | null {
  try {
    return new TextDecoder().decode(fromBase64Url(value));
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function unsubscribeToken(email: string, secret: string): Promise<string> {
  return toBase64Url(await hmac(secret, `unsubscribe:${email}`));
}

/** Compares in constant time so the token can't be guessed byte by byte. */
export async function verifyUnsubscribeToken(
  email: string,
  token: string,
  secret: string
): Promise<boolean> {
  const expected = await unsubscribeToken(email, secret);
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** `?e=…&t=…` for an address, appended to the unsubscribe page or endpoint. */
export async function unsubscribeQuery(email: string, secret: string): Promise<string> {
  const params = new URLSearchParams({
    e: encodeEmailParam(email),
    t: await unsubscribeToken(email, secret),
  });
  return params.toString();
}
