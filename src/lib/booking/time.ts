// Irish-time helpers for the booking wizard (docs/QUIZ_BOOKING_FLOW.md §3.2,
// §5). Everything is shown, grouped and filtered in Europe/Dublin, whatever
// the browser's timezone. Days are "yyyy-MM-dd" keys; times are Acuity ISO
// strings such as "2026-10-28T17:00:00+0000".

export const DUBLIN_TZ = 'Europe/Dublin';

export type PartOfDay = 'morning' | 'afternoon' | 'evening';
export type TimeOfDayFilter = 'any' | PartOfDay;

/** A day with its open times, as the wizard keeps availability. */
export interface AvailableDay {
  date: string;
  times: string[];
}

/** Parses Acuity times, whose offset has no colon ("+0100"). */
export function parseSlotTime(iso: string): Date {
  return new Date(String(iso).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
}

const keyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: DUBLIN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: DUBLIN_TZ, hour: '2-digit', hourCycle: 'h23' });

const clockFormat = new Intl.DateTimeFormat('en-IE', {
  timeZone: DUBLIN_TZ,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** The Dublin calendar day of an instant, e.g. "2026-10-28". */
export function dublinDateKey(date: Date): string {
  return keyFormat.format(date);
}

/** Dublin calendar day of an Acuity time. */
export function slotDateKey(iso: string): string {
  return dublinDateKey(parseSlotTime(iso));
}

/** Hour 0–23 in Dublin. */
export function dublinHour(iso: string): number {
  return parseInt(hourFormat.format(parseSlotTime(iso)), 10) % 24;
}

/** "5:00pm" in Irish time. */
export function formatSlotTime(iso: string): string {
  const d = parseSlotTime(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return clockFormat.format(d).replace(/\s?([ap])\.?m\.?/i, (_m, a: string) => `${a.toLowerCase()}m`);
}

// A day key as a fixed instant (noon UTC) so formatting in UTC never shifts it.
function keyToUtcNoon(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function dayParts(key: string, weekday: 'long' | 'short', month: 'long' | 'short') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday,
    day: 'numeric',
    month,
  }).formatToParts(keyToUtcNoon(key));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { weekday: get('weekday'), day: get('day'), month: get('month') };
}

/** "Wednesday, 28 October". */
export function formatLongDate(key: string): string {
  const p = dayParts(key, 'long', 'long');
  return `${p.weekday}, ${p.day} ${p.month}`;
}

/** "Wed 28 Oct". */
export function formatShortDate(key: string): string {
  const p = dayParts(key, 'short', 'short');
  return `${p.weekday} ${p.day} ${p.month.slice(0, 3)}`;
}

/** "Wednesday, 28 October at 5:00pm". */
export function formatSlot(iso: string): string {
  return `${formatLongDate(slotDateKey(iso))} at ${formatSlotTime(iso)}`;
}

export function addDaysToKey(key: string, days: number): string {
  const d = keyToUtcNoon(key);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "2026-10" plus n months. */
export function addMonthsToKey(monthKey: string, months: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfKey(key: string): number {
  return keyToUtcNoon(key).getUTCDay();
}

/** Whole days from one key to another. */
export function daysBetweenKeys(from: string, to: string): number {
  return Math.round((keyToUtcNoon(to).getTime() - keyToUtcNoon(from).getTime()) / 86_400_000);
}

/** Mornings before 12:00, afternoons 12:00–17:00, evenings from 17:00. */
export function partOfDay(iso: string): PartOfDay {
  const h = dublinHour(iso);
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export function matchesTimeOfDay(iso: string, filter: TimeOfDayFilter): boolean {
  return filter === 'any' || partOfDay(iso) === filter;
}

/** Times less than this many minutes away are dropped. */
export const MIN_NOTICE_MINUTES = 30;
/** Psychologist consultations start this many days after today. */
export const PSYCHOLOGIST_LEAD_DAYS = 3;

/**
 * §5 cleaning: drops days before today (today + 3 and weekdays only for
 * psychologists), times less than 30 minutes away, and days left empty.
 */
export function cleanDays(
  days: AvailableDay[],
  options: { psychologist?: boolean; now?: Date } = {}
): AvailableDay[] {
  const now = options.now ?? new Date();
  const today = dublinDateKey(now);
  const minKey = options.psychologist ? addDaysToKey(today, PSYCHOLOGIST_LEAD_DAYS) : today;
  const cutoff = now.getTime() + MIN_NOTICE_MINUTES * 60_000;
  return days
    .filter((day) => day.date >= minKey)
    .filter((day) => {
      if (!options.psychologist) return true;
      const wd = weekdayOfKey(day.date);
      return wd !== 0 && wd !== 6;
    })
    .map((day) => ({
      date: day.date,
      times: day.times.filter((t) => {
        const ms = parseSlotTime(t).getTime();
        return !Number.isNaN(ms) && ms > cutoff;
      }),
    }))
    .filter((day) => day.times.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The first open time matching the filter, or null. Days must be sorted. */
export function earliestSlot(days: AvailableDay[], filter: TimeOfDayFilter = 'any'): { date: string; time: string } | null {
  for (const day of days) {
    const time = day.times.find((t) => matchesTimeOfDay(t, filter));
    if (time) return { date: day.date, time };
  }
  return null;
}

/**
 * Day to show first: the chosen slot's day if it is still open, else the
 * earliest day matching the filter, else the earliest day.
 */
export function defaultDay(
  days: AvailableDay[],
  filter: TimeOfDayFilter,
  selectedSlot?: string | null
): string | null {
  if (selectedSlot) {
    const key = slotDateKey(selectedSlot);
    if (days.some((d) => d.date === key && d.times.includes(selectedSlot))) return key;
  }
  return earliestSlot(days, filter)?.date ?? days[0]?.date ?? null;
}

/** Times grouped under Morning / Afternoon / Evening, empty groups left out. */
export function groupTimes(times: string[]): { part: PartOfDay; times: string[] }[] {
  const order: PartOfDay[] = ['morning', 'afternoon', 'evening'];
  return order
    .map((part) => ({ part, times: times.filter((t) => partOfDay(t) === part) }))
    .filter((g) => g.times.length > 0);
}

/**
 * Times to list for a day: those matching the filter, or every time (with
 * `fallback`) when the filter would hide them all.
 */
export function visibleTimes(times: string[], filter: TimeOfDayFilter): { times: string[]; fallback: boolean } {
  const matching = times.filter((t) => matchesTimeOfDay(t, filter));
  if (matching.length || filter === 'any') return { times: matching, fallback: false };
  return { times, fallback: true };
}

/** True when the exact slot is among the freshly fetched times (compared by instant). */
export function isSlotStillOpen(slot: string, freshTimes: string[]): boolean {
  const target = parseSlotTime(slot).getTime();
  return freshTimes.some((t) => parseSlotTime(t).getTime() === target);
}
