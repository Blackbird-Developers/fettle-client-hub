// Pure logic for the admin-clinical edge function: the admin "Psychiatry" and
// "Assessments" pages. Psychiatry shows who is due a follow-up call 3 weeks
// after a psychiatry appointment (to book a week-4 follow-up); Assessments
// shows each client's last assessment step and the session they still need
// booked. No Deno or network imports, so the same file runs inside the edge
// function and under Vitest (logic.test.ts). Shares customer matching with
// admin-customer-insights.

import {
  type AcuityAppointment,
  type Customer,
  DAY_MS,
  appointmentTime,
  classifyAppointmentType,
  daysSince,
  isCompleted,
  isUpcoming,
} from "../admin-customer-insights/logic.ts";

/** Clients whose last psychiatry / assessment appointment is older than this are left out. */
export const CLINICAL_LOOKBACK_DAYS = 90;

/** Contact the client this many days after a psychiatry appointment… */
export const PSYCHIATRY_CONTACT_AFTER_DAYS = 21;
/** …to book a follow-up for week 4, i.e. by this many days after it. */
export const PSYCHIATRY_FOLLOW_UP_BY_DAYS = 28;

// ---------------------------------------------------------------------------
// Appointment types
// ---------------------------------------------------------------------------

// Every Acuity type in the "Psychiatry" category (mirrors src/lib/psychiatry.ts):
// the bookable consultation ("Psychiatry Medication Appointment"), Psychiatry
// Assessment, Psychiatry Appointment, Follow Up Consultation and the payment
// plan. Names catch types added or archived later.
const PSYCHIATRY_TYPE_IDS = [95879530, 57165366, 56229647, 56229698, 63878915];
const PSYCHIATRY_TYPE_PATTERNS = [/psychiatr/i, /follow up consultation/i, /medication appointment/i];

export function isPsychiatry(appt: AcuityAppointment): boolean {
  if (appt.appointmentTypeID && PSYCHIATRY_TYPE_IDS.includes(appt.appointmentTypeID)) return true;
  const name = appt.type ?? "";
  return PSYCHIATRY_TYPE_PATTERNS.some((p) => p.test(name));
}

// Assessment steps (mirrors src/lib/assessments.ts):
//   screening — the stage-1 "Consultation + screening" for OCD, Anxiety and
//               Depression, booked in the hub or on fettle.ie
//   full      — the "Full … Assessment" the clinician books if recommended
//   other     — any other assessment type, e.g. the one-off Addiction assessment
export type AssessmentStep = "screening" | "full" | "other";

const SCREENING_TYPE_IDS = [92852936, 92853020, 92853161];

export function assessmentStep(appt: AcuityAppointment): AssessmentStep | null {
  if (appt.appointmentTypeID && SCREENING_TYPE_IDS.includes(appt.appointmentTypeID)) {
    return "screening";
  }
  if (isPsychiatry(appt) || classifyAppointmentType(appt.type) !== "assessment") return null;
  const name = appt.type ?? "";
  // Recovery programmes are grouped with assessments for progression, but
  // they aren't an assessment step.
  if (/recovery.*programme/i.test(name)) return null;
  if (/screening/i.test(name)) return "screening";
  if (/\bfull\b/i.test(name)) return "full";
  return "other";
}

export type NextAssessmentStep = "full" | "therapy";

/** What should be booked after each step: a full assessment after screening, else therapy. */
export function nextAssessmentStep(step: AssessmentStep): NextAssessmentStep {
  return step === "screening" ? "full" : "therapy";
}

export const NEXT_STEP_LABELS: Record<NextAssessmentStep, string> = {
  full: "Full clinical assessment",
  therapy: "Aftercare therapy",
};

// ---------------------------------------------------------------------------
// Psychiatry follow-ups
// ---------------------------------------------------------------------------

// upcoming  — first psychiatry appointment in the window hasn't happened yet
// not_due   — last appointment under 3 weeks ago, nothing booked
// due       — 3–4 weeks ago, nothing booked: contact now
// overdue   — past week 4, nothing booked
// booked    — a later psychiatry appointment is booked
export type PsychiatryStatus = "upcoming" | "not_due" | "due" | "overdue" | "booked";

