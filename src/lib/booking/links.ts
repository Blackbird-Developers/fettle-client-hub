// Links into the /book wizard from other pages (docs/QUIZ_BOOKING_FLOW.md §10.3).

import { type TherapistRow, type TherapyService, sessionTypeId } from './therapists';

/**
 * The wizard link for a calendar, or null when that calendar isn't in the
 * therapist table (psychiatrists and assessment clinicians), so callers keep
 * using BookingModal for them.
 */
export function wizardLinkForCalendar(
  calendarId: number | string | null | undefined,
  therapists: TherapistRow[],
  lastAppointmentTypeId?: number | string | null
): string | null {
  if (calendarId === null || calendarId === undefined || !therapists.length) return null;
  const row = therapists.find((t) => String(t.calendarid ?? '').trim() === String(calendarId));
  if (!row) return null;
  const params = new URLSearchParams({ therapist: String(calendarId) });
  const service = serviceOfType(row, lastAppointmentTypeId);
  if (service) params.set('service', service);
  return `/book?${params.toString()}`;
}

/** Which of the therapist's own types an appointment was, so "Book again" keeps the service. */
export function serviceOfType(row: TherapistRow, typeId: number | string | null | undefined): TherapyService | null {
  if (typeId === null || typeId === undefined) return null;
  const id = String(typeId);
  return (['individual', 'couples', 'youth'] as TherapyService[]).find((s) => sessionTypeId(row, s) === id) ?? null;
}
