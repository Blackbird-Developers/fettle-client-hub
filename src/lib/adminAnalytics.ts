// Front-end helpers for the admin Overview analytics boards: date presets,
// the board settings kept in the URL, formatting, and CSV export. The numbers
// themselves come from the admin-analytics edge function; its definitions and
// date rules live in supabase/functions/admin-analytics/logic.ts.

import {
  type Basis,
  type CompareTo,
  type CustomerPoint,
  type CustomerSegment,
  type CalendarOption,
  type CustomerTotals,
  type DateRange,
  type GroupBy,
  type Period,
  type ProgressionPoint,
  type ProgressionTotals,
  type ReturningMode,
  type SessionCategory,
  type SessionFilters,
  type Stage,
  CONVERSION_WINDOWS,
  DEFAULT_CONVERSION_WINDOW,
  MAX_RANGE_DAYS,
  SESSION_CATEGORIES,
  TRACKING_START,
  daysInRange,
  defaultGroupBy,
  dublinDate,
  isDate,
  monthStart,
  periodEnd,
} from "../../supabase/functions/admin-analytics/logic.ts";
import { addDays } from "../../supabase/functions/admin-customer-insights/logic.ts";

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface AnalyticsResponse {
  generatedAt: string;
  data: {
    lastRefreshedAt: string;
    historyComplete: boolean;
    historyFrom: string | null;
    pendingBookedByChecks: number;
    /** For the calendar filter. */
    calendars: CalendarOption[];
  };
  params: {
    range: DateRange;
    compareRange: DateRange;
    groupBy: GroupBy;
    compareTo: CompareTo;
    windowDays: number;
    basis: Basis;
    /** Missing from admin-analytics deployed before the switch was added;
     *  the board hides the switch until it's there. */
    returning?: ReturningMode;
    filters: SessionFilters;
    returningMinGapDays: number;
  };
  progression: { totals: ProgressionTotals; compare: ProgressionTotals; series: ProgressionPoint[] };
  customers: { totals: CustomerTotals; compare: CustomerTotals; series: CustomerPoint[] };
}

export interface AnalyticsCustomer {
  customerKey: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  firstSessionAt: string;
  sessionAt: string | null;
  sessionType: string | null;
  bookedBy: string | null;
  portalAccount: boolean | null;
  progressionFrom: Stage | null;
}

export interface AnalyticsCustomersResponse {
  generatedAt: string;
  segment: CustomerSegment;
  range: DateRange;
  customers: AnalyticsCustomer[];
}

// ---------------------------------------------------------------------------
// Date presets
// ---------------------------------------------------------------------------

export const RANGE_PRESETS = [
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last3Months", label: "Last 3 months" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "thisQuarter", label: "This quarter" },
  { id: "thisYear", label: "This year" },
  { id: "last12Months", label: "Last 12 months" },
  { id: "custom", label: "Custom range" },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]["id"];

export const DEFAULT_PRESET: RangePreset = "last3Months";

/** Dublin date for "today". */
export function todayInDublin(now = Date.now()): string {
  return dublinDate(now);
}

