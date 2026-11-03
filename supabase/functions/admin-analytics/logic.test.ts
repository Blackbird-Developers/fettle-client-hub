import { describe, expect, it } from "vitest";
import {
  type SessionRow,
  buildHistories,
  comparisonRange,
  customerSeries,
  customerTotals,
  daysInRange,
  defaultGroupBy,
  dublinDate,
  finalOn,
  parseAnalyticsParams,
  returningMinGapDays,
  parseCalendars,
  parseSessionRows,
  periodsInRange,
  progressionPage,
  progressionSeries,
  progressionTotals,
  segmentMembers,
  sessionCategory,
  weekStart,
} from "./logic.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const DAY = 86_400_000;

let nextId = 1;
function session(customer: string, datetime: string, overrides: Partial<SessionRow> = {}): SessionRow {
  const at = Date.parse(datetime);
  return {
    id: nextId++,
    customerKey: customer.includes(":") ? customer : `email:${customer}@example.com`,
    at,
    createdAt: at - 7 * DAY,
    kind: "therapy",
    bookedByClient: true,
    calendarId: 1,
    canceled: false,
    category: "individual",
    bookingSource: null,
    ...overrides,
  };
}

const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };
const OCTOBER = { from: "2026-10-01", to: "2026-10-31" };

describe("dates", () => {
  it("uses the Dublin date, across the clock change", () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in Irish summer time.
    expect(dublinDate(Date.parse("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
    // In winter Dublin is on UTC.
    expect(dublinDate(Date.parse("2026-12-31T23:30:00Z"))).toBe("2026-12-31");
  });

  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-28")).toBe("2026-10-26"); // Wednesday
    expect(weekStart("2026-10-26")).toBe("2026-10-26"); // Monday
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // Sunday
  });

  it("splits a range into weeks or months, clipped to the range", () => {
    expect(periodsInRange({ from: "2026-10-28", to: "2026-11-10" }, "week")).toEqual([
      { key: "2026-10-26", from: "2026-10-28", to: "2026-11-01" },
      { key: "2026-11-02", from: "2026-11-02", to: "2026-11-08" },
      { key: "2026-11-09", from: "2026-11-09", to: "2026-11-10" },
    ]);
    expect(periodsInRange({ from: "2026-01-15", to: "2026-03-01" }, "month").map((p) => p.key)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });

  it("compares with the previous period of the same length, or the same period last year", () => {
    expect(comparisonRange(OCTOBER, "previous")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(daysInRange(OCTOBER)).toBe(31);
    expect(comparisonRange({ from: "2028-02-01", to: "2028-02-29" }, "year")).toEqual({
      from: "2027-02-01",
      to: "2027-02-28",
    });
  });

  it("groups by month over 90 days, by week otherwise", () => {
    expect(defaultGroupBy(OCTOBER)).toBe("week");
    expect(defaultGroupBy({ from: "2026-01-01", to: "2026-10-31" })).toBe("month");
  });
});

describe("parseSessionRows", () => {
  it("reads the compact rows and skips free calls and malformed rows", () => {
    const rows = parseSessionRows([
      [1, "email:a@example.com", 1000, 500, "therapy", true, 3, false, "couples", "hub"],
      [2, "email:a@example.com", 900, null, "excluded", null, 3, false],
      ["bad"],
      [3, "email:a@example.com", 2000, null, "intro", null, null, true, "nope", "nope"],
    ]);
    expect(rows).toEqual([
      { id: 1, customerKey: "email:a@example.com", at: 1000, createdAt: 500, kind: "therapy", bookedByClient: true, calendarId: 3, canceled: false, category: "couples", bookingSource: "hub" },
      { id: 3, customerKey: "email:a@example.com", at: 2000, createdAt: null, kind: "intro", bookedByClient: null, calendarId: null, canceled: true, category: null, bookingSource: null },
    ]);
  });
});

describe("buildHistories", () => {
  it("numbers sessions across the full history, ignoring cancelled ones", () => {
    const [history] = buildHistories([
      session("aoife", "2026-10-10T10:00:00Z"),
      session("aoife", "2025-03-01T10:00:00Z"),
      session("aoife", "2026-01-01T10:00:00Z", { canceled: true }),
      session("aoife", "2026-05-01T10:00:00Z"),
    ]);
    expect(history.sessions.map((s) => [s.date, s.number])).toEqual([
      ["2025-03-01", 1],
      ["2026-05-01", 2],
      ["2026-10-10", 3],
    ]);
  });

  it("only trusts customers with an email", () => {
    const histories = buildHistories([
      session("aoife", "2026-10-01T10:00:00Z"),
      session("phone:353871234567", "2026-10-01T10:00:00Z"),
    ]);
    expect(histories.map((h) => h.verified)).toEqual([true, false]);
  });
});

describe("progression", () => {
  it("counts session N in the period it was completed, progressed if N+1 is within the window", () => {
    const histories = buildHistories([
      // Session 1 on 5 Sep, session 2 on 20 Sep: progressed (15 days).
      session("aoife", "2026-09-05T10:00:00Z"),
      session("aoife", "2026-09-20T10:00:00Z"),
      // Session 1 on 10 Sep, session 2 on 30 Oct (booked, 50 days): not within 30.
      session("brian", "2026-09-10T10:00:00Z"),
      session("brian", "2026-10-30T10:00:00Z"),
      // Session 1 only.
      session("ciara", "2026-09-12T10:00:00Z"),
    ]);
    const totals = progressionTotals(histories, SEPTEMBER, NOW, 30);
    expect(totals.stages[0]).toMatchObject({ stage: 1, cohort: 3, progressed: 1, medianDays: 15 });
    expect(totals.stages[0].rate).toBeCloseTo(1 / 3);
    // Aoife's session 2 is also in September (no session 3).
    expect(totals.stages[1]).toMatchObject({ stage: 2, cohort: 1, progressed: 0 });
    expect(totals.overall).toEqual({ cohort: 4, progressed: 1, rate: 0.25 });

    // With a 60-day window Brian's booked session counts.
    expect(progressionTotals(histories, SEPTEMBER, NOW, 60).stages[0].progressed).toBe(2);
  });

  it("places a client at their true stage even if earlier sessions were long ago", () => {
    const histories = buildHistories([
      session("aoife", "2025-01-01T10:00:00Z"),
      session("aoife", "2025-02-01T10:00:00Z"),
      session("aoife", "2025-03-01T10:00:00Z"),
      session("aoife", "2025-04-01T10:00:00Z"),
      session("aoife", "2026-10-02T10:00:00Z"),
    ]);
    const totals = progressionTotals(histories, OCTOBER, NOW, 30);
    expect(totals.stages.map((s) => s.cohort)).toEqual([0, 0, 0, 0]);
    expect(totals.funnel).toEqual([
      { label: "1", customers: 0 },
      { label: "2", customers: 0 },
      { label: "3", customers: 0 },
      { label: "4", customers: 0 },
      { label: "5+", customers: 1 },
    ]);
  });

  it("only counts completed sessions in a cohort", () => {
    const histories = buildHistories([session("aoife", "2026-10-30T10:00:00Z")]);
    expect(progressionTotals(histories, OCTOBER, NOW, 30).stages[0].cohort).toBe(0);
  });

  it("marks a cohort as still maturing until the window has passed", () => {
    const histories = buildHistories([session("aoife", "2026-10-20T10:00:00Z")]);
    const points = progressionSeries(histories, { from: "2026-10-05", to: "2026-10-25" }, "week", NOW, 30);
    const last = points[points.length - 1];
    expect(last.period.key).toBe("2026-10-19");
    expect(last.stages[0].cohort).toBe(1);
    expect(last.final).toBe(false);
    expect(last.finalOn).toBe("2026-11-25");
    expect(points[0].final).toBe(false); // 11 Oct + 30 days hasn't passed either
    expect(finalOn("2026-09-30", 14)).toBe("2026-10-15");

    const september = progressionTotals(histories, SEPTEMBER, NOW, 14);
    expect(september.final).toBe(true);
    expect(progressionTotals(histories, OCTOBER, NOW, 30).final).toBe(false);
  });

  it("leaves out clients without an email and counts them", () => {
    const histories = buildHistories([
      session("phone:353871234567", "2026-09-05T10:00:00Z"),
      session("appointment:99", "2026-09-06T10:00:00Z"),
      session("aoife", "2026-09-07T10:00:00Z"),
    ]);
    const totals = progressionTotals(histories, SEPTEMBER, NOW, 30);
    expect(totals.stages[0].cohort).toBe(1);
    expect(totals.excludedCustomers).toBe(2);
  });

  it("picks the best and worst stage", () => {
    const histories = buildHistories([
      session("aoife", "2026-09-01T10:00:00Z"),
      session("aoife", "2026-09-08T10:00:00Z"),
      session("aoife", "2026-09-15T10:00:00Z"),
      session("brian", "2026-09-02T10:00:00Z"),
    ]);
    const totals = progressionTotals(histories, SEPTEMBER, NOW, 30);
    // 1→2: 1 of 2; 2→3: 1 of 1; 3→4: 0 of 1.
    expect(totals.best).toBe(2);
    expect(totals.worst).toBe(3);
  });
});

describe("customers", () => {
  it("makes a client new in the month of their first session, not their earlier free call", () => {
    // The Let's Talk call is classified "excluded" and never reaches the logic.
    const rows = parseSessionRows([
      [1, "email:aoife@example.com", Date.parse("2026-03-10T10:00:00Z"), null, "excluded", null, 1, false],
      [2, "email:aoife@example.com", Date.parse("2026-05-10T10:00:00Z"), null, "therapy", true, 1, false],
    ]);
    const histories = buildHistories(rows);
    expect(customerTotals(histories, { from: "2026-03-01", to: "2026-03-31" }, "session").new).toBe(0);
    expect(customerTotals(histories, { from: "2026-05-01", to: "2026-05-31" }, "session").new).toBe(1);
  });

  it("splits new customers by who booked their first session, and counts returning ones", () => {
    const histories = buildHistories([
      session("aoife", "2026-10-05T10:00:00Z", { bookedByClient: true }),
      session("brian", "2026-10-06T10:00:00Z", { bookedByClient: false }),
      session("ciara", "2026-10-07T10:00:00Z", { bookedByClient: null }),
      // Returning: a session before October and one in it.
      session("dara", "2026-06-01T10:00:00Z"),
      session("dara", "2026-10-08T10:00:00Z"),
      // Cancelled session in October: not active.
      session("eoin", "2026-06-01T10:00:00Z"),
      session("eoin", "2026-10-09T10:00:00Z", { canceled: true }),
    ]);
    expect(customerTotals(histories, OCTOBER, "session")).toEqual({
      active: 4,
      new: 3,
      newSelf: 1,
      newStaff: 1,
      newUnknown: 1,
      returning: 1,
      newSelfBySource: { website: 0, hub: 0, acuityPage: 0, mainAccount: 0, notMatched: 1 },
      excludedCustomers: 0,
    });
  });

  it("splits new self-booked customers by where they booked", () => {
    const histories = buildHistories([
      session("aoife", "2026-10-05T10:00:00Z", { bookingSource: "website" }),
      session("brian", "2026-10-06T10:00:00Z", { bookingSource: "hub" }),
      session("ciara", "2026-10-07T10:00:00Z", { bookingSource: "acuity_page" }),
      session("dara", "2026-10-08T10:00:00Z", { bookingSource: "main_account" }),
      session("eoin", "2026-10-09T10:00:00Z", { bookingSource: "main_account" }),
      session("fiona", "2026-10-10T10:00:00Z", { bookingSource: "team", bookedByClient: false }),
    ]);
    expect(customerTotals(histories, OCTOBER, "session")).toMatchObject({
      newSelf: 5,
      newStaff: 1,
      newSelfBySource: { website: 1, hub: 1, acuityPage: 1, mainAccount: 2, notMatched: 0 },
    });
  });

  it("counts by booking date when asked", () => {
    const histories = buildHistories([
      // Booked in September for an October session.
      session("aoife", "2026-10-05T10:00:00Z", { createdAt: Date.parse("2026-09-25T10:00:00Z") }),
    ]);
    expect(customerTotals(histories, SEPTEMBER, "booking").new).toBe(1);
    expect(customerTotals(histories, SEPTEMBER, "session").new).toBe(0);
    expect(customerTotals(histories, OCTOBER, "booking").new).toBe(0);
  });

  it("applies a minimum gap for returning clients", () => {
    const histories = buildHistories([
      session("aoife", "2026-09-25T10:00:00Z"),
      session("aoife", "2026-10-05T10:00:00Z"),
    ]);
    expect(customerTotals(histories, OCTOBER, "session", 0).returning).toBe(1);
    expect(customerTotals(histories, OCTOBER, "session", 60)).toMatchObject({ active: 1, returning: 0 });
  });

  it("leaves out clients without an email", () => {
    const histories = buildHistories([session("phone:353871234567", "2026-10-05T10:00:00Z")]);
    expect(customerTotals(histories, OCTOBER, "session")).toMatchObject({ active: 0, new: 0, excludedCustomers: 1 });
  });

  it("charts new and returning per period, and the self-booking share of all bookings", () => {
    const histories = buildHistories([
      session("aoife", "2026-10-05T10:00:00Z", { createdAt: Date.parse("2026-10-01T10:00:00Z") }),
      session("aoife", "2026-10-14T10:00:00Z", {
        createdAt: Date.parse("2026-10-06T10:00:00Z"),
        bookedByClient: false,
      }),
      session("phone:353871234567", "2026-10-15T10:00:00Z", {
        createdAt: Date.parse("2026-10-07T10:00:00Z"),
        bookedByClient: null,
      }),
    ]);
    const points = customerSeries(histories, { from: "2026-10-05", to: "2026-10-18" }, "week", "session");
    expect(points.map((p) => [p.period.key, p.new, p.returning])).toEqual([
      ["2026-10-05", 1, 0],
      ["2026-10-12", 0, 1],
    ]);
    // Bookings made in the week of 5 Oct: Aoife's second (staff) and the phone-only client's (not checked).
    expect(points[0]).toMatchObject({ bookings: 2, checkedBookings: 1, selfBookings: 0, selfBookingShare: 0 });
  });

  it("lists the customers behind a number, newest first, with the Progression page they're on", () => {
    const histories = buildHistories([
      session("aoife", "2026-10-05T10:00:00Z", { bookedByClient: true }),
      session("brian", "2026-10-10T10:00:00Z", { bookedByClient: false }),
    ]);
    const members = segmentMembers(histories, OCTOBER, "session", "new_self", NOW);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ customerKey: "email:aoife@example.com", progressionFrom: 1 });

    const all = segmentMembers(histories, OCTOBER, "session", "new", NOW);
    expect(all.map((m) => m.customerKey)).toEqual(["email:brian@example.com", "email:aoife@example.com"]);
  });

  it("links to no Progression page when nothing was completed in the last 30 days", () => {
    const [history] = buildHistories([session("aoife", "2026-08-01T10:00:00Z")]);
    expect(progressionPage(history, NOW)).toBeNull();
  });
});

