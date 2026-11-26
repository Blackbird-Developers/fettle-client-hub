// Pure logic for admin-analytics?action=consultations, the Overview's "Free
// consultations" tab: the free 20-minute calls ("Let's Talk" and "Fettle
// Introduction Chat"), how many were booked, how many people didn't show,
// new vs existing customers, and how many went on to book a paid session.
// No Deno or network imports, so the same file runs inside the edge function
// and under Vitest (consultations.test.ts).
//
// Definitions (Art's meeting, 26 Nov 2026):
//   booked     a free call in the range that wasn't cancelled (by call date)
//   upcoming   booked, but the call hasn't happened yet
//   no-show    a past call labelled "No Show" in Acuity
//   attended   a past call without that label
//   existing   the person had a paid session (therapy, paid intro or
//              assessment) before the call; new otherwise
//   converted  an attended call where the person booked a paid session
//              after the call, within the conversion window (14/30/60 days)
//   conversion converted ÷ attended (the same as bookings ÷ (calls − no-shows))
// People are matched to their sessions by email (else phone), as everywhere
// else on the Overview.

import { DAY_MS, addDays } from "../admin-customer-insights/logic.ts";
import { NO_SHOW_LABEL } from "../admin-leads/logic.ts";
import {
  type Comparison,
  type CustomerHistory,
  type DateRange,
  CONVERSION_WINDOWS,
  DEFAULT_CONVERSION_WINDOW,
  MAX_RANGE_DAYS,
  WEEKLY_MAX_DAYS,
  daysInRange,
  dublinDate,
  isDate,
  parseComparison,
  periodEnd,
  periodStart,
} from "./logic.ts";

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const FREE_CALL_TYPES = ["lets_talk", "intro_chat"] as const;
export type FreeCallType = (typeof FREE_CALL_TYPES)[number];

const LETS_TALK = /let.?s talk/i;
const INTRO_CHAT = /introduction chat/i;

/** Which free call an Acuity type name is, or null when it isn't one. */
export function freeCallType(type: string | null | undefined): FreeCallType | null {
  const name = type ?? "";
  if (LETS_TALK.test(name)) return "lets_talk";
  if (INTRO_CHAT.test(name)) return "intro_chat";
  return null;
}

/** One free call from admin_analytics_consultations(). */
export interface ConsultationRow {
  id: number;
  customerKey: string;
  /** When the call takes place (ms). */
  at: number;
  canceled: boolean;
  type: FreeCallType;
  calendarId: number | null;
  calendar: string | null;
  noShow: boolean;
}

