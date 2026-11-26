import { describe, expect, it } from "vitest";
import {
  adoptionPeriodTotals,
  clinicalPeriodTotals,
  leadPeriodTotals,
  parseClinicalRows,
  parseLeadCustomers,
  parsePeriodsParams,
} from "./worklists.ts";
import { type SessionRow, buildHistories } from "./logic.ts";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };
const ms = (iso: string) => Date.parse(iso);
const NO_SHOW = [{ id: 1, name: "No Show " }];
const QUOTED = [{ id: 2, name: "Quoted " }];
const BOOKED_IN = [{ id: 23047490, name: "Booked in " }];

let nextId = 1;
const row = (customer: string, iso: string, type: string, labels: unknown[] = [], canceled = false) => [
  nextId++,
  `email:${customer}@example.com`,
  ms(iso),
  canceled,
  type,
  null,
  labels,
];

describe("lead period totals", () => {
  const customers = parseLeadCustomers([
    // Missed a call in November, booked therapy after: converted.
    row("ann", "2026-11-03T10:00:00Z", "Let's Talk", NO_SHOW),
    row("ann", "2026-11-12T10:00:00Z", "Individual Therapy"),
    // Quoted in November, nothing since.
    row("bo", "2026-11-10T10:00:00Z", "Individual Therapy", QUOTED),
    // Missed a call, then the call went ahead: not a lead.
    row("cy", "2026-11-04T10:00:00Z", "Let's Talk", NO_SHOW),
    row("cy", "2026-11-06T10:00:00Z", "Let's Talk"),
    // Missed and quoted in October, labelled Booked in: converted, October only.
    row("di", "2026-10-05T10:00:00Z", "Let's Talk", NO_SHOW),
    row("di", "2026-10-08T10:00:00Z", "Individual Therapy", [...QUOTED, ...BOOKED_IN]),
    // Cancelled appointments never count.
    row("ed", "2026-11-05T10:00:00Z", "Let's Talk", NO_SHOW, true),
  ]);

  it("reads rows into customers, leaving out cancelled appointments", () => {
    expect(customers.map((c) => c.key).sort()).toEqual([
      "email:ann@example.com",
      "email:bo@example.com",
      "email:cy@example.com",
      "email:di@example.com",
    ]);
    expect(customers.find((c) => c.key === "email:ann@example.com")!.appointments).toHaveLength(2);
  });

  it("counts leads, missed calls, quotes and conversions with Hot leads' rules", () => {
    expect(leadPeriodTotals(customers, NOVEMBER, NOW)).toEqual({
      leads: 2,
      missedCalls: 1,
      quoted: 1,
      converted: 1,
      conversionRate: 0.5,
    });
    expect(leadPeriodTotals(customers, OCTOBER, NOW)).toEqual({
      leads: 1,
      missedCalls: 1,
      quoted: 1,
      converted: 1,
      conversionRate: 1,
    });
  });
});

describe("clinical period totals", () => {
  it("counts completed psychiatry appointments and assessment steps, with the clients seen", () => {
    const rows = parseClinicalRows([
      [1, "email:a@example.com", ms("2026-11-03T10:00:00Z"), false, "Psychiatry Assessment", null],
      [2, "email:a@example.com", ms("2026-11-20T10:00:00Z"), false, "Follow Up Consultation", null],
      [3, "email:b@example.com", ms("2026-11-04T10:00:00Z"), false, "OCD Consultation + Screening", 92852936],
      [4, "email:c@example.com", ms("2026-11-05T10:00:00Z"), false, "Full ADHD Assessment", null],
      [5, "email:c@example.com", ms("2026-11-06T10:00:00Z"), true, "Full ADHD Assessment", null],
      // Not happened yet.
      [6, "email:d@example.com", ms("2026-11-28T10:00:00Z"), false, "Psychiatry Appointment", null],
      // October.
      [7, "email:e@example.com", ms("2026-10-10T10:00:00Z"), false, "Addiction Assessment", null],
    ]);
    expect(clinicalPeriodTotals(rows, NOVEMBER, NOW)).toEqual({
      psychiatryAppointments: 2,
      psychiatryClients: 1,
      screenings: 1,
      fullAssessments: 1,
      otherAssessments: 0,
      assessmentClients: 2,
    });
    expect(clinicalPeriodTotals(rows, OCTOBER, NOW)).toMatchObject({ otherAssessments: 1, assessmentClients: 1 });
  });
});

describe("adoption period totals", () => {
  const session = (key: string, iso: string): SessionRow => ({
    id: nextId++,
    customerKey: key,
    at: ms(iso),
    createdAt: null,
    kind: "therapy",
    bookedByClient: true,
    calendarId: 1,
    canceled: false,
    category: "individual",
    bookingSource: null,
  });

  it("counts people with a completed session in the period, matched to hub accounts by email", () => {
    const histories = buildHistories([
      session("email:a@example.com", "2026-11-03T10:00:00Z"),
      session("email:b@example.com", "2026-11-04T10:00:00Z"),
      session("phone:0871234567", "2026-11-05T10:00:00Z"),
      session("email:c@example.com", "2026-10-05T10:00:00Z"),
      // Booked, not completed yet.
      session("email:d@example.com", "2026-11-29T10:00:00Z"),
    ]);
    expect(adoptionPeriodTotals(histories, new Set(["a@example.com"]), NOVEMBER, NOW)).toEqual({
      activeCustomers: 3,
      withAccount: 1,
      withoutAccount: 1,
      noEmail: 1,
      adoptionRate: 0.5,
    });
  });
});

describe("parsePeriodsParams", () => {
  it("reads the list, range and comparison", () => {
    expect(parsePeriodsParams(new URLSearchParams("list=leads&from=2026-11-01&to=2026-11-30"))).toEqual({
      list: "leads",
      range: NOVEMBER,
      compareTo: "previous",
      compareRange: { from: "2026-10-02", to: "2026-10-31" },
    });
    expect(
      parsePeriodsParams(new URLSearchParams("list=clinical&from=2026-11-01&to=2026-11-30&compare=custom&cfrom=2026-01-01&cto=2026-01-31"))
    ).toMatchObject({ list: "clinical", compareRange: { from: "2026-01-01", to: "2026-01-31" } });
  });

  it("rejects bad input", () => {
    expect(parsePeriodsParams(new URLSearchParams("list=nope&from=2026-11-01&to=2026-11-30"))).toMatch(/list/);
    expect(parsePeriodsParams(new URLSearchParams("list=leads&from=2026-11-30&to=2026-11-01"))).toMatch(/from first/);
    expect(parsePeriodsParams(new URLSearchParams("list=adoption&from=2026-11-01&to=2026-11-30&compare=custom"))).toMatch(/cfrom/);
  });
});