describe("parseAnalyticsParams", () => {
  it("fills in defaults", () => {
    expect(parseAnalyticsParams(new URLSearchParams("from=2026-10-01&to=2026-10-31"))).toEqual({
      range: OCTOBER,
      groupBy: "week",
      compareTo: "previous",
      windowDays: 30,
      basis: "session",
      returning: "all",
      filters: { category: null, calendarId: null },
    });
    expect(
      parseAnalyticsParams(new URLSearchParams("from=2026-10-01&to=2026-10-31&type=couples&calendar=42"))
    ).toMatchObject({ filters: { category: "couples", calendarId: 42 } });
  });

  it("reads who counts as returning", () => {
    const params = parseAnalyticsParams(new URLSearchParams("from=2026-10-01&to=2026-10-31&returning=lapsed"));
    expect(params).toMatchObject({ returning: "lapsed" });
    expect(returningMinGapDays("lapsed")).toBe(60);
    expect(returningMinGapDays("all")).toBe(0);
  });

  it("rejects bad input", () => {
    expect(typeof parseAnalyticsParams(new URLSearchParams("from=2026-10-01&to=2026-10-31&type=family"))).toBe("string");
    expect(typeof parseAnalyticsParams(new URLSearchParams("from=2026-10-01&to=2026-10-31&calendar=x"))).toBe("string");
    expect(typeof parseAnalyticsParams(new URLSearchParams("from=2026-10-31&to=2026-10-01"))).toBe("string");
    expect(typeof parseAnalyticsParams(new URLSearchParams("from=2026-10-01&to=2026-10-31&window=45"))).toBe("string");
    expect(typeof parseAnalyticsParams(new URLSearchParams("from=2020-01-01&to=2026-10-31"))).toBe("string");
    expect(typeof parseAnalyticsParams(new URLSearchParams("from=2026-10-01&to=2026-10-31&returning=x"))).toBe(
      "string"
    );
  });
});

