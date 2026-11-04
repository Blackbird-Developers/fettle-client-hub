// Pure logic for the admin Overview's "Booking funnel" tab
// (admin-analytics?action=funnel). Counts the per-session rows from
// admin_funnel_sessions() (booking_funnel_events, filled by
// track-booking-funnel from the website and the hub; see
// docs/BOOKING_FUNNEL_TRACKING.md). No Deno or network imports, so it runs
// under Vitest (funnel.test.ts) and its types are shared with the browser.
//
// How a session is counted:
//   - Each session is placed at the furthest stage it reached. A stage it
//     skipped on the way ("Who it's for" for one-service therapists, the plan
//     for psychologists, "About you" for returning hub clients) counts as
//     passed, so skipped steps never look like drop-offs.
//   - "Book Now clicks" (the /our-therapists card) are not a stage: many
//     visitors land on the booking page straight from ads or links.
//   - Booked = a session booked (booking_completed / the Done step) or a
//     bundle bought in the hub after the website's hand-off.
//   - Test runs (?mock=1, /book-a-session-v1/, local dev) are already left
//     out by the SQL.

import { addDays } from "../admin-customer-insights/logic.ts";
import { type DateRange, daysInRange, dublinDate, isDate, weekStart } from "./logic.ts";

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export const FUNNEL_STAGES = [
  "opened",
  "started",
  "slot",
  "history",
  "details",
  "plan",
  "review",
  "pay",
  "paid",
  "booked",
] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const STAGE_LABELS: Record<FunnelStage, string> = {
  opened: "Opened the booking page",
  started: "Pressed Let's begin",
  slot: "Date & time",
  history: "About you",
  details: "Your details",
  plan: "Choose a plan",
  review: "Review",
  pay: "Payment form",
  paid: "Pressed Pay",
  booked: "Booked",
};

const stageIndex = (s: FunnelStage) => FUNNEL_STAGES.indexOf(s);

/** Which stage each marker proves the session reached. */
const MARKER_STAGE: Record<string, FunnelStage> = {
  booking_page_view: "opened",
  "step:intro": "opened",
  "step:who": "started",
  "step:consultation": "started",
  "step:topics": "started",
  "step:focus": "started",
  "step:matches": "started",
  "step:match": "started",
  "step:slot": "slot",
  booking_time_selected: "slot",
  "step:history": "history",
  "step:details": "details",
  // Details passed: the next screen is the plan (or review for psychologists).
  booking_details_submitted: "plan",
  "step:plan": "plan",
  booking_plan_selected: "plan",
  booking_plan_confirmed: "plan",
  booking_bundle_handoff: "plan",
  "step:review": "review",
  booking_payment_initiated: "pay",
  "step:pay": "pay",
  booking_payment_submitted: "paid",
  booking_payment_failed: "paid",
  booking_completed: "booked",
  "step:done": "booked",
  booking_bundle_purchased: "booked",
};

const MATCHING_MARKERS = ["step:topics", "step:focus", "step:matches", "step:match"];

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type FunnelPath = "therapist" | "matching" | "psychologist";
export const FUNNEL_PATHS: FunnelPath[] = ["therapist", "matching", "psychologist"];
export const FUNNEL_FLOWS = ["website", "hub"] as const;
export type FunnelFlow = (typeof FUNNEL_FLOWS)[number];
export const FUNNEL_DEVICES = ["mobile", "tablet", "desktop"] as const;

export interface FunnelSession {
  startedAt: number;
  flow: FunnelFlow;
  bookingFlow: string | null;
  device: string | null;
  clickTherapist: string | null;
  therapist: string | null;
  service: string | null;
  markers: string[];
  failReasons: string[];
  referralSource: string | null;
  utmSource: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : []);

/** Reads admin_funnel_sessions() output; malformed rows are skipped. */
export function parseFunnelRows(raw: unknown): FunnelSession[] {
  if (!Array.isArray(raw)) return [];
  const out: FunnelSession[] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || typeof r[0] !== "number") continue;
    const flow = r[1] === "hub" ? "hub" : r[1] === "website" ? "website" : null;
    if (!flow) continue;
    out.push({
      startedAt: r[0],
      flow,
      bookingFlow: str(r[2]),
      device: str(r[3]),
      clickTherapist: str(r[4]),
      therapist: str(r[5]),
      service: str(r[6])?.toLowerCase() ?? null,
      markers: strs(r[7]),
      failReasons: strs(r[8]),
      referralSource: str(r[9]),
      utmSource: str(r[10]),
    });
  }
  return out;
}

/**
 * Furthest stage reached, or null for a session that never opened a booking
 * form: a Book Now click only, or a bundle bought from the hub's Packages
 * screen with no booking form involved.
 */
export function furthestStage(markers: string[]): FunnelStage | null {
  if (!markers.some((m) => m === "booking_page_view" || m.startsWith("step:"))) return null;
  let best = -1;
  for (const m of markers) {
    const stage = MARKER_STAGE[m];
    if (stage) best = Math.max(best, stageIndex(stage));
  }
  return best < 0 ? null : FUNNEL_STAGES[best];
}

