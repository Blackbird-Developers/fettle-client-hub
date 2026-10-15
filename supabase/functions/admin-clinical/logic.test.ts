import { describe, expect, it } from "vitest";
import {
  type AcuityAppointment,
  DAY_MS,
  groupCustomers,
} from "../admin-customer-insights/logic.ts";
import {
  CLINICAL_LOOKBACK_DAYS,
  assessmentStep,
  buildAssessmentView,
  buildPsychiatryView,
  isPsychiatry,
  nextAssessmentStep,
  psychiatryStatus,
} from "./logic.ts";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const PSYCHIATRY = "Psychiatry Medication Appointment";
const FOLLOW_UP = "Follow Up Consultation";
const SCREENING = "OCD Assessment - Consultation + Screening";
const FULL = "Full OCD Assessment";
const THERAPY = "Individual Session with Jane Topkin";

let nextId = 1;
function appt(daysFromNow: number, overrides: Partial<AcuityAppointment> = {}): AcuityAppointment {
  return {
    id: nextId++,
    firstName: "Aoife",
    lastName: "Byrne",
    email: "aoife@example.com",
    phone: "087 123 4567",
    datetime: new Date(NOW + daysFromNow * DAY_MS).toISOString(),
    type: PSYCHIATRY,
    calendar: "Dr Rubeo",
    canceled: false,
    labels: null,
    ...overrides,
  };
}

const psychiatryRows = (appointments: AcuityAppointment[]) =>
  buildPsychiatryView(groupCustomers(appointments), NOW).rows;
const assessmentRows = (appointments: AcuityAppointment[]) =>
  buildAssessmentView(groupCustomers(appointments), NOW).rows;

describe("appointment types", () => {
  it("recognises psychiatry by type id or name", () => {
    expect(isPsychiatry(appt(0, { type: "Anything", appointmentTypeID: 95879530 }))).toBe(true);
    expect(isPsychiatry(appt(0, { type: FOLLOW_UP }))).toBe(true);
    expect(isPsychiatry(appt(0, { type: "Psychiatry Assessment" }))).toBe(true);
    expect(isPsychiatry(appt(0, { type: THERAPY }))).toBe(false);
    expect(isPsychiatry(appt(0, { type: SCREENING }))).toBe(false);
  });

  it("splits assessments into steps and leaves psychiatry out", () => {
    expect(assessmentStep(appt(0, { type: SCREENING }))).toBe("screening");
    expect(assessmentStep(appt(0, { type: "Consultation", appointmentTypeID: 92853020 }))).toBe(
      "screening"
    );
    expect(assessmentStep(appt(0, { type: FULL }))).toBe("full");
    expect(assessmentStep(appt(0, { type: "Addiction Assessment" }))).toBe("other");
    expect(assessmentStep(appt(0, { type: "Psychiatry Assessment" }))).toBeNull();
    expect(assessmentStep(appt(0, { type: "Recovery Assessment Programme" }))).toBeNull();
    expect(assessmentStep(appt(0, { type: THERAPY }))).toBeNull();
  });

  it("books a full assessment after screening, therapy after anything else", () => {
    expect(nextAssessmentStep("screening")).toBe("full");
    expect(nextAssessmentStep("full")).toBe("therapy");
    expect(nextAssessmentStep("other")).toBe("therapy");
  });
});

describe("psychiatryStatus", () => {
  it.each([
    [0, "not_due"],
    [20, "not_due"],
    [21, "due"],
    [28, "due"],
    [29, "overdue"],
  ] as const)("%i days after with nothing booked is %s", (days, status) => {
    expect(psychiatryStatus(days, false)).toBe(status);
  });

  it("is booked whenever a follow-up is booked", () => {
    expect(psychiatryStatus(40, true)).toBe("booked");
  });
});

