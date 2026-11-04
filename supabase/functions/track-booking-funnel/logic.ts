// Pure logic for track-booking-funnel: checking and cleaning what the
// website / hub send, before it becomes booking_funnel_events rows.
// No Deno or network imports, so it runs under Vitest (logic.test.ts).
//
// Only the fields listed in FunnelRow are kept. Anything else the page sends
// (names, emails, phones from consultation_reserved etc.) is dropped here.

/** Events we store. Anything else in a batch is skipped, not an error. */
export const ALLOWED_EVENTS = new Set([
  // /our-therapists: Book Now clicked on a therapist card
  "booking_page_redirect",
  // the booking wizard (website and hub use the same names)
  "booking_page_view",
  "booking_step_view",
  // stored but not a funnel step: the "Earliest time" shortcut doesn't fire it
  "booking_time_selected",
  "booking_plan_selected",
  "booking_plan_confirmed",
  "booking_details_submitted",
  "booking_payment_initiated",
  "booking_payment_submitted",
  "booking_payment_failed",
  "booking_completed",
  "booking_referral_source",
  // website: bundle chosen, sent on to my.fettle.ie/packages
  "booking_bundle_handoff",
  // hub: bundle bought by someone who arrived from that hand-off
  "booking_bundle_purchased",
  // dead ends, if the website reports them
  "booking_no_availability",
  "booking_therapist_unavailable",
]);

export const FLOWS = ["website", "hub"] as const;
export type Flow = (typeof FLOWS)[number];

export const DEVICES = ["mobile", "tablet", "desktop"] as const;

/** Most events accepted in one request. */
export const MAX_BATCH = 25;
/** Largest request body we read, in bytes. */
export const MAX_BODY_BYTES = 32_000;
/** occurred_at further than this from the server clock is replaced by now. */
export const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

/** Events are kept this long (13 months, so a year can be compared with the one before). */
export const RETENTION_DAYS = 395;
/** Share of requests that also delete events older than RETENTION_DAYS. */
export const PURGE_CHANCE = 0.01;