function quarterStart(date: string): string {
  const month = Number(date.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  return `${date.slice(0, 4)}-${String(first).padStart(2, "0")}-01`;
}

/** The same day `months` earlier; the 31st becomes the month's last day. */
function monthsBefore(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.toISOString().slice(0, 8)}${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/** Moves a range's start up to TRACKING_START, the earliest the boards show. */
export function fromTrackingStart(range: DateRange): DateRange {
  if (range.from >= TRACKING_START) return range;
  return { from: TRACKING_START, to: range.to < TRACKING_START ? TRACKING_START : range.to };
}

/** The dates a preset covers, up to today and from TRACKING_START. Null for "custom". */
export function presetRange(preset: RangePreset, today: string): DateRange | null {
  const range = presetDates(preset, today);
  return range && fromTrackingStart(range);
}

function presetDates(preset: RangePreset, today: string): DateRange | null {
  switch (preset) {
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "last3Months":
      return { from: monthsBefore(today, 3), to: today };
    case "thisMonth":
      return { from: monthStart(today), to: today };
    case "lastMonth": {
      const end = addDays(monthStart(today), -1);
      return { from: monthStart(end), to: end };
    }
    case "thisQuarter":
      return { from: quarterStart(today), to: today };
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "last12Months":
      return { from: addDays(today, -364), to: today };
    case "custom":
      return null;
  }
}

// ---------------------------------------------------------------------------
// Board settings, kept in the URL so a view can be shared with a link
// ---------------------------------------------------------------------------

export const BOARDS = [
  { id: "progression", label: "Progression" },
  { id: "customers", label: "Customers" },
] as const;

export type Board = (typeof BOARDS)[number]["id"];

export interface BoardSettings {
  /** The tab on show. */
  board: Board;
  preset: RangePreset;
  range: DateRange;
  groupBy: GroupBy;
  /** True when the grouping was picked rather than defaulted from the range. */
  groupByChosen: boolean;
  compareTo: CompareTo;
  windowDays: number;
  basis: Basis;
  returning: ReturningMode;
  filters: SessionFilters;
}

const isPreset = (value: string | null): value is RangePreset =>
  RANGE_PRESETS.some((preset) => preset.id === value);

/** Reads the settings from the URL, falling back to defaults for anything missing or invalid. */
export function readBoardSettings(search: URLSearchParams, today: string): BoardSettings {
  const requested = search.get("range");
  let preset: RangePreset = isPreset(requested) ? requested : DEFAULT_PRESET;
  let range = presetRange(preset, today);
  if (preset === "custom") {
    const from = search.get("from");
    const to = search.get("to");
    const custom = isDate(from) && isDate(to) && from <= to ? fromTrackingStart({ from, to }) : null;
    if (custom && daysInRange(custom) <= MAX_RANGE_DAYS) range = custom;
    else preset = DEFAULT_PRESET;
  }
  range ??= presetRange(DEFAULT_PRESET, today)!;

  const board = search.get("board");
  const group = search.get("group");
  const groupByChosen = group === "week" || group === "month";
  const compare = search.get("compare");
  const window = Number(search.get("window"));
  const basis = search.get("basis");
  const category = search.get("type");
  const calendar = search.get("calendar") ?? "";

  return {
    board: BOARDS.some((b) => b.id === board) ? (board as Board) : "progression",
    preset,
    range,
    groupBy: groupByChosen ? (group as GroupBy) : defaultGroupBy(range),
    groupByChosen,
    compareTo: compare === "year" ? "year" : "previous",
    windowDays: (CONVERSION_WINDOWS as readonly number[]).includes(window) ? window : DEFAULT_CONVERSION_WINDOW,
    basis: basis === "booking" ? "booking" : "session",
    returning: search.get("returning") === "lapsed" ? "lapsed" : "all",
    filters: {
      category: (SESSION_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as SessionCategory) : null,
      calendarId: /^\d+$/.test(calendar) ? Number(calendar) : null,
    },
  };
}

function setFilters(search: URLSearchParams, filters: SessionFilters) {
  if (filters.category !== null) search.set("type", filters.category);
  if (filters.calendarId !== null) search.set("calendar", String(filters.calendarId));
}

/** The URL query for the settings, leaving out defaults. */
export function boardSettingsToSearch(settings: BoardSettings): URLSearchParams {
  const search = new URLSearchParams();
  if (settings.board !== "progression") search.set("board", settings.board);
  if (settings.preset !== DEFAULT_PRESET) search.set("range", settings.preset);
  if (settings.preset === "custom") {
    search.set("from", settings.range.from);
    search.set("to", settings.range.to);
  }
  if (settings.groupByChosen) search.set("group", settings.groupBy);
  if (settings.compareTo !== "previous") search.set("compare", settings.compareTo);
  if (settings.windowDays !== DEFAULT_CONVERSION_WINDOW) search.set("window", String(settings.windowDays));
  if (settings.basis !== "session") search.set("basis", settings.basis);
  if (settings.returning !== "all") search.set("returning", settings.returning);
  setFilters(search, settings.filters);
  return search;
}

/** The admin-analytics query for the settings. */
export function analyticsQuery(settings: BoardSettings): string {
  const search = new URLSearchParams({
    from: settings.range.from,
    to: settings.range.to,
    group: settings.groupBy,
    compare: settings.compareTo,
    window: String(settings.windowDays),
    basis: settings.basis,
  });
  if (settings.returning !== "all") search.set("returning", settings.returning);
  setFilters(search, settings.filters);
  return search.toString();
}

/** The admin-analytics query for one Customers board list. */
export function customersQuery(
  segment: CustomerSegment,
  range: DateRange,
  basis: Basis,
  filters: SessionFilters,
  returning: ReturningMode = "all"
): string {
  const search = new URLSearchParams({ action: "customers", segment, from: range.from, to: range.to, basis });
  if (returning !== "all") search.set("returning", returning);
  setFilters(search, filters);
  return search.toString();
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const UTC_DATE = (date: string) => new Date(`${date}T00:00:00Z`);

/** "6 Oct" */
export function formatDay(date: string): string {
  return UTC_DATE(date).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "6 Oct 2026" */
export function formatFullDay(date: string): string {
  return UTC_DATE(date).toLocaleDateString("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "6 Oct – 3 Nov 2026" */
export function formatRange(range: DateRange): string {
  return range.from === range.to ? formatFullDay(range.from) : `${formatDay(range.from)} – ${formatFullDay(range.to)}`;
}

/** Axis label for a week ("6 Oct") or month ("Oct 26"). */
export function formatPeriod(key: string, groupBy: GroupBy): string {
  if (groupBy === "week") return formatDay(key);
  return UTC_DATE(key).toLocaleDateString("en-IE", { month: "short", year: "2-digit", timeZone: "UTC" });
}

/** Tooltip title for a period ("Week of 6 Oct 2026", "October 2026"). */
export function describePeriod(key: string, groupBy: GroupBy): string {
  if (groupBy === "week") return `Week of ${formatFullDay(key)}`;
  return UTC_DATE(key).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "68%", or "–" when there's nothing to divide. */
export function formatRate(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

/** Percentage-point change, "+4.2 pts". Null when either side is missing. */
export function pointsChange(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return Math.round((current - previous) * 1000) / 10;
}

export function formatPoints(points: number): string {
  return `${points > 0 ? "+" : points < 0 ? "−" : "±"}${Math.abs(points).toFixed(1)} pts`;
}

/** Count change, "+5 (+12%)". */
export function formatCountChange(current: number, previous: number): string {
  const diff = current - previous;
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "±";
  const percent = previous > 0 ? ` (${sign}${Math.abs(Math.round((diff / previous) * 100))}%)` : "";
  return `${sign}${Math.abs(diff)}${percent}`;
}

export const CATEGORY_LABELS: Record<SessionCategory, string> = {
  individual: "Individual",
  couples: "Couples",
  youth: "Youth",
  assessment: "Assessment",
};

/** "Couples · Jane Topkin", or null with no filters on. */
export function describeFilters(filters: SessionFilters, calendars: CalendarOption[]): string | null {
  const parts: string[] = [];
  if (filters.category !== null) parts.push(CATEGORY_LABELS[filters.category]);
  if (filters.calendarId !== null) {
    parts.push(calendars.find((c) => c.id === filters.calendarId)?.name ?? `Calendar ${filters.calendarId}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function stageLabel(stage: Stage): string {
  return `${stage}→${stage + 1}`;
}

// ---------------------------------------------------------------------------
// Chart rows
// ---------------------------------------------------------------------------

export type StageKey = "s1" | "s2" | "s3" | "s4";

/** True when only part of the week or month is inside the range, as with the
 *  first week of a range that starts on a Saturday. */
export function isPartialPeriod(period: Period, groupBy: GroupBy): boolean {
  return period.from !== period.key || period.to !== periodEnd(period.key, groupBy);
}

/** "Only 1 Aug – 2 Aug 2026 is in the range" */
export function describePartialPeriod(period: Period): string {
  return `Only ${formatRange(period)} is in the range`;
}

/** Points a dashed line runs through: the faded ones plus their solid
 *  neighbours, so it joins on to the solid line. */
export function dashedPoints(faded: boolean[]): boolean[] {
  return faded.map((isFaded, i) => isFaded || faded[i - 1] === true || faded[i + 1] === true);
}

export interface ProgressionChartRow {
  point: ProgressionPoint;
  label: string;
  partial: boolean;
  /** Rates in % per stage: `s1` on final, whole periods (solid line);
   *  `s1Maturing` on maturing or partial ones plus their neighbours, so the
   *  dashed line joins on. */
  [series: string]: unknown;
}

export function progressionChartRows(series: ProgressionPoint[], groupBy: GroupBy): ProgressionChartRow[] {
  const partial = series.map((point) => isPartialPeriod(point.period, groupBy));
  const faded = series.map((point, i) => !point.final || partial[i]);
  const dashed = dashedPoints(faded);
  return series.map((point, index) => {
    const row: ProgressionChartRow = {
      point,
      label: formatPeriod(point.period.key, groupBy),
      partial: partial[index],
    };
    for (const stage of point.stages) {
      const value = stage.rate === null ? null : Math.round(stage.rate * 1000) / 10;
      row[`s${stage.stage}`] = faded[index] ? null : value;
      row[`s${stage.stage}Maturing`] = dashed[index] ? value : null;
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// Customer lists
// ---------------------------------------------------------------------------

export const SEGMENT_LABELS: Record<CustomerSegment, string> = {
  active: "Total active customers",
  new: "New customers",
  new_self: "New self-booked customers",
  new_staff: "New customers booked by the team",
  new_unknown: "New customers (who booked not checked yet)",
  returning: "Returning customers",
};

/** The Progression page that lists this customer, searched for them. */
export function customerHref(customer: AnalyticsCustomer): string | null {
  if (customer.progressionFrom === null) return null;
  const query = customer.email ?? customer.phone ?? customer.name;
  const page = `/admin/progression/${customer.progressionFrom}-${customer.progressionFrom + 1}`;
  return query ? `${page}?q=${encodeURIComponent(query)}` : page;
}

// Cells that start with these could run as formulas when the CSV is opened in
// a spreadsheet; a leading apostrophe keeps them as text.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The list as CSV, with dates as Dublin dates. */
export function customersCsv(customers: AnalyticsCustomer[]): string {
  const header = ["Name", "Email", "Phone", "First session", "Session in range", "Session type", "Booked by", "Hub account"];
  const date = (iso: string | null) => (iso ? dublinDate(Date.parse(iso)) : null);
  const rows = customers.map((c) => [
    c.name,
    c.email,
    c.phone,
    date(c.firstSessionAt),
    date(c.sessionAt),
    c.sessionType,
    c.bookedBy ?? "Not checked yet",
    c.portalAccount === null ? "No email" : c.portalAccount ? "Yes" : "No",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
