// Pure logic for the acuity-appointments-mirror edge function: turning Acuity
// appointments into acuity_appointments rows, deciding who made a booking,
// and planning the date ranges each run walks. No Deno or network imports,
// so it runs under Vitest (logic.test.ts).

import {
  type AcuityAppointment,
  DAY_MS,
  addDays,
  classifyAppointmentType,
  customerKey,
} from "../admin-customer-insights/logic.ts";
import { sessionCategory } from "../admin-analytics/logic.ts";

/** Days of past appointments re-pulled every run (reschedules, cancellations). */
export const REFRESH_PAST_DAYS = 60;
/** Days of future appointments re-pulled every run. */
export const REFRESH_FUTURE_DAYS = 180;
/** The one-off history copy stops here. Earlier than any Fettle booking. */
export const HISTORY_START_DATE = "2010-01-01";
/** Days per "range" step, so each call stays well inside the time limit. */
export const RANGE_DAYS = 14;
/** Most history ranges copied per run, so one run can't take all hour. */
export const BACKFILL_RANGES_PER_RUN = 130;

// Bookings made through our API (website checkout and the hub) carry the API
// account's email in scheduledBy. Same constant as unpaid-sessions and
// unpaid-session-reminders. Art books by hand from the same account, so his
// bookings also read as client bookings (known edge case, in the brief).
export const API_BOOKED_BY = "art@blackbird.marketing";

/** Fields of Acuity's appointment this sync reads, beyond the shared ones. */
export interface AcuityMirrorAppointment extends AcuityAppointment {
  calendarID?: number | null;
  datetimeCreated?: string | null;
}

export interface MirrorRow {
  id: number;
  customer_key: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  appointment_type_id: number | null;
  type: string | null;
  kind: string;
  /** The boards' session type filter (admin-analytics sessionCategory). */
  category: string | null;
  calendar_id: number | null;
  calendar: string | null;
  datetime: string;
  datetime_created: string | null;
  canceled: boolean;
  certificate: string | null;
  labels: { id: number; name: string | null }[];
  synced_at: string;
}

const text = (value: string | null | undefined) => {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
};

const isoOrNull = (value: string | null | undefined) => {
  const ms = Date.parse(value ?? "");
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

// The row to upsert. Leaves out scheduled_by / booked_by_client /
// details_fetched_at so an upsert keeps what the detail lookup found.
// Null when Acuity sent no usable date.
export function toMirrorRow(appt: AcuityMirrorAppointment, syncedAt: number): MirrorRow | null {
  const datetime = isoOrNull(appt.datetime);
  if (!datetime || !Number.isInteger(appt.id)) return null;
  const kind = classifyAppointmentType(appt.type);
  return {
    id: appt.id,
    customer_key: customerKey(appt),
    email: text(appt.email),
    phone: text(appt.phone),
    first_name: text(appt.firstName),
    last_name: text(appt.lastName),
    appointment_type_id: appt.appointmentTypeID ?? null,
    type: text(appt.type),
    kind,
    category: sessionCategory(appt.type, kind),
    calendar_id: appt.calendarID ?? null,
    calendar: text(appt.calendar),
    datetime,
    datetime_created: isoOrNull(appt.datetimeCreated),
    canceled: Boolean(appt.canceled),
    certificate: text(appt.certificate),
    labels: (appt.labels ?? []).map((label) => ({ id: label.id, name: label.name ?? null })),
    synced_at: new Date(syncedAt).toISOString(),
  };
}

/**
 * Who made the booking, from /appointments/{id}'s scheduledBy:
 * empty = the client on Acuity's own page; the API account = the client on
 * the website or hub; anything else = a team member.
 */
export function isBookedByClient(scheduledBy: string | null | undefined): boolean {
  const by = (scheduledBy ?? "").trim().toLowerCase();
  return by === "" || by === API_BOOKED_BY;
}

/** Splits [minDate, maxDate] into consecutive ranges of `days`. */
export function dateRanges(minDate: string, maxDate: string, days: number): [string, string][] {
  const ranges: [string, string][] = [];
  for (let from = minDate; from <= maxDate; from = addDays(from, days)) {
    const to = addDays(from, days - 1);
    ranges.push([from, to < maxDate ? to : maxDate]);
  }
  return ranges;
}

/** The rolling window every run re-pulls. */
export function refreshWindow(today: string): { minDate: string; maxDate: string } {
  return { minDate: addDays(today, -REFRESH_PAST_DAYS), maxDate: addDays(today, REFRESH_FUTURE_DAYS) };
}

// The next history ranges to copy, newest first, working back from where the
// last run stopped (or from the start of the refresh window) to
// HISTORY_START_DATE. Copying backwards means the copied part is always one
// unbroken stretch up to today, recorded by a single date.
export function backfillRanges(
  backfilledFrom: string | null,
  today: string,
  limit = BACKFILL_RANGES_PER_RUN
): [string, string][] {
  let to = addDays(backfilledFrom ?? refreshWindow(today).minDate, -1);
  const ranges: [string, string][] = [];
  while (to >= HISTORY_START_DATE && ranges.length < limit) {
    const candidate = addDays(to, -(RANGE_DAYS - 1));
    const from = candidate > HISTORY_START_DATE ? candidate : HISTORY_START_DATE;
    ranges.push([from, to]);
    to = addDays(from, -1);
  }
  return ranges;
}

// After copying [minDate, maxDate], the new "copied from" date — but only if
// the range joins onto what's already copied, so a gap can never be skipped.
export function nextBackfilledFrom(
  current: string | null,
  today: string,
  minDate: string,
  maxDate: string
): string | null {
  const start = current ?? refreshWindow(today).minDate;
  if (addDays(maxDate, 1) < start) return current;
  return minDate < start ? minDate : start;
}

// Appointments that were in the window but that Acuity no longer returns
// were deleted in Acuity. Only rows at least a day inside the window are
// pruned: Acuity reads minDate/maxDate in the account's time zone, so rows
// on the edge days could be missed by a correct fetch.
export function idsToPrune(
  stored: { id: number; datetime: string }[],
  seenIds: Set<number>,
  window: { minDate: string; maxDate: string }
): number[] {
  const from = Date.parse(`${window.minDate}T00:00:00Z`) + DAY_MS;
  const to = Date.parse(`${window.maxDate}T00:00:00Z`);
  return stored
    .filter((row) => {
      const at = Date.parse(row.datetime);
      return at >= from && at < to && !seenIds.has(row.id);
    })
    .map((row) => row.id);
}
