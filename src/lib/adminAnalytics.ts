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
  periodEnd,
} from "../../supabase/functions/admin-analytics/logic.ts";
import {
  COMPARE_PRESETS,
  type ComparePresetId,
  type DatePresetId,
  clampToMin,
  compareRange as comparePresetRange,
  presetRange as presetDays,
} from "./datePresets";

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
// Date presets (the shared admin date picker's, from TRACKING_START)
// ---------------------------------------------------------------------------

/** The presets the Overview's picker offers, in the picker's order. */
export const OVERVIEW_PRESETS: readonly DatePresetId[] = [
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "last7",
  "last14",
  "last28",
  "last30",
  "thisMonth",
  "lastMonth",
  "last90",
  "last3Months",
  "quarterToDate",
  "thisYear",
  "last12Months",
  "lastYear",
];

export const DEFAULT_PRESET: DatePresetId = "last3Months";

/** Preset ids from links made before the shared picker. */
const LEGACY_PRESETS: Record<string, DatePresetId> = { thisQuarter: "quarterToDate" };

/** Dublin date for "today". */
export function todayInDublin(now = Date.now()): string {
  return dublinDate(now);
}

/** Moves a range's start up to TRACKING_START, the earliest the boards show. */
export function fromTrackingStart(range: DateRange): DateRange {
  if (range.from >= TRACKING_START) return range;
  return { from: TRACKING_START, to: range.to < TRACKING_START ? TRACKING_START : range.to };
}

/** The dates a preset covers, up to today and from TRACKING_START. Null for
 *  "custom", and for a preset wholly before TRACKING_START. */
export function presetRange(preset: DatePresetId, today: string): DateRange | null {
  const range = presetDays(preset, today);
  return range && clampToMin(range, TRACKING_START);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** The period figures are compared with; null when compare is switched off. */
export type BoardComparison = { preset: ComparePresetId; range: DateRange } | null;

export const DEFAULT_COMPARE_PRESET: ComparePresetId = "previous";

/** The comparison for a preset, or null for "custom" (which brings its own dates). */
export function comparisonFor(preset: ComparePresetId, range: DateRange): BoardComparison {
  const dates = comparePresetRange(range, preset);
  return dates ? { preset, range: dates } : null;
}

/** compare / cfrom / cto for admin-analytics. previous and year are worked
 *  out there, so those keep working with an older deployment too. */
export function comparisonQuery(compare: BoardComparison): Record<string, string> {
  if (!compare || compare.preset === "previous") return { compare: "previous" };
  if (compare.preset === "previousYear") return { compare: "year" };
  return { compare: "custom", cfrom: compare.range.from, cto: compare.range.to };
}

/** "previous period", "same period last year", "1 Sep – 30 Sep 2026"… for
 *  the "+5 vs …" lines. Null when compare is off. */
export function comparisonLabel(compare: BoardComparison): string | null {
  if (!compare) return null;
  switch (compare.preset) {
    case "previous":
      return "previous period";
    case "previousWeekday":
      return "previous period (same weekdays)";
    case "previousYear":
      return "same period last year";
    case "previousYearWeekday":
      return "last year (same weekdays)";
    case "custom":
      return formatRange(compare.range);
  }
}

// ---------------------------------------------------------------------------
// Board settings, kept in the URL so a view can be shared with a link
// ---------------------------------------------------------------------------

export const BOARDS = [
  { id: "progression", label: "Progression" },
  { id: "customers", label: "Customers" },
  { id: "consultations", label: "Free consultations" },
  { id: "funnel", label: "Booking funnel" },
  { id: "marketing", label: "Marketing" },
] as const;

export type Board = (typeof BOARDS)[number]["id"];

export interface BoardSettings {
  /** The tab on show. */
  board: Board;
  preset: DatePresetId;
  range: DateRange;
  groupBy: GroupBy;
  /** True when the grouping was picked rather than defaulted from the range. */
  groupByChosen: boolean;
  compare: BoardComparison;
  windowDays: number;
  basis: Basis;
  returning: ReturningMode;
  filters: SessionFilters;
}

const isOverviewPreset = (value: string | null): value is DatePresetId =>
  value === "custom" || OVERVIEW_PRESETS.includes(value as DatePresetId);

/** A from/to pair from the URL, if valid. */
function customRange(from: string | null, to: string | null): DateRange | null {
  if (!isDate(from) || !isDate(to) || from > to) return null;
  return daysInRange({ from, to }) <= MAX_RANGE_DAYS ? { from, to } : null;
}

// compare in the URL: left out = previous period; "off"; "year" (same period
// last year, as in older links); another picker preset id; or "custom" with
// cfrom / cto.
function readComparison(search: URLSearchParams, range: DateRange): BoardComparison {
  const value = search.get("compare");
  if (value === "off") return null;
  if (value === "year") return comparisonFor("previousYear", range);
  if (value === "custom") {
    const dates = customRange(search.get("cfrom"), search.get("cto"));
    if (dates) return { preset: "custom", range: dates };
  }
  const preset = COMPARE_PRESETS.find((option) => option.id === value && option.id !== "custom");
  return comparisonFor(preset?.id ?? DEFAULT_COMPARE_PRESET, range);
}

/** Reads the settings from the URL, falling back to defaults for anything missing or invalid. */
export function readBoardSettings(search: URLSearchParams, today: string): BoardSettings {
  const requested = search.get("range");
  const asked = requested !== null && LEGACY_PRESETS[requested] ? LEGACY_PRESETS[requested] : requested;
  let preset: DatePresetId = isOverviewPreset(asked) ? asked : DEFAULT_PRESET;
  let range: DateRange | null = null;
  if (preset === "custom") {
    const custom = customRange(search.get("from"), search.get("to"));
    if (custom) range = fromTrackingStart(custom);
  } else {
    range = presetRange(preset, today);
  }
  if (!range) {
    preset = DEFAULT_PRESET;
    range = presetRange(DEFAULT_PRESET, today)!;
  }

  const board = search.get("board");
  const group = search.get("group");
  const groupByChosen = group === "week" || group === "month";
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
    compare: readComparison(search, range),
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
  const { compare } = settings;
  if (!compare) search.set("compare", "off");
  else if (compare.preset === "previousYear") search.set("compare", "year");
  else if (compare.preset !== DEFAULT_COMPARE_PRESET) search.set("compare", compare.preset);
  if (compare?.preset === "custom") {
    search.set("cfrom", compare.range.from);
    search.set("cto", compare.range.to);
  }
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
    ...comparisonQuery(settings.compare),
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

/** "+5 (+12%) vs previous period", or null with no comparison. */
export function countChangeHint(current: number, previous: number | null | undefined, label: string | null): string | null {
  return previous === null || previous === undefined || !label ? null : `${formatCountChange(current, previous)} vs ${label}`;
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