export function sessionPath(s: FunnelSession): FunnelPath {
  if (s.service === "psychologist" || s.markers.includes("step:consultation")) return "psychologist";
  if (s.markers.some((m) => MATCHING_MARKERS.includes(m))) return "matching";
  return "therapist";
}

/** Service for the filter: individual / couples / youth / psychologist, or null if never chosen. */
export function sessionService(s: FunnelSession): string | null {
  if (sessionPath(s) === "psychologist") return "psychologist";
  return s.service;
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const FUNNEL_MAX_RANGE_DAYS = 366;
/** Ranges up to this many days are drawn per day, longer ones per week. */
export const FUNNEL_DAILY_MAX_DAYS = 31;

export interface FunnelFilters {
  flow: FunnelFlow | null;
  device: string | null;
  path: FunnelPath | null;
  service: string | null;
  therapist: string | null;
}

export interface FunnelParams {
  range: DateRange;
  filters: FunnelFilters;
}

export function parseFunnelParams(search: URLSearchParams): FunnelParams | string {
  const from = search.get("from");
  const to = search.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return "from and to must be dates, from first";
  const range = { from, to };
  if (daysInRange(range) > FUNNEL_MAX_RANGE_DAYS) return "The date range can be at most one year";

  const flow = search.get("flow");
  if (flow !== null && !(FUNNEL_FLOWS as readonly string[]).includes(flow)) return "flow must be website or hub";
  const device = search.get("device");
  if (device !== null && !(FUNNEL_DEVICES as readonly string[]).includes(device)) return "device must be mobile, tablet or desktop";
  const path = search.get("path");
  if (path !== null && !(FUNNEL_PATHS as string[]).includes(path)) return "path must be therapist, matching or psychologist";
  const service = search.get("service")?.trim().toLowerCase() || null;
  const therapist = search.get("therapist")?.trim() || null;

  return {
    range,
    filters: { flow: flow as FunnelFlow | null, device, path: path as FunnelPath | null, service, therapist },
  };
}

/** UTC bounds wide enough to cover the Dublin dates; rows are trimmed exactly by inRange(). */
export function queryBounds(range: DateRange): { from: string; to: string } {
  return { from: `${addDays(range.from, -1)}T00:00:00Z`, to: `${addDays(range.to, 2)}T00:00:00Z` };
}

const inRange = (s: FunnelSession, range: DateRange) => {
  const d = dublinDate(s.startedAt);
  return d >= range.from && d <= range.to;
};

function matches(s: FunnelSession, f: FunnelFilters, ignore: keyof FunnelFilters | null = null): boolean {
  if (ignore !== "flow" && f.flow && s.flow !== f.flow) return false;
  if (ignore !== "device" && f.device && s.device !== f.device) return false;
  if (ignore !== "path" && f.path && sessionPath(s) !== f.path) return false;
  if (ignore !== "service" && f.service && sessionService(s) !== f.service) return false;
  if (ignore !== "therapist" && f.therapist && (s.therapist ?? s.clickTherapist) !== f.therapist) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface StageCount {
  stage: FunnelStage;
  label: string;
  /** Sessions that reached this stage or further. */
  sessions: number;
  /** % of the previous stage (null for the first, or when it had none). */
  fromPrevious: number | null;
  /** % of opened. */
  fromStart: number | null;
}

export interface TherapistRow {
  therapist: string;
  clicks: number;
  opened: number;
  reachedPayment: number;
  booked: number;
  /** booked / opened, %. */
  conversion: number | null;
  /** Of those who chose them through matching. */
  matched: number;
}

export interface FunnelPoint {
  key: string;
  opened: number;
  booked: number;
  conversion: number | null;
}

export interface FunnelReport {
  sessions: number;
  bookNowClicks: number;
  stages: StageCount[];
  /** The step with the biggest drop from the one before it. */
  biggestDrop: { stage: FunnelStage; label: string; lost: number; lostPct: number } | null;
  outcomes: { sessionsBooked: number; bundleHandoffs: number; bundlesBought: number };
  byPath: { path: FunnelPath; opened: number; booked: number; conversion: number | null }[];
  byDevice: { device: string; opened: number; booked: number; conversion: number | null }[];
  therapists: TherapistRow[];
  failReasons: { reason: string; sessions: number }[];
  referralSources: { source: string; sessions: number }[];
  groupBy: "day" | "week";
  series: FunnelPoint[];
  /** For the filter dropdowns: every value seen in the range (other filters ignored). */
  options: { therapists: string[]; services: string[] };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function reached(s: FunnelSession, stage: FunnelStage): boolean {
  const furthest = furthestStage(s.markers);
  return furthest !== null && stageIndex(furthest) >= stageIndex(stage);
}

function countBy<T extends string>(items: T[]): { key: T; n: number }[] {
  const m = new Map<T, number>();
  for (const k of items) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

export function funnelReport(all: FunnelSession[], params: FunnelParams): FunnelReport {
  const inPeriod = all.filter((s) => inRange(s, params.range));
  const sessions = inPeriod.filter((s) => matches(s, params.filters));
  const opened = sessions.filter((s) => reached(s, "opened"));

  // Stages
  const stages: StageCount[] = [];
  let biggestDrop: FunnelReport["biggestDrop"] = null;
  for (let i = 0; i < FUNNEL_STAGES.length; i++) {
    const stage = FUNNEL_STAGES[i];
    const n = opened.filter((s) => reached(s, stage)).length;
    const prev = i > 0 ? stages[i - 1].sessions : null;
    stages.push({
      stage,
      label: STAGE_LABELS[stage],
      sessions: n,
      fromPrevious: prev === null ? null : pct(n, prev),
      fromStart: pct(n, opened.length),
    });
    if (prev !== null && prev > n) {
      const lostPct = Math.round(((prev - n) / prev) * 1000) / 10;
      if (!biggestDrop || lostPct > biggestDrop.lostPct) {
        biggestDrop = { stage, label: STAGE_LABELS[stage], lost: prev - n, lostPct };
      }
    }
  }

  const booked = (s: FunnelSession) => reached(s, "booked");

  // Therapists: clicks by the card clicked, the rest by the therapist the session ended with.
  const rows = new Map<string, TherapistRow>();
  const row = (name: string) => {
    let r = rows.get(name);
    if (!r) {
      r = { therapist: name, clicks: 0, opened: 0, reachedPayment: 0, booked: 0, conversion: null, matched: 0 };
      rows.set(name, r);
    }
    return r;
  };
  for (const s of sessions) {
    if (s.clickTherapist && s.markers.includes("booking_page_redirect")) row(s.clickTherapist).clicks++;
    const name = s.therapist ?? null;
    if (!name || !reached(s, "opened")) continue;
    const r = row(name);
    r.opened++;
    if (reached(s, "pay")) r.reachedPayment++;
    if (booked(s)) r.booked++;
    if (sessionPath(s) === "matching") r.matched++;
  }
  const therapists = [...rows.values()]
    .map((r) => ({ ...r, conversion: pct(r.booked, r.opened) }))
    .sort((a, b) => b.opened - a.opened || b.clicks - a.clicks || a.therapist.localeCompare(b.therapist));

  // Breakdowns
  const byPath = FUNNEL_PATHS.map((path) => {
    const group = opened.filter((s) => sessionPath(s) === path);
    const b = group.filter(booked).length;
    return { path, opened: group.length, booked: b, conversion: pct(b, group.length) };
  });
  const byDevice = (FUNNEL_DEVICES as readonly string[]).map((device) => {
    const group = opened.filter((s) => s.device === device);
    const b = group.filter(booked).length;
    return { device, opened: group.length, booked: b, conversion: pct(b, group.length) };
  });

  const failReasons = countBy(sessions.flatMap((s) => s.failReasons)).map(({ key, n }) => ({ reason: key, sessions: n }));
  const referralSources = countBy(sessions.map((s) => s.referralSource).filter((x): x is string => !!x))
    .map(({ key, n }) => ({ source: key, sessions: n }));

  // Series
  const groupBy = daysInRange(params.range) <= FUNNEL_DAILY_MAX_DAYS ? "day" : "week";
  const keyOf = (date: string) => (groupBy === "day" ? date : weekStart(date));
  const points = new Map<string, FunnelPoint>();
  for (let d = keyOf(params.range.from); d <= params.range.to; d = addDays(d, groupBy === "day" ? 1 : 7)) {
    points.set(d, { key: d, opened: 0, booked: 0, conversion: null });
  }
  for (const s of opened) {
    const p = points.get(keyOf(dublinDate(s.startedAt)));
    if (!p) continue;
    p.opened++;
    if (booked(s)) p.booked++;
  }
  const series = [...points.values()].map((p) => ({ ...p, conversion: pct(p.booked, p.opened) }));

  // Filter options ignore their own filter, so picking one doesn't empty its list.
  const therapistOptions = new Set<string>();
  for (const s of inPeriod.filter((s) => matches(s, params.filters, "therapist"))) {
    if (s.therapist) therapistOptions.add(s.therapist);
    if (s.clickTherapist) therapistOptions.add(s.clickTherapist);
  }
  const serviceOptions = new Set<string>();
  for (const s of inPeriod.filter((s) => matches(s, params.filters, "service"))) {
    const svc = sessionService(s);
    if (svc) serviceOptions.add(svc);
  }

  return {
    sessions: sessions.length,
    bookNowClicks: sessions.filter((s) => s.markers.includes("booking_page_redirect")).length,
    stages,
    biggestDrop,
    outcomes: {
      sessionsBooked: opened.filter((s) => s.markers.includes("booking_completed") || s.markers.includes("step:done")).length,
      bundleHandoffs: opened.filter((s) => s.markers.includes("booking_bundle_handoff")).length,
      bundlesBought: opened.filter((s) => s.markers.includes("booking_bundle_purchased")).length,
    },
    byPath,
    byDevice,
    therapists,
    failReasons,
    referralSources,
    groupBy,
    series,
    options: {
      therapists: [...therapistOptions].sort((a, b) => a.localeCompare(b)),
      services: [...serviceOptions].sort(),
    },
  };
}
