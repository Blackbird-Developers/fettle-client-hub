import { describe, expect, it } from "vitest";
import {
  type ConsultationRow,
  callOutcome,
  consultationReport,
  consultationSeries,
  consultationsByCalendar,
  defaultConsultationGroupBy,
  freeCallType,
  outcomesIn,
  parseConsultationParams,
  parseConsultationRows,
} from "./consultations.ts";
import { type SessionRow, buildHistories } from "./logic.ts";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };

let nextId = 1;

function call(customer: string, datetime: string, overrides: Partial<ConsultationRow> = {}): ConsultationRow {
  return {
    id: nextId++,
    customerKey: `email:${customer}@example.com`,
    at: Date.parse(datetime),
    canceled: false,
    type: "lets_talk",
    calendarId: 7,
    calendar: "Courtney",
    noShow: false,
    ...overrides,
  };
}

function session(customer: string, datetime: string, bookedAt: string | null): SessionRow {
  return {
    id: nextId++,
    customerKey: `email:${customer}@example.com`,
    at: Date.parse(datetime),
    createdAt: bookedAt === null ? null : Date.parse(bookedAt),
    kind: "therapy",
    bookedByClient: true,
    calendarId: 1,
    canceled: false,
    category: "individual",
    bookingSource: null,
  };
}

const historyOf = (...rows: SessionRow[]) => buildHistories(rows)[0];

describe("rows", () => {
  it("recognises Let's Talk and Introduction Chat, with either apostrophe", () => {
    expect(freeCallType("Let's Talk (20 mins)")).toBe("lets_talk");
    expect(freeCallType("Let’s Talk")).toBe("lets_talk");
    expect(freeCallType("Fettle Introduction Chat")).toBe("intro_chat");
    expect(freeCallType("Introductory Call")).toBeNull();
    expect(freeCallType(null)).toBeNull();
  });

  it("reads compact rows and the No Show label, skipping anything malformed", () => {
    const rows = parseConsultationRows([
      [1, "email:a@example.com", 1000, 900, false, "Let's Talk", 7, " Courtney ", ["No Show "]],
      [2, "email:b@example.com", 2000, null, true, "Fettle Introduction Chat", null, null, []],
      [3, "email:c@example.com", 3000, null, false, "Individual Therapy", 7, "Alex", []],
      ["x", "email:d@example.com", 4000],
      "nope",
    ]);
    expect(rows).toEqual([
      { id: 1, customerKey: "email:a@example.com", at: 1000, canceled: false, type: "lets_talk", calendarId: 7, calendar: "Courtney", noShow: true },
      { id: 2, customerKey: "email:b@example.com", at: 2000, canceled: true, type: "intro_chat", calendarId: null, calendar: null, noShow: false },
    ]);
    expect(parseConsultationRows(null)).toEqual([]);
  });
});

describe("one call", () => {
  it("is upcoming, a no-show or attended", () => {
    expect(callOutcome(call("a", "2026-11-28T10:00:00Z"), undefined, NOW, 30).status).toBe("upcoming");
    expect(callOutcome(call("a", "2026-11-20T10:00:00Z", { noShow: true }), undefined, NOW, 30).status).toBe("no_show");
    expect(callOutcome(call("a", "2026-11-20T10:00:00Z"), undefined, NOW, 30).status).toBe("attended");
  });

  it("is from an existing customer when they had a paid session before the call", () => {
    const history = historyOf(session("a", "2026-06-01T10:00:00Z", "2026-05-20T10:00:00Z"));
    expect(callOutcome(call("a", "2026-11-20T10:00:00Z"), history, NOW, 30).existing).toBe(true);
    const later = historyOf(session("b", "2026-11-25T10:00:00Z", "2026-11-21T10:00:00Z"));
    expect(callOutcome(call("b", "2026-11-20T10:00:00Z"), later, NOW, 30).existing).toBe(false);
  });

  it("converts when a paid session is booked after the call, within the window", () => {
    const at = "2026-10-01T10:00:00Z";
    const booked = (bookedAt: string | null, sessionAt = "2026-10-20T10:00:00Z") =>
      callOutcome(call("a", at), historyOf(session("a", sessionAt, bookedAt)), NOW, 30);
    expect(booked("2026-10-01T10:30:00Z").converted).toBe(true);
    expect(booked("2026-10-31T09:00:00Z").converted).toBe(true);
    // Booked 31 days later: outside a 30-day window.
    expect(booked("2026-11-01T11:00:00Z", "2026-11-10T10:00:00Z").converted).toBe(false);
    // Booked before the call: that's not the call converting.
    expect(booked("2026-09-25T10:00:00Z").converted).toBe(false);
    // No booking time: when the session takes place is used instead.
    expect(booked(null).converted).toBe(true);
  });

  it("never converts a no-show, and is maturing while the window is open", () => {
    const history = historyOf(session("a", "2026-11-24T10:00:00Z", "2026-11-21T10:00:00Z"));
    expect(callOutcome(call("a", "2026-11-20T10:00:00Z", { noShow: true }), history, NOW, 30).converted).toBe(false);
    const open = callOutcome(call("b", "2026-11-20T10:00:00Z"), undefined, NOW, 30);
    expect(open).toMatchObject({ converted: false, maturing: true });
    expect(callOutcome(call("b", "2026-09-20T10:00:00Z"), undefined, NOW, 30).maturing).toBe(false);
  });
});