/** The cut-off for the clean-up: events before this are deleted. */
export function retentionCutoff(nowMs: number): string {
  return new Date(nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Origins that may send events. More can be added with FUNNEL_EXTRA_ORIGINS. */
export const DEFAULT_ORIGINS = [
  "https://fettle.ie",
  "https://www.fettle.ie",
  "https://my.fettle.ie",
];

export interface FunnelRow {
  event_id: string;
  occurred_at: string;
  session_id: string;
  flow: Flow;
  booking_flow: string | null;
  page_variant: string | null;
  is_test: boolean;
  event: string;
  step_name: string | null;
  step: number | null;
  therapist_id: number | null;
  therapist: string | null;
  entry_therapist: string | null;
  service: string | null;
  path: string | null;
  package_id: string | null;
  booking_id: string | null;
  amount: number | null;
  reason: string | null;
  referral_source: string | null;
  device: string | null;
  page: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

export type ParseResult =
  | { ok: true; rows: FunnelRow[]; skipped: number }
  | { ok: false; error: string };

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Trimmed text cut to max, or null when missing / empty. Numbers become text. */
export function text(value: unknown, max: number): string | null {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

/** Whole number in [min, max] (digit strings accepted), else null. */
export function int(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Path part of a page address, without query string or hash. */
export function pagePath(value: unknown): string | null {
  const t = text(value, 2000);
  if (!t) return null;
  let path = t;
  try {
    path = new URL(t, "https://fettle.ie").pathname;
  } catch {
    path = t.split(/[?#]/)[0];
  }
  return path.startsWith("/") ? path.slice(0, 200) : null;
}

/** Event time from the page, or now when missing or too far off. */
export function occurredAt(value: unknown, nowMs: number): string {
  let ms: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) ms = value;
  else if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) ms = parsed;
  }
  if (ms === null || Math.abs(ms - nowMs) > MAX_CLOCK_SKEW_MS) ms = nowMs;
  return new Date(ms).toISOString();
}

/** Euro amount (number or numeric string) in [0, 100000), rounded to cents, else null. */
export function amount(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 100_000
    ? Math.round(n * 100) / 100
    : null;
}

/** Lower-case text from a fixed list, else null. */
function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
  const t = text(value, 32)?.toLowerCase();
  return t && (options as readonly string[]).includes(t) ? (t as T) : null;
}

/**
 * Checks a request body and turns it into rows.
 *
 * Body: { session_id, flow, is_test?, context?: {device, page, utm_*}, events: [...] }
 * (a single event object in place of `events` is also accepted). Each event
 * may override page. Bad session / flow / shape fails the whole request;
 * a bad or unknown single event is only skipped.
 */
export function parsePayload(body: unknown, nowMs: number): ParseResult {
  if (!isObj(body)) return { ok: false, error: "invalid_body" };

  const sessionId = typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!ID_RE.test(sessionId)) return { ok: false, error: "invalid_session_id" };

  const flow = oneOf(body.flow, FLOWS);
  if (!flow) return { ok: false, error: "invalid_flow" };

  const rawEvents = Array.isArray(body.events) ? body.events : isObj(body.event) ? [body.event] : null;
  if (!rawEvents || rawEvents.length === 0) return { ok: false, error: "no_events" };
  if (rawEvents.length > MAX_BATCH) return { ok: false, error: "too_many_events" };

  const isTest = body.is_test === true;
  const ctx = isObj(body.context) ? body.context : {};
  const device = oneOf(ctx.device, DEVICES);
  const contextPage = pagePath(ctx.page);
  const utmSource = text(ctx.utm_source, 100);
  const utmMedium = text(ctx.utm_medium, 100);
  const utmCampaign = text(ctx.utm_campaign, 150);

  const rows: FunnelRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of rawEvents) {
    if (!isObj(raw)) { skipped++; continue; }
    const event = text(raw.event, 64);
    const eventId = typeof raw.event_id === "string" ? raw.event_id.trim() : "";
    if (!event || !ALLOWED_EVENTS.has(event) || !ID_RE.test(eventId) || seen.has(eventId)) {
      skipped++;
      continue;
    }
    seen.add(eventId);
    const entryTherapist = text(raw.entry_therapist, 120);
    rows.push({
      event_id: eventId,
      occurred_at: occurredAt(raw.ts, nowMs),
      session_id: sessionId,
      flow,
      booking_flow: text(raw.booking_flow, 64),
      page_variant: text(raw.page_variant, 64),
      is_test: isTest || raw.is_test === true,
      event,
      step_name: text(raw.step_name, 64),
      step: int(raw.step, 0, 50),
      // The website sends the ?t= id as entry_therapist on booking_page_view.
      therapist_id: int(raw.therapist_id, 1, 10_000_000) ?? int(entryTherapist, 1, 10_000_000),
      therapist: text(raw.therapist, 120),
      entry_therapist: entryTherapist,
      // The website calls it `who` (individual / couples / youth).
      service: (text(raw.service, 32) ?? text(raw.who, 32))?.toLowerCase() ?? null,
      path: text(raw.path, 32)?.toLowerCase() ?? null,
      package_id: text(raw.package_id, 64),
      booking_id: text(raw.booking_id, 64),
      amount: amount(raw.amount),
      reason: text(raw.reason, 64),
      referral_source: text(raw.referral_source, 64),
      device,
      page: pagePath(raw.page) ?? contextPage,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
    });
  }
  return { ok: true, rows, skipped };
}

/** Allowed origins: the defaults plus a comma-separated extra list (staging, localhost). */
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
 * function's memory, so it only slows down a single noisy client; it is not
 * a hard global limit.
 */
export class RateLimiter {
  private hits = new Map<string, { windowStart: number; count: number }>();
  constructor(private limit: number, private windowMs: number, private maxKeys = 10_000) {}

  /** Records `cost` events for key; false when over the limit. */
  take(key: string, cost: number, nowMs: number): boolean {
    let entry = this.hits.get(key);
    if (!entry || nowMs - entry.windowStart >= this.windowMs) {
      if (!entry && this.hits.size >= this.maxKeys) this.hits.clear();
      entry = { windowStart: nowMs, count: 0 };
      this.hits.set(key, entry);
    }
    if (entry.count + cost > this.limit) return false;
    entry.count += cost;
    return true;
  }
}
