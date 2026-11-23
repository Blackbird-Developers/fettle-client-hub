// Psychiatry and assessments ("clinical" sessions) are card-only: no bundle
// credits, no discount codes, no referral credit. The website enforces this in
// the browser (isClinicalCategory in BookingModal.tsx); the functions enforce
// it here so the app, or an edited request, can't get around it. Same name
// test pay-session already uses for assessments.
export function isClinicalTypeName(name: string | null | undefined): boolean {
  return /psychiatr|assessment|screening/i.test(name ?? "");
}

export const CLINICAL_CARD_ONLY_MESSAGE =
  "Psychiatry and assessment sessions can only be paid by card.";

// Acuity calendars that are not a real clinician. The "Preliminary
// Availability Calendar" is attached to some assessment types as a
// placeholder; assessments must be booked with a therapist instead. Keep in
// step with NON_THERAPIST_CALENDAR_IDS in src/lib/assessments.ts.
export const NON_THERAPIST_CALENDAR_IDS: readonly number[] = [13216804];

/**
 * Why this session can't be booked online, or null when it can.
 * - Psychiatry is no longer bookable through the hub.
 * - Assessments must name one of the type's therapist calendars, never the
 *   Preliminary Availability Calendar or none at all (Acuity would then pick
 *   any calendar on the type, the prelim one included).
 */
export function onlineBookingRefusal(
  typeName: string | null | undefined,
  calendarID: unknown,
): string | null {
  const name = typeName ?? "";
  if (/psychiatr/i.test(name)) {
    return "Psychiatry appointments can't be booked online. Please contact hello@fettle.ie.";
  }
  if (/assessment|screening/i.test(name)) {
    const calendarId = parseInt(String(calendarID ?? ""), 10);
    if (!calendarId || NON_THERAPIST_CALENDAR_IDS.includes(calendarId)) {
      return "Please choose your assessment time again so we can book you in with one of our therapists.";
    }
  }
  return null;
}
