// Pure helpers for chat-visitor: request parsing, limits and token helpers.
// No Deno or Supabase imports, so vitest can run them.

/** Origins that may use the chat. More can be added with CHAT_EXTRA_ORIGINS. */
export const DEFAULT_ORIGINS = ["https://fettle.ie", "https://www.fettle.ie"];

/** Largest request body we read, in characters. */
export const MAX_BODY_BYTES = 16_000;
/** Longest message a visitor can send. */
export const MAX_MESSAGE_LENGTH = 2000;
/** Most messages returned by one history call. */
export const HISTORY_LIMIT = 300;

/** Requests a minute per IP, all actions together (history polls included). */
export const REQUESTS_PER_MINUTE = 120;
/** New conversations an IP may start in an hour. */
export const STARTS_PER_HOUR = 5;
/** Messages a visitor may send in one conversation in a minute. */
export const MESSAGES_PER_MINUTE = 15;
/**
 * Staff are emailed about every visitor message, except one that follows
 * another message in the same chat this closely: a visitor sending three
 * lines in a row, or answering someone who is replying right now, is one
 * email, not three.
 */
export const ALERT_GAP_MS = 2 * 60 * 1000;

/** Who is emailed when CHAT_ALERT_EMAILS isn't set. */
export const DEFAULT_ALERT_EMAILS = ["alex@fettle.ie"];

/** The addresses to email: CHAT_ALERT_EMAILS (comma-separated), else the default; "off" sends none. */
export function alertRecipients(setting: string | undefined | null): string[] {
  const value = (setting ?? "").trim();
  if (value.toLowerCase() === "off") return [];
  const list = value
    .split(",")
    .map((address) => address.trim())
    .filter((address) => EMAIL_SHAPE.test(address));
  return list.length > 0 ? list : [...DEFAULT_ALERT_EMAILS];
}

export function allowedOrigins(extra: string | undefined | null): Set<string> {
  const list = [...DEFAULT_ORIGINS];
  for (const o of (extra ?? "").split(",")) {
    const t = o.trim().replace(/\/+$/, "");
    if (t) list.push(t);
  }
  return new Set(list);
}

/**
 * Small fixed-window rate limiter, per key (the caller's IP). Lives in the
 * function's memory, so it only slows down a single noisy client; the hard
 * limits are the database counts in index.ts.
 */
export class RateLimiter {
  private hits = new Map<string, { windowStart: number; count: number }>();
  constructor(private limit: number, private windowMs: number, private maxKeys = 10_000) {}

  take(key: string, nowMs: number): boolean {
    let entry = this.hits.get(key);
    if (!entry || nowMs - entry.windowStart >= this.windowMs) {
      if (!entry && this.hits.size >= this.maxKeys) this.hits.clear();
      entry = { windowStart: nowMs, count: 0 };
      this.hits.set(key, entry);
    }
    if (entry.count + 1 > this.limit) return false;
    entry.count += 1;
    return true;
  }
}

// Control characters except tab and new line.
// deno-lint-ignore no-control-regex
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Trimmed text without control characters, cut to max; null when empty or not a string. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARS, "").replace(/\r\n?/g, "\n").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

