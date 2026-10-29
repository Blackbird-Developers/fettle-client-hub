// Pure logic for the admin-analytics edge function: the admin Overview's
// "Progression over time" and "Customers in a time frame" boards, counted
// from the acuity_appointments copy. No Deno or network imports, so the same
// file runs inside the edge function, under Vitest (logic.test.ts) and in the
// browser (date helpers and types).
//
// Definitions follow docs/admin-overview-analytics-brief.md:
//   - Sessions, customers and session numbers come from the classifier and
//     customer key in admin-customer-insights/logic.ts, over each customer's
//     full history. Cancelled appointments never count.
//   - All dates are Europe/Dublin; weeks start on Monday.
//   - Customers whose history can't be confirmed (no email) are left out of
//     every number and counted separately.

import { ACTIVE_WINDOW_DAYS, DAY_MS, addDays } from "../admin-customer-insights/logic.ts";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Stages shown: 1 = session 1 → 2, … 4 = session 4 → 5. */
export const STAGES = [1, 2, 3, 4] as const;
export type Stage = (typeof STAGES)[number];

/** How long after session N that session N+1 still counts as progressing. */
export const CONVERSION_WINDOWS = [14, 30, 60] as const;
export const DEFAULT_CONVERSION_WINDOW = 30;

/** Days since the previous session for a client to count as returning. 0 =
 *  anyone with an earlier session (open question 5 in the brief). */
export const RETURNING_MIN_GAP_DAYS = 0;

/** Ranges longer than this group by month by default, otherwise by week. */
export const WEEKLY_MAX_DAYS = 90;
/** Longest range the boards accept. */
export const MAX_RANGE_DAYS = 3 * 366;

export const TIME_ZONE = "Europe/Dublin";

export type GroupBy = "week" | "month";
/** Count by when the session takes place, or when the booking was made. */
export type Basis = "session" | "booking";
export type CompareTo = "previous" | "year";