export function psychiatryStatus(daysSinceLast: number, hasBookedFollowUp: boolean): PsychiatryStatus {
  if (hasBookedFollowUp) return "booked";
  if (daysSinceLast < PSYCHIATRY_CONTACT_AFTER_DAYS) return "not_due";
  if (daysSinceLast <= PSYCHIATRY_FOLLOW_UP_BY_DAYS) return "due";
  return "overdue";
}

export interface PsychiatryRow {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: PsychiatryStatus;
  /** Last completed psychiatry appointment; null for "upcoming". */
  lastAt: string | null;
  lastType: string | null;
  /** Acuity calendar (the psychiatrist) of the last or upcoming appointment. */
  psychiatrist: string | null;
  daysSinceLast: number | null;
  /** When to contact (last + 3 weeks) and book by (last + 4 weeks). */
  contactOn: string | null;
  followUpBy: string | null;
  /** The next booked psychiatry appointment, if any. */
  nextAt: string | null;
  nextType: string | null;
  /** Psychiatry appointments seen in the window (lookback to future). */
  appointmentsInWindow: number;
}

export interface PsychiatryView {
  rows: PsychiatryRow[];
  totals: Record<PsychiatryStatus, number>;
}

const STATUS_ORDER: Record<PsychiatryStatus, number> = {
  overdue: 0,
  due: 1,
  not_due: 2,
  booked: 3,
  upcoming: 4,
};

const isoDate = (ms: number) => new Date(ms).toISOString();
const typeName = (appt: AcuityAppointment | null | undefined) => appt?.type?.trim() || null;
const calendarName = (appt: AcuityAppointment | null | undefined) => appt?.calendar?.trim() || null;

// One row per client with a psychiatry appointment in the window. The 3-week
// rule runs from their LAST completed psychiatry appointment, so it applies
// after the consultation and after every follow-up.
export function buildPsychiatryView(customers: Customer[], now: number): PsychiatryView {
  const since = now - CLINICAL_LOOKBACK_DAYS * DAY_MS;
  const rows: PsychiatryRow[] = [];
  const totals: Record<PsychiatryStatus, number> = {
    upcoming: 0,
    not_due: 0,
    due: 0,
    overdue: 0,
    booked: 0,
  };

  for (const customer of customers) {
    // Appointments are non-cancelled and oldest first (groupCustomers).
    const psychiatry = customer.appointments.filter(
      (appt) => isPsychiatry(appt) && appointmentTime(appt) >= since
    );
    if (psychiatry.length === 0) continue;

    const completed = psychiatry.filter((appt) => isCompleted(appt, now));
    const last = completed[completed.length - 1] ?? null;
    const next = psychiatry.find((appt) => isUpcoming(appt, now)) ?? null;
    const base = {
      key: customer.key,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      appointmentsInWindow: psychiatry.length,
      nextAt: next?.datetime ?? null,
      nextType: typeName(next),
    };

    if (!last) {
      totals.upcoming++;
      rows.push({
        ...base,
        status: "upcoming",
        lastAt: null,
        lastType: null,
        psychiatrist: calendarName(next),
        daysSinceLast: null,
        contactOn: null,
        followUpBy: null,
      });
      continue;
    }

    const lastAt = appointmentTime(last);
    const daysSinceLast = daysSince(lastAt, now);
    const status = psychiatryStatus(daysSinceLast, next !== null);
    totals[status]++;
    rows.push({
      ...base,
      status,
      lastAt: last.datetime,
      lastType: typeName(last),
      psychiatrist: calendarName(last),
      daysSinceLast,
      contactOn: isoDate(lastAt + PSYCHIATRY_CONTACT_AFTER_DAYS * DAY_MS),
      followUpBy: isoDate(lastAt + PSYCHIATRY_FOLLOW_UP_BY_DAYS * DAY_MS),
    });
  }

  // Most urgent first; within a status, whoever has waited longest.
  rows.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (b.daysSinceLast ?? -1) - (a.daysSinceLast ?? -1)
  );
  return { rows, totals };
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

