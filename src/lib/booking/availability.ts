// Availability for one therapist's own Acuity type, for the booking wizard
// (docs/QUIZ_BOOKING_FLOW.md §3.2, §5). Unlike fetchDates/fetchTimes in
// useNextAvailable (which swallow errors for the dashboard hint), these throw,
// so the wizard can show "We couldn't load {First}'s calendar".
//
// The acuity edge function returns dates per month and times per day, so a
// month is loaded as its dates plus the times of each date (a few calls at a
// time). Having every time up front lets the calendar fade days with no
// morning/afternoon/evening times and the earliest card honour the filter.

import { type AvailableDay, addMonthsToKey, cleanDays, dublinDateKey, isDayAllowed, isSlotStillOpen } from './time';

const ACUITY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity`;
const ACUITY_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/** Calendar range: this month and the next 11. */
export const MONTHS_AHEAD = 12;
/** Parallel get-times calls when loading a month. */
const TIMES_CONCURRENCY = 4;

export interface SlotSource {
  typeId: string | number;
  calendarId: number | null;
  psychologist?: boolean;
}

async function getJson(params: Record<string, string>): Promise<unknown> {
  const url = `${ACUITY_BASE}?${new URLSearchParams(params).toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${ACUITY_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`Availability request failed (${res.status})`);
  const data = await res.json();
  if (data && typeof data === 'object' && !Array.isArray(data) && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data;
}

function withCalendar(params: Record<string, string>, calendarId: number | null): Record<string, string> {
  return calendarId ? { ...params, calendarId: String(calendarId) } : params;
}

/** Days with open times in a month ("yyyy-MM"), as Acuity lists them. */
export async function fetchMonthDates(source: SlotSource, month: string): Promise<string[]> {
  const data = await getJson(
    withCalendar({ action: 'get-availability', appointmentTypeId: String(source.typeId), month }, source.calendarId)
  );
  if (!Array.isArray(data)) return [];
  return data
    .map((d: { date?: string }) => d?.date)
    .filter((d): d is string => typeof d === 'string')
    .map((d) => d.slice(0, 10));
}

/** Open times on a day ("yyyy-MM-dd"), as Acuity ISO strings. */
export async function fetchDayTimes(source: SlotSource, date: string): Promise<string[]> {
  const data = await getJson(
    withCalendar({ action: 'get-times', appointmentTypeId: String(source.typeId), date }, source.calendarId)
  );
  if (!Array.isArray(data)) return [];
  return data.map((t: { time?: string }) => t?.time).filter((t): t is string => typeof t === 'string');
}

/** Runs fn over items with at most `limit` calls in flight, keeping order. */
export async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * A month's open days with their times, cleaned by the §5 rules (no past
 * days, nothing within 30 minutes, psychologists from today + 3 on weekdays).
 */
export async function fetchMonthDays(source: SlotSource, month: string, now: Date = new Date()): Promise<AvailableDay[]> {
  const rules = { psychologist: source.psychologist, now };
  // Only fetch times for days the rules keep.
  const dates = (await fetchMonthDates(source, month)).filter((d) => isDayAllowed(d, rules));
  const days = await mapWithLimit(dates, TIMES_CONCURRENCY, async (date) => ({
    date,
    times: await fetchDayTimes(source, date),
  }));
  return cleanDays(days, rules);
}

/**
 * First month (from the current one, up to 12) that has an open time, with
 * its days; null when there is nothing in the next 12 months.
 */
export async function findFirstOpenMonth(
  source: SlotSource,
  now: Date = new Date()
): Promise<{ month: string; days: AvailableDay[] } | null> {
  const start = dublinDateKey(now).slice(0, 7);
  for (let i = 0; i < MONTHS_AHEAD; i++) {
    const month = addMonthsToKey(start, i);
    const days = await fetchMonthDays(source, month, now);
    if (days.length) return { month, days };
  }
  return null;
}

/** Earliest open time for a therapist (used to rank matches), or null. */
export async function findEarliestSlot(
  source: SlotSource,
  now: Date = new Date()
): Promise<{ date: string; time: string } | null> {
  const first = await findFirstOpenMonth(source, now);
  const day = first?.days[0];
  return day ? { date: day.date, time: day.times[0] } : null;
}

/**
 * Re-checks just before charging that the exact time is still free (§5). The
 * slot is never held, so someone else may have booked it meanwhile.
 */
export async function recheckSlot(source: SlotSource, slot: string): Promise<boolean> {
  const date = slot.slice(0, 10);
  const times = await fetchDayTimes(source, date);
  return isSlotStillOpen(slot, times);
}