/** Inclusive Dublin dates, YYYY-MM-DD. */
export interface DateRange {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// Dates (Europe/Dublin)
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(value: unknown): value is string {
  return typeof value === "string" && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

const dublinParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Dublin calendar date of a timestamp. */
export function dublinDate(ms: number): string {
  const parts = Object.fromEntries(dublinParts.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Days from `from` to `to`, counting both. */
export function daysInRange(range: DateRange): number {
  return Math.round((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS) + 1;
}

/** Monday of the date's week. */
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthEnd(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function periodStart(date: string, groupBy: GroupBy): string {
  return groupBy === "week" ? weekStart(date) : monthStart(date);
}

export function periodEnd(start: string, groupBy: GroupBy): string {
  return groupBy === "week" ? addDays(start, 6) : monthEnd(start);
}

export interface Period {
  /** Start of the whole week or month; identifies the period. */
  key: string;
  /** The part of the period inside the range. */
  from: string;
  to: string;
}

/** The weeks or months a range covers, clipped to the range. */
export function periodsInRange(range: DateRange, groupBy: GroupBy): Period[] {
  const periods: Period[] = [];
  for (let key = periodStart(range.from, groupBy); key <= range.to; key = addDays(periodEnd(key, groupBy), 1)) {
    const end = periodEnd(key, groupBy);
    periods.push({ key, from: key < range.from ? range.from : key, to: end > range.to ? range.to : end });
  }
  return periods;
}

export function defaultGroupBy(range: DateRange): GroupBy {
  return daysInRange(range) > WEEKLY_MAX_DAYS ? "month" : "week";
}

function shiftYears(date: string, years: number): string {
  const [year, month, day] = date.split("-").map(Number);
  // 29 February becomes 28 February in a year without one.
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return `${year + years}-${String(month).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** The range numbers are compared against. */
export function comparisonRange(range: DateRange, compareTo: CompareTo): DateRange {
  if (compareTo === "year") return { from: shiftYears(range.from, -1), to: shiftYears(range.to, -1) };
  const length = daysInRange(range);
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

// ---------------------------------------------------------------------------
// Sessions and customer histories
// ---------------------------------------------------------------------------

export type SessionKind = "therapy" | "intro" | "assessment";

/** The boards' session type filter. */
export const SESSION_CATEGORIES = ["individual", "couples", "youth", "assessment"] as const;
export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

const COUPLES_TYPE_PATTERN = /couple|marriage|relationship/i;
const YOUTH_TYPE_PATTERN = /youth|teen|child|adolescen/i;

// Which filter a session falls under, by appointment type name (worked out at
// sync time, next to `kind`). Assessments, screenings and psychiatry are
// "assessment"; couples, marriage and relationship types are "couples";
// youth, teen and child types are "youth"; every other session is
// "individual". Null for anything that isn't a session.
export function sessionCategory(type: string | null | undefined, kind: string): SessionCategory | null {
  if (!SESSION_KINDS.has(kind)) return null;
  if (kind === "assessment") return "assessment";
  const name = type ?? "";
  if (COUPLES_TYPE_PATTERN.test(name)) return "couples";
  if (YOUTH_TYPE_PATTERN.test(name)) return "youth";
  return "individual";
}

/** One session from admin_analytics_sessions(). */
export interface SessionRow {
  id: number;
  customerKey: string;
  /** When the session takes place (ms). */
  at: number;
  /** When the booking was made (ms), if Acuity said. */
  createdAt: number | null;
  kind: SessionKind;
  /** Null until the "who booked it" lookup has been done. */
  bookedByClient: boolean | null;
  calendarId: number | null;
  canceled: boolean;
  /** Null for rows copied before categories were added. */
  category: SessionCategory | null;
}

const SESSION_KINDS = new Set<string>(["therapy", "intro", "assessment"]);
const CATEGORIES = new Set<string>(SESSION_CATEGORIES);

/** Reads admin_analytics_sessions()'s compact rows, skipping malformed ones. */
export function parseSessionRows(raw: unknown): SessionRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: SessionRow[] = [];
  for (const item of raw) {
    if (!Array.isArray(item)) continue;
    const [id, customerKey, at, createdAt, kind, bookedByClient, calendarId, canceled, category] = item;
    if (typeof id !== "number" || typeof customerKey !== "string" || typeof at !== "number") continue;
    if (typeof kind !== "string" || !SESSION_KINDS.has(kind)) continue;
    rows.push({
      id,
      customerKey,
      at,
      createdAt: typeof createdAt === "number" ? createdAt : null,
      kind: kind as SessionKind,
      bookedByClient: typeof bookedByClient === "boolean" ? bookedByClient : null,
      calendarId: typeof calendarId === "number" ? calendarId : null,
      canceled: canceled === true,
      category: typeof category === "string" && CATEGORIES.has(category) ? (category as SessionCategory) : null,
    });
  }
  return rows;
}

export interface CalendarOption {
  id: number;
  name: string;
}

/** Reads admin_analytics_calendars() ([[id, name], …]) for the calendar filter, sorted by name. */
export function parseCalendars(raw: unknown): CalendarOption[] {
  if (!Array.isArray(raw)) return [];
  const calendars: CalendarOption[] = [];
  for (const item of raw) {
    if (!Array.isArray(item)) continue;
    const [id, name] = item;
    if (typeof id !== "number" || typeof name !== "string" || !name.trim()) continue;
    calendars.push({ id, name: name.trim() });
  }
  return calendars.sort((a, b) => a.name.localeCompare(b.name));
}

export interface NumberedSession extends SessionRow {
  /** 1 = the customer's first session ever. */
  number: number;
  /** Dublin date of the session. */
  date: string;
  /** Dublin date the booking was made, if known. */
  createdDate: string | null;
  /** Passes the session type and calendar filters. Sessions that don't still
   *  count towards session numbers, just not towards the boards. */
  counted: boolean;
}

/** The boards' optional filters; null = all. */
export interface SessionFilters {
  category: SessionCategory | null;
  calendarId: number | null;
}

export const NO_FILTERS: SessionFilters = { category: null, calendarId: null };

function passesFilters(row: SessionRow, filters: SessionFilters): boolean {
  if (filters.category !== null && row.category !== filters.category) return false;
  if (filters.calendarId !== null && row.calendarId !== filters.calendarId) return false;
  return true;
}

export interface CustomerHistory {
  key: string;
  /** Full history confirmed (has an email). Unverified customers are left out of the numbers. */
  verified: boolean;
  /** Every session, oldest first, numbered. */
  sessions: NumberedSession[];
}

// Customers keyed by phone or appointment id can't be matched reliably
// across bookings, so their session numbers can't be trusted (the
// Progression pages leave out customers without an email the same way).
export function isVerifiedCustomer(key: string): boolean {
  return key.startsWith("email:");
}

/** Groups sessions by customer and numbers them across the full history.
 *  Cancelled sessions never count. Filters only mark which sessions the
 *  boards count; numbering always uses every session. */
export function buildHistories(rows: SessionRow[], filters: SessionFilters = NO_FILTERS): CustomerHistory[] {
  const byKey = new Map<string, SessionRow[]>();
  for (const row of rows) {
    if (row.canceled) continue;
    const list = byKey.get(row.customerKey);
    if (list) list.push(row);
    else byKey.set(row.customerKey, [row]);
  }
  const histories: CustomerHistory[] = [];
  for (const [key, list] of byKey) {
    list.sort((a, b) => a.at - b.at || a.id - b.id);
    histories.push({
      key,
      verified: isVerifiedCustomer(key),
      sessions: list.map((row, i) => ({
        ...row,
        number: i + 1,
        date: dublinDate(row.at),
        createdDate: row.createdAt === null ? null : dublinDate(row.createdAt),
        counted: passesFilters(row, filters),
      })),
    });
  }
  return histories;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** Maps a date to its period key, or null when outside the range. */
function periodKeyer(range: DateRange, groupBy: GroupBy | null): (date: string | null) => string | null {
  return (date) => {
    if (date === null || date < range.from || date > range.to) return null;
    return groupBy === null ? range.from : periodStart(date, groupBy);
  };
}

// ---------------------------------------------------------------------------
// Board 1: Progression over time
// ---------------------------------------------------------------------------

export interface StageResult {
  stage: Stage;
  /** Verified customers who completed session N in the period. */
  cohort: number;
  /** …of whom completed or booked session N+1 within the window. */
  progressed: number;
  /** progressed / cohort; null when the cohort is empty. */
  rate: number | null;
  /** Median days from session N to N+1, among those who progressed. */
  medianDays: number | null;
}

interface StageTally {
  cohort: number;
  progressed: number;
  gaps: number[];
}

// A period's figures are final once every client in it has had the whole
// window to rebook: the day after the window closes for its last day.
export function finalOn(to: string, windowDays: number): string {
  return addDays(to, windowDays + 1);
}

function tallyProgression(
  histories: CustomerHistory[],
  now: number,
  windowDays: number,
  keyOf: (date: string | null) => string | null
): { tallies: Map<string, StageTally[]>; excluded: Map<string, Set<string>>; funnel: Map<string, Set<string>[]> } {
  const tallies = new Map<string, StageTally[]>();
  const excluded = new Map<string, Set<string>>();
  // Customers completing session 1, 2, 3, 4 and 5+ per period.
  const funnel = new Map<string, Set<string>[]>();
  const windowMs = windowDays * DAY_MS;

  for (const history of histories) {
    for (const session of history.sessions) {
      if (session.at >= now) break; // not completed yet
      const key = keyOf(session.date);
      if (key === null || !session.counted) continue;

      if (!history.verified) {
        if (session.number <= STAGES.length) {
          if (!excluded.has(key)) excluded.set(key, new Set());
          excluded.get(key)!.add(history.key);
        }
        continue;
      }

      if (!funnel.has(key)) funnel.set(key, Array.from({ length: STAGES.length + 1 }, () => new Set<string>()));
      funnel.get(key)![Math.min(session.number, STAGES.length + 1) - 1].add(history.key);

      if (session.number > STAGES.length) continue;
      if (!tallies.has(key)) {
        tallies.set(key, STAGES.map(() => ({ cohort: 0, progressed: 0, gaps: [] })));
      }
      const tally = tallies.get(key)![session.number - 1];
      tally.cohort++;
      // Completed or booked: any later non-cancelled session counts, of any
      // type or calendar.
      const next = history.sessions[session.number];
      if (next && next.at - session.at <= windowMs) {
        tally.progressed++;
        tally.gaps.push((next.at - session.at) / DAY_MS);
      }
    }
  }
  return { tallies, excluded, funnel };
}

function stageResults(tally: StageTally[] | undefined): StageResult[] {
  return STAGES.map((stage, i) => {
    const t = tally?.[i] ?? { cohort: 0, progressed: 0, gaps: [] };
    return {
      stage,
      cohort: t.cohort,
      progressed: t.progressed,
      rate: rate(t.progressed, t.cohort),
      medianDays: median(t.gaps),
    };
  });
}

export interface ProgressionTotals {
  stages: StageResult[];
  /** All stages combined. */
  overall: { cohort: number; progressed: number; rate: number | null };
  /** Stage with the highest / lowest rate (null when none has a cohort). */
  best: Stage | null;
  worst: Stage | null;
  /** Customers completing session 1, 2, 3, 4 and 5+ in the range. */
  funnel: { label: string; customers: number }[];
  /** Unverified customers left out. */
  excludedCustomers: number;
  /** False while clients in the range haven't had the whole window to rebook. */
  final: boolean;
  finalOn: string;
}

export interface ProgressionPoint {
  period: Period;
  stages: StageResult[];
  final: boolean;
  finalOn: string;
}

function totalsFrom(
  tally: StageTally[] | undefined,
  funnelSets: Set<string>[] | undefined,
  excluded: Set<string> | undefined,
  range: DateRange,
  today: string,
  windowDays: number
): ProgressionTotals {
  const stages = stageResults(tally);
  const cohort = stages.reduce((sum, s) => sum + s.cohort, 0);
  const progressed = stages.reduce((sum, s) => sum + s.progressed, 0);
  const rated = stages.filter((s) => s.rate !== null);
  const best = rated.length ? rated.reduce((a, b) => (b.rate! > a.rate! ? b : a)).stage : null;
  const worst = rated.length ? rated.reduce((a, b) => (b.rate! < a.rate! ? b : a)).stage : null;
  const final = finalOn(range.to, windowDays);
  return {
    stages,
    overall: { cohort, progressed, rate: rate(progressed, cohort) },
    best,
    worst,
    funnel: ["1", "2", "3", "4", "5+"].map((label, i) => ({ label, customers: funnelSets?.[i].size ?? 0 })),
    excludedCustomers: excluded?.size ?? 0,
    final: today >= final,
    finalOn: final,
  };
}

/** Headline figures and funnel for one range. */
export function progressionTotals(
  histories: CustomerHistory[],
  range: DateRange,
  now: number,
  windowDays: number
): ProgressionTotals {
  const { tallies, excluded, funnel } = tallyProgression(histories, now, windowDays, periodKeyer(range, null));
  return totalsFrom(
    tallies.get(range.from),
    funnel.get(range.from),
    excluded.get(range.from),
    range,
    dublinDate(now),
    windowDays
  );
}

/** Stage rates per week or month: the lines on the main chart. */
export function progressionSeries(
  histories: CustomerHistory[],
  range: DateRange,
  groupBy: GroupBy,
  now: number,
  windowDays: number
): ProgressionPoint[] {
  const { tallies } = tallyProgression(histories, now, windowDays, periodKeyer(range, groupBy));
  const today = dublinDate(now);
  return periodsInRange(range, groupBy).map((period) => {
    const final = finalOn(period.to, windowDays);
    return { period, stages: stageResults(tallies.get(period.key)), final: today >= final, finalOn: final };
  });
}

// ---------------------------------------------------------------------------
// Board 2: Customers in a time frame
// ---------------------------------------------------------------------------

export type CustomerSegment = "active" | "new" | "new_self" | "new_staff" | "new_unknown" | "returning";

export const CUSTOMER_SEGMENTS: CustomerSegment[] = [
  "active",
  "new",
  "new_self",
  "new_staff",
  "new_unknown",
  "returning",
];

interface Activity {
  /** The session that put the customer in the period: their first there. */
  session: NumberedSession;
  isNew: boolean;
  isReturning: boolean;
}

function sessionDate(session: NumberedSession, basis: Basis): string | null {
  return basis === "session" ? session.date : session.createdDate;
}

// Each customer's activity per period. New = their first-ever session is in
// the period; returning = active in the period and had a session before it
// (at least RETURNING_MIN_GAP_DAYS before). By booking date, "in the period"
// means the booking was made in it.
function customerActivity(
  history: CustomerHistory,
  basis: Basis,
  keyOf: (date: string | null) => string | null,
  minGapDays: number
): Map<string, Activity> {
  const activity = new Map<string, Activity>();
  for (const session of history.sessions) {
    if (!session.counted) continue;
    const key = keyOf(sessionDate(session, basis));
    if (key === null || activity.has(key)) continue;
    const isNew = session.number === 1;
    const previous = isNew ? null : history.sessions[session.number - 2];
    const isReturning = previous !== null && (session.at - previous.at) / DAY_MS >= minGapDays;
    activity.set(key, { session, isNew, isReturning });
  }
  return activity;
}

function inSegment(activity: Activity, segment: CustomerSegment): boolean {
  switch (segment) {
    case "active":
      return true;
    case "new":
      return activity.isNew;
    case "new_self":
      return activity.isNew && activity.session.bookedByClient === true;
    case "new_staff":
      return activity.isNew && activity.session.bookedByClient === false;
    case "new_unknown":
      return activity.isNew && activity.session.bookedByClient === null;
    case "returning":
      return activity.isReturning;
  }
}

export interface CustomerCounts {
  /** Unique customers with a session (or booking) in the range. */
  active: number;
  new: number;
  newSelf: number;
  newStaff: number;
  /** New customers whose "who booked it" lookup hasn't been done yet. */
  newUnknown: number;
  returning: number;
}

const emptyCounts = (): CustomerCounts => ({
  active: 0,
  new: 0,
  newSelf: 0,
  newStaff: 0,
  newUnknown: 0,
  returning: 0,
});

function addActivity(counts: CustomerCounts, activity: Activity) {
  counts.active++;
  if (activity.isNew) {
    counts.new++;
    if (activity.session.bookedByClient === true) counts.newSelf++;
    else if (activity.session.bookedByClient === false) counts.newStaff++;
    else counts.newUnknown++;
  }
  if (activity.isReturning) counts.returning++;
}

export interface CustomerTotals extends CustomerCounts {
  /** Unverified customers left out. */
  excludedCustomers: number;
}

export function customerTotals(
  histories: CustomerHistory[],
  range: DateRange,
  basis: Basis,
  minGapDays = RETURNING_MIN_GAP_DAYS
): CustomerTotals {
  const keyOf = periodKeyer(range, null);
  const counts = emptyCounts();
  let excludedCustomers = 0;
  for (const history of histories) {
    const activity = customerActivity(history, basis, keyOf, minGapDays).get(range.from);
    if (!activity) continue;
    if (!history.verified) excludedCustomers++;
    else addActivity(counts, activity);
  }
  return { ...counts, excludedCustomers };
}

export interface CustomerPoint extends CustomerCounts {
  period: Period;
  /** Session bookings made in the period (all customers), by who made them. */
  bookings: number;
  selfBookings: number;
  /** Bookings whose "who booked it" lookup is done. */
  checkedBookings: number;
  /** selfBookings / checkedBookings. */
  selfBookingShare: number | null;
}

/** New and returning customers, and the self-booking share, per week or month. */
export function customerSeries(
  histories: CustomerHistory[],
  range: DateRange,
  groupBy: GroupBy,
  basis: Basis,
  minGapDays = RETURNING_MIN_GAP_DAYS
): CustomerPoint[] {
  const keyOf = periodKeyer(range, groupBy);
  const periods = periodsInRange(range, groupBy);
  const points = new Map<string, CustomerPoint>(
    periods.map((period) => [
      period.key,
      { period, ...emptyCounts(), bookings: 0, selfBookings: 0, checkedBookings: 0, selfBookingShare: null },
    ])
  );

  for (const history of histories) {
    if (history.verified) {
      for (const [key, activity] of customerActivity(history, basis, keyOf, minGapDays)) {
        const point = points.get(key);
        if (point) addActivity(point, activity);
      }
    }
    // The self-booking share is about bookings, so every customer counts.
    for (const session of history.sessions) {
      const point = points.get(keyOf(session.createdDate) ?? "");
      if (!point || !session.counted) continue;
      point.bookings++;
      if (session.bookedByClient !== null) point.checkedBookings++;
      if (session.bookedByClient === true) point.selfBookings++;
    }
  }

  for (const point of points.values()) {
    point.selfBookingShare = rate(point.selfBookings, point.checkedBookings);
  }
  return [...points.values()];
}

export interface SegmentMember {
  customerKey: string;
  /** The session that put them in the segment (their first in the range). */
  sessionId: number;
  /** Their first-ever session. */
  firstSessionId: number;
  firstSessionAt: number;
  /** The Progression page they appear on, if any (see progressionPage). */
  progressionFrom: Stage | null;
}

/** The customers behind a number on the Customers board. */
export function segmentMembers(
  histories: CustomerHistory[],
  range: DateRange,
  basis: Basis,
  segment: CustomerSegment,
  now: number,
  minGapDays = RETURNING_MIN_GAP_DAYS
): SegmentMember[] {
  const keyOf = periodKeyer(range, null);
  const members: SegmentMember[] = [];
  for (const history of histories) {
    if (!history.verified) continue;
    const activity = customerActivity(history, basis, keyOf, minGapDays).get(range.from);
    if (!activity || !inSegment(activity, segment)) continue;
    members.push({
      customerKey: history.key,
      sessionId: activity.session.id,
      firstSessionId: history.sessions[0].id,
      firstSessionAt: history.sessions[0].at,
      progressionFrom: progressionPage(history, now),
    });
  }
  return members.sort((a, b) => b.firstSessionAt - a.firstSessionAt);
}

// The Progression page (Session N–N+1) that lists this customer: the pages
// show everyone whose first completed session in the last 30 days was
// session N (admin-customer-insights progressionCandidates).
export function progressionPage(history: CustomerHistory, now: number): Stage | null {
  const windowStart = now - ACTIVE_WINDOW_DAYS * DAY_MS;
  const first = history.sessions.find((s) => s.at < now && s.at >= windowStart);
  if (!first || first.number > STAGES.length) return null;
  return first.number as Stage;
}

// ---------------------------------------------------------------------------
// Request parameters
// ---------------------------------------------------------------------------

export interface AnalyticsParams {
  range: DateRange;
  groupBy: GroupBy;
  compareTo: CompareTo;
  windowDays: number;
  basis: Basis;
  filters: SessionFilters;
}

/** Reads and checks the boards' query string. Returns an error message when invalid. */
export function parseAnalyticsParams(search: URLSearchParams): AnalyticsParams | string {
  const from = search.get("from");
  const to = search.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return "from and to must be dates, from first";
  const range = { from, to };
  if (daysInRange(range) > MAX_RANGE_DAYS) return "The date range can be at most three years";

  const groupBy = search.get("group") ?? defaultGroupBy(range);
  if (groupBy !== "week" && groupBy !== "month") return "group must be week or month";
  const compareTo = search.get("compare") ?? "previous";
  if (compareTo !== "previous" && compareTo !== "year") return "compare must be previous or year";
  const windowDays = Number(search.get("window") ?? DEFAULT_CONVERSION_WINDOW);
  if (!(CONVERSION_WINDOWS as readonly number[]).includes(windowDays)) return "window must be 14, 30 or 60";
  const basis = search.get("basis") ?? "session";
  if (basis !== "session" && basis !== "booking") return "basis must be session or booking";
  const category = search.get("type");
  if (category !== null && !CATEGORIES.has(category)) return `type must be one of ${SESSION_CATEGORIES.join(", ")}`;
  const calendar = search.get("calendar");
  const calendarId = calendar === null ? null : Number(calendar);
  if (calendarId !== null && !Number.isInteger(calendarId)) return "calendar must be a calendar id";

  return {
    range,
    groupBy,
    compareTo,
    windowDays,
    basis,
    filters: { category: category as SessionCategory | null, calendarId },
  };
}