describe("report", () => {
  const calls = [
    // New, attended, converted.
    call("new1", "2026-11-03T10:00:00Z"),
    // New, no-show.
    call("new2", "2026-11-04T10:00:00Z", { noShow: true }),
    // Existing, attended, not converted.
    call("old1", "2026-11-04T15:00:00Z", { type: "intro_chat", calendarId: 8, calendar: "Alex" }),
    // Upcoming.
    call("new3", "2026-11-29T10:00:00Z"),
    // Cancelled: never counts.
    call("new4", "2026-11-05T10:00:00Z", { canceled: true }),
    // October, for the comparison.
    call("oct1", "2026-10-10T10:00:00Z"),
  ];
  const histories = buildHistories([
    session("new1", "2026-11-10T10:00:00Z", "2026-11-03T11:00:00Z"),
    session("old1", "2026-03-01T10:00:00Z", "2026-02-20T10:00:00Z"),
  ]);
  const params = {
    range: NOVEMBER,
    compareRange: { from: "2026-10-01", to: "2026-10-31" },
    compareTo: "custom" as const,
    groupBy: "week" as const,
    windowDays: 30,
  };

  it("adds up booked, no-shows, attended, new vs existing and conversion", () => {
    const { totals, compare } = consultationReport({ calls, histories, params, now: NOW });
    expect(totals).toMatchObject({
      booked: 4,
      upcoming: 1,
      noShows: 1,
      attended: 2,
      converted: 1,
      conversionRate: 0.5,
      noShowRate: 1 / 3,
      people: 4,
      newCalls: 3,
      existingCalls: 1,
      byType: [
        { type: "lets_talk", booked: 3 },
        { type: "intro_chat", booked: 1 },
      ],
    });
    expect(totals.segments.new).toMatchObject({ booked: 3, attended: 1, converted: 1, conversionRate: 1 });
    expect(totals.segments.existing).toMatchObject({ booked: 1, attended: 1, converted: 0, conversionRate: 0 });
    expect(compare).toMatchObject({ booked: 1, attended: 1, converted: 0 });
  });

  it("draws every day, week or month in the range, empty ones included", () => {
    const outcomes = outcomesIn(calls, new Map(histories.map((h) => [h.key, h])), NOVEMBER, NOW, 30);
    const days = consultationSeries(outcomes, NOVEMBER, "day");
    expect(days).toHaveLength(30);
    expect(days[3]).toMatchObject({ key: "2026-11-04", booked: 2, noShows: 1, attended: 1, newCalls: 1, existingCalls: 1 });
    expect(days[0].booked).toBe(0);
    const weeks = consultationSeries(outcomes, NOVEMBER, "week");
    expect(weeks[0]).toMatchObject({ key: "2026-10-26", from: "2026-11-01", to: "2026-11-01", booked: 0 });
    expect(weeks[1]).toMatchObject({ key: "2026-11-02", booked: 3, converted: 1 });
  });

  it("splits the calls by calendar, busiest first", () => {
    const outcomes = outcomesIn(calls, new Map(histories.map((h) => [h.key, h])), NOVEMBER, NOW, 30);
    expect(consultationsByCalendar(outcomes).map((c) => [c.calendar, c.booked, c.attended])).toEqual([
      ["Courtney", 3, 1],
      ["Alex", 1, 1],
    ]);
  });
});

describe("parseConsultationParams", () => {
  it("fills in defaults, grouping short ranges by day", () => {
    expect(parseConsultationParams(new URLSearchParams("from=2026-11-01&to=2026-11-30"))).toEqual({
      range: NOVEMBER,
      groupBy: "day",
      windowDays: 30,
      compareTo: "previous",
      compareRange: { from: "2026-10-02", to: "2026-10-31" },
    });
    expect(defaultConsultationGroupBy({ from: "2026-09-01", to: "2026-11-30" })).toBe("week");
    expect(defaultConsultationGroupBy({ from: "2026-01-01", to: "2026-11-30" })).toBe("month");
  });

  it("reads the window, grouping and a custom comparison", () => {
    expect(
      parseConsultationParams(
        new URLSearchParams("from=2026-11-01&to=2026-11-30&group=week&window=14&compare=custom&cfrom=2026-10-04&cto=2026-11-02")
      )
    ).toMatchObject({ groupBy: "week", windowDays: 14, compareTo: "custom", compareRange: { from: "2026-10-04", to: "2026-11-02" } });
  });

  it("rejects bad input", () => {
    const parse = (query: string) => parseConsultationParams(new URLSearchParams(query));
    expect(parse("from=2026-11-30&to=2026-11-01")).toMatch(/from first/);
    expect(parse("from=2026-11-01&to=2026-11-30&group=year")).toMatch(/group/);
    expect(parse("from=2026-01-01&to=2026-11-30&group=day")).toMatch(/per day/);
    expect(parse("from=2026-11-01&to=2026-11-30&window=45")).toMatch(/window/);
    expect(parse("from=2026-11-01&to=2026-11-30&compare=custom")).toMatch(/cfrom/);
  });
});