/** Reads admin_analytics_consultations()'s compact rows, skipping malformed ones. */
export function parseConsultationRows(raw: unknown): ConsultationRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: ConsultationRow[] = [];
  for (const item of raw) {
    if (!Array.isArray(item)) continue;
    const [id, customerKey, at, , canceled, typeName, calendarId, calendar, labels] = item;
    if (typeof id !== "number" || typeof customerKey !== "string" || typeof at !== "number") continue;
    const type = freeCallType(typeof typeName === "string" ? typeName : null);
    if (!type) continue;
    rows.push({
      id,
      customerKey,
      at,
      canceled: canceled === true,
      type,
      calendarId: typeof calendarId === "number" ? calendarId : null,
      calendar: typeof calendar === "string" && calendar.trim() ? calendar.trim() : null,
      noShow:
        Array.isArray(labels) && labels.some((name) => typeof name === "string" && NO_SHOW_LABEL.test(name.trim())),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// One call
// ---------------------------------------------------------------------------

export type CallStatus = "upcoming" | "no_show" | "attended";

export interface CallOutcome {
  call: ConsultationRow;
  /** Dublin date of the call. */
  date: string;
  status: CallStatus;
  existing: boolean;
  converted: boolean;
  /** Attended, not converted (yet), and the window hasn't closed. */
  maturing: boolean;
}

export function callOutcome(
  call: ConsultationRow,
  history: CustomerHistory | undefined,
  now: number,
  windowDays: number
): CallOutcome {
  const status: CallStatus = call.at > now ? "upcoming" : call.noShow ? "no_show" : "attended";
  const sessions = history?.sessions ?? [];
  const existing = sessions.some((s) => s.at < call.at);
  const windowEnd = call.at + windowDays * DAY_MS;
  // Booked after the call and within the window. Rows copied before Acuity
  // sent a booking time fall back to when the session takes place.
  const converted =
    status === "attended" &&
    sessions.some((s) => {
      const bookedAt = s.createdAt ?? s.at;
      return bookedAt > call.at && bookedAt <= windowEnd;
    });
  return {
    call,
    date: dublinDate(call.at),
    status,
    existing,
    converted,
    maturing: status === "attended" && !converted && windowEnd > now,
  };
}

// ---------------------------------------------------------------------------
// Totals, series and calendars
// ---------------------------------------------------------------------------

export interface CallCounts {
  booked: number;
  upcoming: number;
  noShows: number;
  attended: number;
  converted: number;
  /** converted ÷ attended; null with nothing attended. */
  conversionRate: number | null;
  /** no-shows ÷ past calls; null with no past calls. */
  noShowRate: number | null;
}

export interface ConsultationTotals extends CallCounts {
  /** Different people among the booked calls. */
  people: number;
  newCalls: number;
  existingCalls: number;
  /** Attended calls whose conversion window is still open. */
  maturing: number;
  segments: { new: CallCounts; existing: CallCounts };
  byType: { type: FreeCallType; booked: number }[];
}

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

function countCalls(outcomes: CallOutcome[]): CallCounts {
  let upcoming = 0;
  let noShows = 0;
  let attended = 0;
  let converted = 0;
  for (const o of outcomes) {
    if (o.status === "upcoming") upcoming++;
    else if (o.status === "no_show") noShows++;
    else attended++;
    if (o.converted) converted++;
  }
  return {
    booked: outcomes.length,
    upcoming,
    noShows,
    attended,
    converted,
    conversionRate: rate(converted, attended),
    noShowRate: rate(noShows, noShows + attended),
  };
}

export function consultationTotals(outcomes: CallOutcome[]): ConsultationTotals {
  const fresh = outcomes.filter((o) => !o.existing);
  const returning = outcomes.filter((o) => o.existing);
  return {
    ...countCalls(outcomes),
    people: new Set(outcomes.map((o) => o.call.customerKey)).size,
    newCalls: fresh.length,
    existingCalls: returning.length,
    maturing: outcomes.filter((o) => o.maturing).length,
    segments: { new: countCalls(fresh), existing: countCalls(returning) },
    byType: FREE_CALL_TYPES.map((type) => ({ type, booked: outcomes.filter((o) => o.call.type === type).length })),
  };
}

export type ConsultationGroupBy = "day" | "week" | "month";
/** Ranges up to this many days are shown per day by default. */
export const CONSULTATION_DAILY_MAX_DAYS = 31;
/** Longest range that can be shown per day. */
export const CONSULTATION_DAY_LIMIT_DAYS = WEEKLY_MAX_DAYS;

export function defaultConsultationGroupBy(range: DateRange): ConsultationGroupBy {
  const days = daysInRange(range);
  if (days <= CONSULTATION_DAILY_MAX_DAYS) return "day";
  return days <= WEEKLY_MAX_DAYS ? "week" : "month";
}

export interface ConsultationPoint extends CallCounts {
  /** Start of the day, week or month. */
  key: string;
  /** The part of it inside the range. */
  from: string;
  to: string;
  newCalls: number;
  existingCalls: number;
}

const startOf = (date: string, groupBy: ConsultationGroupBy) => (groupBy === "day" ? date : periodStart(date, groupBy));
const endOf = (key: string, groupBy: ConsultationGroupBy) => (groupBy === "day" ? key : periodEnd(key, groupBy));

/** One point per day, week or month in the range, empty ones included. */
export function consultationSeries(
  outcomes: CallOutcome[],
  range: DateRange,
  groupBy: ConsultationGroupBy
): ConsultationPoint[] {
  const byKey = new Map<string, CallOutcome[]>();
  for (const o of outcomes) {
    const key = startOf(o.date, groupBy);
    const list = byKey.get(key);
    if (list) list.push(o);
    else byKey.set(key, [o]);
  }
  const points: ConsultationPoint[] = [];
  for (let key = startOf(range.from, groupBy); key <= range.to; key = addDays(endOf(key, groupBy), 1)) {
    const end = endOf(key, groupBy);
    const list = byKey.get(key) ?? [];
    points.push({
      key,
      from: key < range.from ? range.from : key,
      to: end > range.to ? range.to : end,
      ...countCalls(list),
      newCalls: list.filter((o) => !o.existing).length,
      existingCalls: list.filter((o) => o.existing).length,
    });
  }
  return points;
}

export interface CalendarCounts extends CallCounts {
  calendarId: number | null;
  calendar: string;
}

/** Calls per calendar (who took them), busiest first. */
export function consultationsByCalendar(outcomes: CallOutcome[]): CalendarCounts[] {
  const groups = new Map<string, { id: number | null; name: string; list: CallOutcome[] }>();
  for (const o of outcomes) {
    const groupKey = o.call.calendarId === null ? `name:${o.call.calendar ?? ""}` : `id:${o.call.calendarId}`;
    const group = groups.get(groupKey);
    // Rows are oldest first, so the latest name wins.
    const name = o.call.calendar ?? group?.name ?? "Unknown calendar";
    if (group) {
      group.list.push(o);
      group.name = name;
    } else {
      groups.set(groupKey, { id: o.call.calendarId, name, list: [o] });
    }
  }
  return [...groups.values()]
    .map((g) => ({ calendarId: g.id, calendar: g.name, ...countCalls(g.list) }))
    .sort((a, b) => b.booked - a.booked || a.calendar.localeCompare(b.calendar));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** The non-cancelled calls in a range, with what happened. */
export function outcomesIn(
  calls: ConsultationRow[],
  histories: Map<string, CustomerHistory>,
  range: DateRange,
  now: number,
  windowDays: number
): CallOutcome[] {
  const outcomes: CallOutcome[] = [];
  for (const call of calls) {
    if (call.canceled) continue;
    const date = dublinDate(call.at);
    if (date < range.from || date > range.to) continue;
    outcomes.push(callOutcome(call, histories.get(call.customerKey), now, windowDays));
  }
  return outcomes;
}

export interface ConsultationReport {
  totals: ConsultationTotals;
  compare: ConsultationTotals;
  series: ConsultationPoint[];
  byCalendar: CalendarCounts[];
}

export function consultationReport(input: {
  calls: ConsultationRow[];
  histories: CustomerHistory[];
  params: ConsultationParams;
  now: number;
}): ConsultationReport {
  const { calls, params, now } = input;
  const histories = new Map(input.histories.map((h) => [h.key, h]));
  const current = outcomesIn(calls, histories, params.range, now, params.windowDays);
  const previous = outcomesIn(calls, histories, params.compareRange, now, params.windowDays);
  return {
    totals: consultationTotals(current),
    compare: consultationTotals(previous),
    series: consultationSeries(current, params.range, params.groupBy),
    byCalendar: consultationsByCalendar(current),
  };
}

// ---------------------------------------------------------------------------
// Query string
// ---------------------------------------------------------------------------

export interface ConsultationParams extends Comparison {
  range: DateRange;
  groupBy: ConsultationGroupBy;
  windowDays: number;
}

/** Reads and checks ?action=consultations's query string. Returns an error message when invalid. */
export function parseConsultationParams(search: URLSearchParams): ConsultationParams | string {
  const from = search.get("from");
  const to = search.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return "from and to must be dates, from first";
  const range = { from, to };
  if (daysInRange(range) > MAX_RANGE_DAYS) return "The date range can be at most three years";
  const groupBy = search.get("group") ?? defaultConsultationGroupBy(range);
  if (groupBy !== "day" && groupBy !== "week" && groupBy !== "month") return "group must be day, week or month";
  if (groupBy === "day" && daysInRange(range) > CONSULTATION_DAY_LIMIT_DAYS) {
    return `Ranges over ${CONSULTATION_DAY_LIMIT_DAYS} days can't be shown per day`;
  }
  const windowDays = Number(search.get("window") ?? DEFAULT_CONVERSION_WINDOW);
  if (!(CONVERSION_WINDOWS as readonly number[]).includes(windowDays)) return "window must be 14, 30 or 60";
  const comparison = parseComparison(search, range);
  if (typeof comparison === "string") return comparison;
  return { range, groupBy, windowDays, ...comparison };
}
