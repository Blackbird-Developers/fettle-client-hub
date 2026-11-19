// Date ranges for the shared admin date picker (DateRangePicker).
// Days are "yyyy-MM-dd" strings in the hub's local calendar; ranges include
// both ends. Weeks start on Monday, like the rest of the hub.

export interface DayRange {
  from: string;
  to: string;
}

export const DATE_PRESETS = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "thisWeek", label: "This week (Mon – today)" },
  { id: "lastWeek", label: "Last week (Mon – Sun)" },
  { id: "last7", label: "Last 7 days" },
  { id: "last14", label: "Last 14 days" },
  { id: "last28", label: "Last 28 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "last90", label: "Last 90 days" },
  { id: "quarterToDate", label: "Quarter to date" },
  { id: "thisYear", label: "This year (Jan – today)" },
  { id: "lastYear", label: "Last calendar year" },
] as const;

export type DatePresetId = (typeof DATE_PRESETS)[number]["id"] | "custom";

export const COMPARE_PRESETS = [
  { id: "previousWeekday", label: "Previous period (match day of week)" },
  { id: "previous", label: "Previous period" },
  { id: "previousYear", label: "Same period last year" },
  { id: "previousYearWeekday", label: "Previous year (match day of week)" },
  { id: "custom", label: "Custom" },
] as const;

export type ComparePresetId = (typeof COMPARE_PRESETS)[number]["id"];

// ---------------------------------------------------------------------------
// Day arithmetic (UTC, so daylight saving never shifts a day)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const toUtc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isDay = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;

export const addDays = (day: string, days: number) => fromUtc(toUtc(day) + days * DAY_MS);

/** Number of days in a range, counting both ends. */
export const rangeLength = (range: DayRange) => Math.round((toUtc(range.to) - toUtc(range.from)) / DAY_MS) + 1;

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

/** Monday of the day's week. */
function weekStart(day: string): string {
  const weekday = new Date(toUtc(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

function quarterStart(day: string): string {
  const month = Number(day.slice(5, 7));
  const first = Math.floor((month - 1) / 3) * 3 + 1;
  return `${day.slice(0, 4)}-${String(first).padStart(2, "0")}-01`;
}

function shiftYears(day: string, years: number): string {
  const year = Number(day.slice(0, 4)) + years;
  const month = Number(day.slice(5, 7));
  // 29 February becomes 28 February in a year without one.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${day.slice(5, 7)}-${String(Math.min(Number(day.slice(8, 10)), lastDay)).padStart(2, "0")}`;
}

/** Puts two days in order as a range. */
export const orderedRange = (a: string, b: string): DayRange => (a <= b ? { from: a, to: b } : { from: b, to: a });

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/** The days a preset covers, ending today at the latest. Null for "custom". */
export function presetRange(preset: DatePresetId, today: string): DayRange | null {
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case "thisWeek":
      return { from: weekStart(today), to: today };
    case "lastWeek": {
      const from = addDays(weekStart(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "last14":
      return { from: addDays(today, -13), to: today };
    case "last28":
      return { from: addDays(today, -27), to: today };
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "last90":
      return { from: addDays(today, -89), to: today };
    case "thisMonth":
      return { from: monthStart(today), to: today };
    case "lastMonth": {
      const to = addDays(monthStart(today), -1);
      return { from: monthStart(to), to };
    }
    case "quarterToDate":
      return { from: quarterStart(today), to: today };
    case "thisYear":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case "lastYear": {
      const year = Number(today.slice(0, 4)) - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case "custom":
      return null;
  }
}

/** The preset a range matches, out of the ones offered, or "custom". */
export function matchingPreset(range: DayRange, today: string, offered: readonly DatePresetId[]): DatePresetId {
  return (
    offered.find((preset) => {
      const dates = presetRange(preset, today);
      return dates?.from === range.from && dates.to === range.to;
    }) ?? "custom"
  );
}

/** The period a range is compared against. Null for "custom". */
export function compareRange(range: DayRange, preset: ComparePresetId): DayRange | null {
  switch (preset) {
    case "previousWeekday": {
      // Move back a whole number of weeks so both boundaries keep their
      // weekday. A 31-day range moves 28 days, matching the reference picker.
      const weeks = Math.max(1, Math.floor(rangeLength(range) / 7));
      return { from: addDays(range.from, -weeks * 7), to: addDays(range.to, -weeks * 7) };
    }
    case "previous": {
      // The same number of days, ending the day before the range starts.
      const to = addDays(range.from, -1);
      return { from: addDays(to, -(rangeLength(range) - 1)), to };
    }
    case "previousYear":
      return { from: shiftYears(range.from, -1), to: shiftYears(range.to, -1) };
    case "previousYearWeekday":
      // 52 weeks preserves weekdays and is the common year-on-year reporting
      // comparison (calendar-year comparison above preserves month/day).
      return { from: addDays(range.from, -364), to: addDays(range.to, -364) };
    case "custom":
      return null;
  }
}

/** True when the whole range sits inside min–max (either may be unset). */
export function rangeWithin(range: DayRange, min?: string, max?: string): boolean {
  return (!min || range.from >= min) && (!max || range.to <= max);
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Oct 2026", or "3 Oct" without the year. */
export function formatDay(day: string, withYear = true): string {
  const label = `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
  return withYear ? `${label} ${day.slice(0, 4)}` : label;
}

/** "1 Oct – 30 Oct 2026"; a one-day range is just that day. */
export function formatDayRange(range: DayRange): string {
  if (range.from === range.to) return formatDay(range.from);
  return `${formatDay(range.from, range.from.slice(0, 4) !== range.to.slice(0, 4))} – ${formatDay(range.to)}`;
}