/** Same as text, on one line. */
export function line(value: unknown, max: number): string | null {
  const cleaned = text(value, max * 2);
  return cleaned ? cleaned.replace(/\s+/g, " ").slice(0, max) : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_SHAPE = EMAIL;

/** Lower-cased email, or null when it isn't one. */
export function email(value: unknown): string | null {
  const cleaned = line(value, 200);
  return cleaned && EMAIL.test(cleaned) ? cleaned.toLowerCase() : null;
}

/** A phone number as typed (digits, spaces, + - ( )), with at least 7 digits; else null. */
export function phone(value: unknown): string | null {
  const cleaned = line(value, 40);
  if (!cleaned || !/^[0-9+\-() ]+$/.test(cleaned)) return null;
  return cleaned.replace(/\D/g, "").length >= 7 ? cleaned : null;
}

/** An http(s) URL without its fragment, or null. */
export function url(value: unknown, max = 500): string | null {
  const cleaned = line(value, 2000);
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    return parsed.toString().slice(0, max);
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[0-9a-f]{48}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

export interface Credentials {
  conversationId: string;
  secret: string;
}

export interface VisitorDetails {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface PageContext {
  pageUrl: string | null;
  pageTitle: string | null;
  referrer: string | null;
}

export type ChatRequest =
  | ({ action: "start"; body: string; clientId: string; offline: boolean } & VisitorDetails & PageContext)
  | ({ action: "send"; body: string; clientId: string } & Credentials)
  | ({ action: "history"; markRead: boolean } & Credentials)
  | ({ action: "identify" } & Credentials & VisitorDetails);

export type ParseResult = { ok: true; request: ChatRequest } | { ok: false; error: string };

function credentials(body: Record<string, unknown>): Credentials | null {
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
  const secret = typeof body.secret === "string" ? body.secret : "";
  if (!UUID.test(conversationId) || !SECRET.test(secret)) return null;
  return { conversationId: conversationId.toLowerCase(), secret };
}

function message(body: Record<string, unknown>): { body: string; clientId: string } | string {
  const raw = typeof body.body === "string" ? body.body : "";
  if (raw.length > MAX_MESSAGE_LENGTH * 2) return "message_too_long";
  const cleaned = text(raw, MAX_MESSAGE_LENGTH + 1);
  if (!cleaned) return "empty_message";
  if (cleaned.length > MAX_MESSAGE_LENGTH) return "message_too_long";
  const clientId = typeof body.client_id === "string" ? body.client_id : "";
  if (!CLIENT_ID.test(clientId)) return "invalid_client_id";
  return { body: cleaned, clientId };
}

/** Checks a request body and keeps only the fields each action uses. */
export function parseRequest(input: unknown): ParseResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "invalid_body" };
  }
  const body = input as Record<string, unknown>;

  switch (body.action) {
    case "start": {
      const msg = message(body);
      if (typeof msg === "string") return { ok: false, error: msg };
      return {
        ok: true,
        request: {
          action: "start",
          ...msg,
          offline: body.offline === true,
          name: line(body.name, 100),
          email: email(body.email),
          phone: phone(body.phone),
          pageUrl: url(body.page_url),
          pageTitle: line(body.page_title, 200),
          referrer: url(body.referrer),
        },
      };
    }
    case "send": {
      const creds = credentials(body);
      if (!creds) return { ok: false, error: "invalid_credentials" };
      const msg = message(body);
      if (typeof msg === "string") return { ok: false, error: msg };
      return { ok: true, request: { action: "send", ...creds, ...msg } };
    }
    case "history": {
      const creds = credentials(body);
      if (!creds) return { ok: false, error: "invalid_credentials" };
      return { ok: true, request: { action: "history", ...creds, markRead: body.read === true } };
    }
    case "identify": {
      const creds = credentials(body);
      if (!creds) return { ok: false, error: "invalid_credentials" };
      const name = line(body.name, 100);
      const mail = email(body.email);
      const tel = phone(body.phone);
      if (body.email && !mail) return { ok: false, error: "invalid_email" };
      if (body.phone && !tel) return { ok: false, error: "invalid_phone" };
      if (!name && !mail && !tel) return { ok: false, error: "nothing_to_save" };
      return { ok: true, request: { action: "identify", ...creds, name, email: mail, phone: tel } };
    }
    default:
      return { ok: false, error: "unknown_action" };
  }
}

/** Random lower-case hex string of `bytes` bytes. */
export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two strings without stopping at the first difference. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when staff should get an email about this visitor message. */
export function shouldAlert(previousMessageAt: string | null, nowMs: number): boolean {
  if (!previousMessageAt) return true;
  const previous = Date.parse(previousMessageAt);
  return !Number.isFinite(previous) || nowMs - previous >= ALERT_GAP_MS;
}

/** The note added to a chat started outside working hours. */
export const OFFLINE_NOTE =
  "Thanks for your message. We're outside our working hours right now, and we will respond to you as soon as we can.";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The staff alert email for a new chat (or a chat that woke up again). */
export function alertEmail(input: {
  isNew: boolean;
  offline?: boolean;
  visitorName: string | null;
  visitorEmail: string | null;
  visitorPhone?: string | null;
  pageUrl: string | null;
  body: string;
  inboxUrl: string;
}): { subject: string; html: string } {
  const who = input.visitorName ?? input.visitorEmail ?? "A website visitor";
  const subject = input.isNew
    ? input.offline
      ? `${who} left a message outside working hours`
      : `New live chat from ${who}`
    : `${who} replied in live chat`;
  const contact = [
    input.visitorPhone ? `Phone: ${input.visitorPhone}` : null,
    input.visitorEmail ? `Email: ${input.visitorEmail}` : null,
  ]
    .filter((row): row is string => !!row)
    .map((row) => `<p style="margin:0 0 4px;font-size:14px">${escapeHtml(row)}</p>`)
    .join("");
  const page = input.pageUrl
    ? `<p style="margin:0 0 16px;color:#6b6a68;font-size:14px">Page: ${escapeHtml(input.pageUrl)}</p>`
    : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#2d2c2b">
  <h2 style="margin:0 0 8px;font-size:20px">${escapeHtml(subject)}</h2>
  ${page}
  ${contact}
  <div style="margin-top:12px;background:#fdf5eb;border-radius:12px;padding:16px;white-space:pre-wrap;font-size:15px;line-height:1.5">${escapeHtml(input.body)}</div>
  <p style="margin:24px 0 0"><a href="${escapeHtml(input.inboxUrl)}" style="background:#ff7300;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;display:inline-block">Reply in the Inbox</a></p>
</div>`;
  return { subject, html };
}