// upcoming      — their first assessment in the window hasn't happened yet
// needs_booking — last step done, next step not booked
// booked        — next step (or another assessment) booked, not yet happened
// in_therapy    — after a full / one-off assessment, a therapy session has
//                 already happened: moved on to aftercare
export type AssessmentStatus = "upcoming" | "needs_booking" | "booked" | "in_therapy";

export interface AssessmentRow {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: AssessmentStatus;
  /** Last completed assessment step; null for "upcoming". */
  lastStep: AssessmentStep | null;
  lastAt: string | null;
  lastType: string | null;
  /** Acuity calendar (the clinician) of the last or upcoming assessment. */
  clinician: string | null;
  daysSinceLast: number | null;
  /** What to book next; null for "upcoming". */
  nextStep: NextAssessmentStep | null;
  /** The booked (or, for in_therapy, first completed) next appointment. */
  nextAt: string | null;
  nextType: string | null;
}

export interface AssessmentView {
  rows: AssessmentRow[];
  totals: Record<AssessmentStatus, number>;
}

const ASSESSMENT_STATUS_ORDER: Record<AssessmentStatus, number> = {
  needs_booking: 0,
  booked: 1,
  upcoming: 2,
  in_therapy: 3,
};

export function buildAssessmentView(customers: Customer[], now: number): AssessmentView {
  const since = now - CLINICAL_LOOKBACK_DAYS * DAY_MS;
  const rows: AssessmentRow[] = [];
  const totals: Record<AssessmentStatus, number> = {
    upcoming: 0,
    needs_booking: 0,
    booked: 0,
    in_therapy: 0,
  };

  for (const customer of customers) {
    const assessments = customer.appointments.filter(
      (appt) => assessmentStep(appt) !== null && appointmentTime(appt) >= since
    );
    if (assessments.length === 0) continue;

    const completed = assessments.filter((appt) => isCompleted(appt, now));
    const last = completed[completed.length - 1] ?? null;
    const base = {
      key: customer.key,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    };

    if (!last) {
      const upcoming = assessments[0];
      totals.upcoming++;
      rows.push({
        ...base,
        status: "upcoming",
        lastStep: null,
        lastAt: null,
        lastType: null,
        clinician: calendarName(upcoming),
        daysSinceLast: null,
        nextStep: null,
        nextAt: upcoming.datetime,
        nextType: typeName(upcoming),
      });
      continue;
    }

    const lastAt = appointmentTime(last);
    const lastStep = assessmentStep(last)!;
    const nextStep = nextAssessmentStep(lastStep);
    const after = customer.appointments.filter((appt) => appointmentTime(appt) > lastAt);
    // Any later assessment counts as booked: the clinician may have booked a
    // different step than the one we expect.
    const nextAssessment = after.find((appt) => assessmentStep(appt) !== null) ?? null;
    const therapy =
      nextStep === "therapy"
        ? (after.find((appt) => classifyAppointmentType(appt.type) === "therapy") ?? null)
        : null;
    const next = nextAssessment ?? therapy;

    const status: AssessmentStatus = !next
      ? "needs_booking"
      : next === therapy && isCompleted(therapy, now)
        ? "in_therapy"
        : "booked";
    totals[status]++;
    rows.push({
      ...base,
      status,
      lastStep,
      lastAt: last.datetime,
      lastType: typeName(last),
      clinician: calendarName(last),
      daysSinceLast: daysSince(lastAt, now),
      nextStep,
      nextAt: next?.datetime ?? null,
      nextType: typeName(next),
    });
  }

  rows.sort(
    (a, b) =>
      ASSESSMENT_STATUS_ORDER[a.status] - ASSESSMENT_STATUS_ORDER[b.status] ||
      (b.daysSinceLast ?? -1) - (a.daysSinceLast ?? -1)
  );
  return { rows, totals };
}
