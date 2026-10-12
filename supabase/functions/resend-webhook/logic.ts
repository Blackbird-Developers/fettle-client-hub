// Pure logic for the resend-webhook edge function: checking Resend's webhook
// signature and turning an event into the email_sends update. Web Crypto only,
// so it runs in the edge function and under Vitest (logic.test.ts).
//
// Resend signs webhooks with Svix: the signed content is
// "<svix-id>.<svix-timestamp>.<raw body>", HMAC-SHA256 with the base64 part
// of the "whsec_…" signing secret, sent as "v1,<base64>" (several may be
// listed, space-separated, while a secret is being rotated).

/** Reject events signed more than this long ago (replay protection). */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSvix(secret: string, id: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(secret.replace(/^whsec_/, "")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifySvixSignature(
  secret: string,
  headers: SvixHeaders,
  body: string,
  nowSeconds: number
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(nowSeconds - sentAt) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  let expected: string;
  try {
    expected = await signSvix(secret, id, timestamp, body);
  } catch {
    return false; // malformed secret
  }
  return signature
    .split(" ")
    .map((part) => part.split(","))
    .some(([version, value]) => version === "v1" && !!value && constantTimeEqual(value, expected));
}

export interface SendRecord {
  delivered_at: string | null;
  opened_at: string | null;
  first_clicked_at: string | null;
  click_count: number;
  bounced_at: string | null;
  complained_at: string | null;
}

export type SuppressionReason = "bounced" | "complained";

export interface EventEffect {
  /** Columns to set on the email_sends row; empty when nothing changes. */
  update: Partial<SendRecord>;
  /** Set when the address must be suppressed from now on. */
  suppress: SuppressionReason | null;
}

// First time wins for each timestamp, so retried or out-of-order webhooks
// don't move a date. Clicks are counted every time.
export function eventEffect(type: string, at: string, current: SendRecord): EventEffect {
  switch (type) {
    case "email.delivered":
      return { update: current.delivered_at ? {} : { delivered_at: at }, suppress: null };
    case "email.opened":
      return { update: current.opened_at ? {} : { opened_at: at }, suppress: null };
    case "email.clicked":
      return {
        update: {
          click_count: current.click_count + 1,
          ...(current.first_clicked_at ? {} : { first_clicked_at: at }),
          // A click proves it was opened, even with images blocked.
          ...(current.opened_at ? {} : { opened_at: at }),
        },
        suppress: null,
      };
    case "email.bounced":
      return { update: current.bounced_at ? {} : { bounced_at: at }, suppress: "bounced" };
    case "email.complained":
      return { update: current.complained_at ? {} : { complained_at: at }, suppress: "complained" };
    default:
      return { update: {}, suppress: null };
  }
}