describe("session type and calendar filters", () => {
  it("sorts appointment types into the filter's categories", () => {
    expect(sessionCategory("Individual Session with Jane Topkin", "therapy")).toBe("individual");
    expect(sessionCategory("Couples Therapy with Jane", "therapy")).toBe("couples");
    expect(sessionCategory("Marriage Counselling", "therapy")).toBe("couples");
    expect(sessionCategory("Youth Therapy (12-17)", "therapy")).toBe("youth");
    expect(sessionCategory("Teen Session", "therapy")).toBe("youth");
    expect(sessionCategory("ADHD Assessment", "assessment")).toBe("assessment");
    expect(sessionCategory("Introductory Call", "intro")).toBe("individual");
    expect(sessionCategory("Let's Talk", "excluded")).toBeNull();
  });

  it("counts only matching sessions, but numbers sessions across all of them", () => {
    const rows = [
      // Individual first, couples second: session 2 is the couples one.
      session("aoife", "2026-09-05T10:00:00Z"),
      session("aoife", "2026-10-05T10:00:00Z", { category: "couples" }),
      session("aoife", "2026-10-20T10:00:00Z", { category: "couples" }),
      // New in October, individual only.
      session("brian", "2026-10-10T10:00:00Z"),
    ];
    const couples = buildHistories(rows, { category: "couples", calendarId: null });
    expect(customerTotals(couples, OCTOBER, "session")).toMatchObject({ active: 1, new: 0, returning: 1 });
    // Aoife's couples sessions are her 2nd and 3rd, so they sit in the 2→3
    // and 3→4 stages, not 1→2.
    const stages = progressionTotals(couples, OCTOBER, NOW, 30).stages;
    expect(stages.map((s) => s.cohort)).toEqual([0, 1, 1, 0]);
    expect(stages[1].progressed).toBe(1);

    const unfiltered = buildHistories(rows);
    expect(customerTotals(unfiltered, OCTOBER, "session")).toMatchObject({ active: 2, new: 1, returning: 1 });
  });

  it("filters by calendar", () => {
    const histories = buildHistories(
      [session("aoife", "2026-10-05T10:00:00Z", { calendarId: 7 }), session("brian", "2026-10-06T10:00:00Z")],
      { category: null, calendarId: 7 }
    );
    expect(customerTotals(histories, OCTOBER, "session")).toMatchObject({ active: 1, new: 1 });
    expect(segmentMembers(histories, OCTOBER, "session", "new", NOW).map((m) => m.customerKey)).toEqual([
      "email:aoife@example.com",
    ]);
  });

  it("reads the calendar list, sorted by name", () => {
    expect(parseCalendars([[2, "Zoe"], [1, " Anna "], [3, ""], ["x", "Bad"]])).toEqual([
      { id: 1, name: "Anna" },
      { id: 2, name: "Zoe" },
    ]);
  });
});
