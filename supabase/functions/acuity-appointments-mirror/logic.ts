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
  normalizeEmail,
} from "../admin-customer-insights/logic.ts";
import { type BookingSource, sessionCategory } from "../admin-analytics/logic.ts";

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
// bookings also read as client bookings; bookingSourceFromPayments tells
// them apart where Stripe allows.
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

// ---------------------------------------------------------------------------
// Where a booking was made (Art, 29 Oct 2026)
// ---------------------------------------------------------------------------

/** From scheduledBy alone: the client on Acuity's own page, or a team member.
 *  Null for the main (API) account, which needs matching to Stripe
 *  (bookingSourceFromPayments). */
export function sourceFromScheduledBy(scheduledBy: string | null | undefined): BookingSource | null {
  const by = (scheduledBy ?? "").trim().toLowerCase();
  if (by === "") return "acuity_page";
  if (by === API_BOOKED_BY) return null;
  return "team";
}

/** A website or hub Stripe payment, as far as matching needs. */
export interface BookingPayment {
  origin: "website" | "hub";
  /** When the payment was created (ms). */
  createdAt: number;
  /** The Acuity appointment it paid for, when the payment says. */
  appointmentId: string | null;
  email: string | null;
}

/** The fields of a Stripe PaymentIntent that matching reads. */
export interface StripePaymentIntent {
  status: string;
  /** Seconds, as Stripe sends it. */
  created: number;
  description?: string | null;
  receipt_email?: string | null;
  metadata?: Record<string, string> | null;
}

// Where a payment may carry the Acuity appointment id. The hub writes
// acuity_appointment_id; the others cover what the website might use.
const APPOINTMENT_ID_KEYS = ["acuity_appointment_id", "appointmentId", "appointment_id", "acuityAppointmentId"];
// Paid, being paid, or authorised to be taken.
const PAID_STATUSES = new Set(["succeeded", "processing", "requires_capture"]);

/** A Stripe payment as a BookingPayment; null unless it's a website or hub booking payment. */
export function toBookingPayment(pi: StripePaymentIntent): BookingPayment | null {
  if (!PAID_STATUSES.has(pi.status)) return null;
  const description = (pi.description ?? "").trim().toLowerCase();
  const metadata = pi.metadata ?? {};
  let origin: BookingPayment["origin"];
  if (description.startsWith("[myfettlehub]") || metadata.source === "myfettlehub") {
    // Settling an unpaid session pays for a booking made earlier, by whoever made it.
    if (description.startsWith("[myfettlehub] settle unpaid session")) return null;
    origin = "hub";
  } else if (description.startsWith("[website]")) {
    origin = "website";
  } else {
    return null;
  }
  const idKey = APPOINTMENT_ID_KEYS.find((key) => text(metadata[key]) !== null);
  return {
    origin,
    createdAt: pi.created * 1000,
    appointmentId: idKey ? text(metadata[idKey]) : null,
    email: normalizeEmail(metadata.email ?? pi.receipt_email ?? null),
  };
}

/** How long before a booking its payment may have been made (checkout left open). */
export const PAYMENT_BEFORE_BOOKING_MS = 2 * 60 * 60 * 1000;
/** And after it (clocks a little apart). */
export const PAYMENT_AFTER_BOOKING_MS = 15 * 60 * 1000;

// Where a main-account booking came from. The hub stamps the Acuity
// appointment id on its payments and records referral-credit bookings by id;
// a payment without an id is matched on the client's email and the time.
// No match = booked in Acuity under the main account by the team (Art), or
// paid with a package or gift certificate, which leaves no payment then.
export function bookingSourceFromPayments(
  appointment: { id: number; email: string | null; createdAt: number | null },
  payments: BookingPayment[],
  referralBookingIds: Set<string>
): BookingSource {
  const id = String(appointment.id);
  if (referralBookingIds.has(id)) return "hub";
  const byId = payments.find((p) => p.appointmentId === id);
  if (byId) return byId.origin;
  const email = normalizeEmail(appointment.email);
  const createdAt = appointment.createdAt;
  if (email && createdAt !== null) {
    const byEmail = payments.find(
      (p) =>
        p.appointmentId === null &&
        p.email === email &&
        p.createdAt >= createdAt - PAYMENT_BEFORE_BOOKING_MS &&
        p.createdAt <= createdAt + PAYMENT_AFTER_BOOKING_MS
    );
    if (byEmail) return byEmail.origin;
  }
  return "main_account";
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