describe("buildPsychiatryView", () => {
  it("works out contact and book-by dates from the last appointment", () => {
    const [row] = psychiatryRows([appt(-22)]);
    expect(row).toMatchObject({
      status: "due",
      daysSinceLast: 22,
      psychiatrist: "Dr Rubeo",
      lastType: PSYCHIATRY,
      contactOn: new Date(NOW + (21 - 22) * DAY_MS).toISOString(),
      followUpBy: new Date(NOW + (28 - 22) * DAY_MS).toISOString(),
    });
  });

  it("restarts the 3-week clock after each follow-up", () => {
    const [row] = psychiatryRows([appt(-60), appt(-10, { type: FOLLOW_UP })]);
    expect(row).toMatchObject({ status: "not_due", daysSinceLast: 10, lastType: FOLLOW_UP });
  });

  it("marks a booked follow-up", () => {
    const [row] = psychiatryRows([appt(-25), appt(4, { type: FOLLOW_UP })]);
    expect(row).toMatchObject({ status: "booked", nextType: FOLLOW_UP });
  });

  it("lists a booked first consultation as upcoming", () => {
    const [row] = psychiatryRows([appt(3)]);
    expect(row).toMatchObject({ status: "upcoming", lastAt: null, contactOn: null });
  });

  it("ignores cancelled appointments, therapy and anything before the lookback", () => {
    expect(
      psychiatryRows([
        appt(-(CLINICAL_LOOKBACK_DAYS + 1)),
        appt(-5, { canceled: true }),
        appt(-30, { type: THERAPY }),
      ])
    ).toEqual([]);
  });

  it("does not count a booked therapy session as a psychiatry follow-up", () => {
    const [row] = psychiatryRows([appt(-30), appt(2, { type: THERAPY })]);
    expect(row.status).toBe("overdue");
  });

  it("puts overdue first, then due, then the rest", () => {
    const view = buildPsychiatryView(
      groupCustomers([
        appt(-5, { email: "a@example.com" }),
        appt(-40, { email: "b@example.com" }),
        appt(-23, { email: "c@example.com" }),
        appt(2, { email: "d@example.com" }),
      ]),
      NOW
    );
    expect(view.rows.map((r) => r.status)).toEqual(["overdue", "due", "not_due", "upcoming"]);
    expect(view.totals).toEqual({ upcoming: 1, not_due: 1, due: 1, overdue: 1, booked: 0 });
  });
});

describe("buildAssessmentView", () => {
  it("needs a full assessment booked after screening", () => {
    const [row] = assessmentRows([appt(-6, { type: SCREENING, calendar: "Dr Byrne" })]);
    expect(row).toMatchObject({
      status: "needs_booking",
      lastStep: "screening",
      nextStep: "full",
      clinician: "Dr Byrne",
      daysSinceLast: 6,
    });
  });

  it("is booked once the full assessment is booked", () => {
    const [row] = assessmentRows([appt(-6, { type: SCREENING }), appt(10, { type: FULL })]);
    expect(row).toMatchObject({ status: "booked", nextType: FULL });
  });

  it("doesn't treat therapy as the next step after screening", () => {
    const [row] = assessmentRows([appt(-6, { type: SCREENING }), appt(3, { type: THERAPY })]);
    expect(row.status).toBe("needs_booking");
  });

  it("needs aftercare therapy after a full assessment", () => {
    const [row] = assessmentRows([appt(-40, { type: SCREENING }), appt(-8, { type: FULL })]);
    expect(row).toMatchObject({ status: "needs_booking", lastStep: "full", nextStep: "therapy" });
  });

  it("is booked or in therapy once aftercare is booked or has started", () => {
    expect(
      assessmentRows([appt(-8, { type: FULL }), appt(5, { type: THERAPY })])[0].status
    ).toBe("booked");
    expect(
      assessmentRows([appt(-8, { type: FULL }), appt(-1, { type: THERAPY })])[0].status
    ).toBe("in_therapy");
  });

  it("lists a booked first assessment as upcoming", () => {
    const [row] = assessmentRows([appt(7, { type: SCREENING })]);
    expect(row).toMatchObject({ status: "upcoming", nextType: SCREENING, nextStep: null });
  });

  it("leaves psychiatry-only clients out", () => {
    expect(assessmentRows([appt(-10)])).toEqual([]);
  });
});
