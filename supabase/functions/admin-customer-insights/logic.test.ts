import { describe, expect, it } from "vitest";
import {
  type AcuityAppointment,
  type HistoryCheck,
  DAY_MS,
  buildAdoptionView,
  buildPortalEmailSet,
  buildProgressionView,
  classifyAppointmentType,
  evaluateHistory,
  fetchAppointmentsInWindows,
  groupCustomers,
  matchPortalAccount,
  normalizeEmail,
  phoneKey,
  progressionCandidates,
  scoreAdoption,
  scoreProgression,
  summarizeUnknownTypes,
} from "./logic.ts";

const NOW = Date.parse("2026-09-30T12:00:00Z");
const THERAPY = "Individual Session with Jane Topkin";
const INTRO_CALL = "Introductory Call with Jane Topkin";
const SCREENING = "OCD Assessment Screening";
const MATCHING_CALL = "Therapist Matching Service";

let nextId = 1;
function appt(daysFromNow: number, overrides: Partial<AcuityAppointment> = {}): AcuityAppointment {
  return {
    id: nextId++,
    firstName: "Aoife",
    lastName: "Byrne",
    email: "aoife@example.com",
    phone: "087 123 4567",
    datetime: new Date(NOW + daysFromNow * DAY_MS).toISOString(),
    type: THERAPY,
    canceled: false,
    ...overrides,
  };
}

const verified = (hasEarlierSession = false): HistoryCheck => ({
  status: "verified",
  hasEarlierSession,
});

describe("classifyAppointmentType", () => {
  it.each([
    ["Individual Session with Jane Topkin", "therapy"],
    ["Individual Therapy Session (Anxiety)", "therapy"],
    ["Couple's Therapy Session with Ana Moore", "therapy"],
    ["Youth Therapy - Individual Session with Emma Hand", "therapy"],
    ["Youth Therapy - Introductory Appointment (Guardian + Child) with Emma Hand", "therapy"],
    ["Get Matched - Discovery Therapy Session", "therapy"],
    ["VHI Therapy", "therapy"],
    ["Teenager Counselling Session with Doreen Maher", "therapy"],
    ["1:1 Therapy Session (Fettle for Business)", "therapy"],
    ["OCD Assessment Screening", "assessment"],
    ["Full Anxiety Assessment ", "assessment"],
    ["Psychiatry Appointment", "assessment"],
    ["Follow Up Consultation", "assessment"],
    ["Introductory Call with Jane Topkin", "intro"],
    ["Therapist Introductory Call", "intro"],
    ["Fettle Introduction Chat", "excluded"],
    ["Let’s Talk - Finding your Path", "excluded"],
    ["Let's Talk - Finding your Path (Courtney)", "excluded"],
    ["Therapist Matching Service €10", "excluded"],
    ["Internal Call - Alex Hamm", "excluded"],
    ["Fettle for Business Introduction", "excluded"],
    ["Live Zoom Demo: Fettle for Business", "excluded"],
    ["6-Week Weight Loss Programme Consultation", "excluded"],
    ["DEMO: Workplace Conflict Resolution", "excluded"],
    ["Coaching Session with Nicole Dunne", "excluded"],
    ["Online Pilates Class", "excluded"],
    ["Individual Session with Paul (Testing)", "excluded"],
    ["Something brand new", "unknown"],
    ["", "unknown"],
  ])("%s → %s", (type, kind) => {
    expect(classifyAppointmentType(type)).toBe(kind);
  });

  it("summarises unknown types without personal data", () => {
    const summary = summarizeUnknownTypes([
      appt(-1, { type: "Mystery" }),
      appt(-2, { type: "Mystery" }),
      appt(-3, { type: THERAPY }),
    ]);
    expect(summary).toEqual([{ type: "Mystery", count: 2 }]);
  });
});

describe("normalisation and matching", () => {
  it("trims and lower-cases emails, rejecting blanks and junk", () => {
    expect(normalizeEmail("  Aoife@Example.COM ")).toBe("aoife@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("not an email")).toBeNull();
  });

  it("collapses Irish phone formats into one key", () => {
    expect(phoneKey("087 123 4567")).toBe("353871234567");
    expect(phoneKey("+353 87 123 4567")).toBe("353871234567");
    expect(phoneKey("00353871234567")).toBe("353871234567");
    expect(phoneKey("123")).toBeNull();
  });

  it("matches portal accounts by normalised email only", () => {
    const portal = buildPortalEmailSet(["AOIFE@example.com ", null, "bad"]);
    expect(matchPortalAccount({ email: "aoife@example.com" }, portal)).toBe("has_account");
    expect(matchPortalAccount({ email: "other@example.com" }, portal)).toBe("no_account");
    expect(matchPortalAccount({ email: null }, portal)).toBe("no_email");
  });
});

describe("groupCustomers", () => {
  it("deduplicates appointments and merges email spellings into one customer", () => {
    const a = appt(-3, { email: "Aoife@Example.com" });
    const customers = groupCustomers([a, a, appt(-1, { email: "aoife@example.com " })]);
    expect(customers).toHaveLength(1);
    expect(customers[0].appointments).toHaveLength(2);
    expect(customers[0].email).toBe("aoife@example.com");
  });

  it("drops cancelled appointments", () => {
    const customers = groupCustomers([appt(-3, { canceled: true })]);
    expect(customers).toHaveLength(0);
  });

  it("uses the most recent name and phone", () => {
    const [customer] = groupCustomers([
      appt(-10, { firstName: "Old", phone: "0851111111" }),
      appt(-2, { firstName: "New", phone: "" }),
    ]);
    expect(customer.name).toBe("New Byrne");
    expect(customer.phone).toBe("0851111111");
  });

  it("falls back to phone, then appointment id, when email is missing", () => {
    const customers = groupCustomers([
      appt(-3, { email: "", phone: "087 123 4567" }),
      appt(-2, { email: null, phone: "+353871234567" }),
      appt(-1, { email: "", phone: "" }),
    ]);
    expect(customers).toHaveLength(2);
    const byPhone = customers.find((c) => c.key === "phone:353871234567");
    expect(byPhone?.appointments).toHaveLength(2);
    expect(customers.some((c) => c.key.startsWith("appointment:"))).toBe(true);
  });
});

describe("scoring", () => {
  it("scores adoption rows", () => {
    const base = { portalStatus: "no_account" as const };
    expect(scoreAdoption({ ...base, daysSinceLastSession: 3, hasUpcomingSession: false })).toBe("A");
    expect(scoreAdoption({ ...base, daysSinceLastSession: 14, hasUpcomingSession: false })).toBe("A");
    expect(scoreAdoption({ ...base, daysSinceLastSession: 15, hasUpcomingSession: false })).toBe("B");
    expect(scoreAdoption({ ...base, daysSinceLastSession: 3, hasUpcomingSession: true })).toBe("C");
    expect(scoreAdoption({ ...base, daysSinceLastSession: 20, hasUpcomingSession: true })).toBe("D");
    expect(
      scoreAdoption({ portalStatus: "no_email", daysSinceLastSession: 1, hasUpcomingSession: false })
    ).toBe("E");
  });

  it("scores progression rows at the 7 and 14 day boundaries", () => {
    const none = "none" as const;
    expect(scoreProgression({ secondSessionStatus: none, daysSinceFirstSession: 14 })).toBe("A");
    expect(scoreProgression({ secondSessionStatus: none, daysSinceFirstSession: 13 })).toBe("B");
    expect(scoreProgression({ secondSessionStatus: none, daysSinceFirstSession: 7 })).toBe("B");
    expect(scoreProgression({ secondSessionStatus: none, daysSinceFirstSession: 6 })).toBe("C");
    expect(scoreProgression({ secondSessionStatus: "booked", daysSinceFirstSession: 20 })).toBe("D");
    expect(scoreProgression({ secondSessionStatus: "completed", daysSinceFirstSession: 20 })).toBe("E");
  });
});

describe("buildAdoptionView", () => {
  it("lists recently active customers without a portal account", () => {
    const customers = groupCustomers([
      appt(-5, { email: "member@example.com" }),
      appt(-5, { email: "new@example.com" }),
      appt(-20, { email: "later@example.com" }),
      appt(3, { email: "later@example.com" }),
    ]);
    const view = buildAdoptionView(customers, buildPortalEmailSet(["Member@example.com"]), NOW);

    expect(view.totals).toMatchObject({ activeCustomers: 3, withAccount: 1, withoutAccount: 2 });
    expect(view.rows.map((r) => [r.email, r.grade])).toEqual([
      ["new@example.com", "A"],
      ["later@example.com", "D"],
    ]);
    expect(view.rows[1].nextSessionAt).not.toBeNull();
  });

  it("applies the 30-day window and ignores cancelled, future-only and excluded appointments", () => {
    const customers = groupCustomers([
      appt(-31, { email: "old@example.com" }),
      appt(-5, { email: "cancelled@example.com", canceled: true }),
      appt(2, { email: "futureonly@example.com" }),
      appt(-2, { email: "matching@example.com", type: MATCHING_CALL }),
      appt(-3, { email: "intro@example.com", type: INTRO_CALL }),
      appt(-2, { email: "assessed@example.com", type: SCREENING }),
    ]);
    const view = buildAdoptionView(customers, new Set(), NOW);
    expect(view.rows.map((r) => r.email)).toEqual(["assessed@example.com", "intro@example.com"]);
  });

  it("surfaces customers without email as grade E", () => {
    const customers = groupCustomers([appt(-2, { email: "", phone: "" })]);
    const view = buildAdoptionView(customers, new Set(), NOW);
    expect(view.totals.noEmail).toBe(1);
    expect(view.totals.noPhone).toBe(1);
    expect(view.rows[0]).toMatchObject({ portalStatus: "no_email", grade: "E" });
  });
});

describe("evaluateHistory", () => {
  const first = NOW - 5 * DAY_MS;

  it("confirms a first-timer when history is complete and has no earlier session", () => {
    const check = evaluateHistory(
      {
        appointments: [
          appt(-40, { type: MATCHING_CALL }),
          appt(-50, { canceled: true }),
          appt(-1), // the in-window session itself isn't "earlier"
        ],
        limit: 100,
      },
      first
    );
    expect(check).toEqual({ status: "verified", hasEarlierSession: false });
  });

  it("detects an earlier session, including intro calls", () => {
    expect(evaluateHistory({ appointments: [appt(-90)], limit: 100 }, first)).toEqual({
      status: "verified",
      hasEarlierSession: true,
    });
    expect(
      evaluateHistory({ appointments: [appt(-40, { type: INTRO_CALL })], limit: 100 }, first)
    ).toEqual({ status: "verified", hasEarlierSession: true });
  });

  it("an earlier session on a full page is still conclusive", () => {
    const check = evaluateHistory({ appointments: [appt(-90), appt(-80)], limit: 2 }, first);
    expect(check).toEqual({ status: "verified", hasEarlierSession: true });
  });

  it("refuses to confirm when the lookup hit its limit", () => {
    const full = Array.from({ length: 3 }, () => appt(-40, { type: MATCHING_CALL }));
    expect(evaluateHistory({ appointments: full, limit: 3 }, first)).toEqual({
      status: "unverified",
      reason: "history_truncated",
    });
  });

  it("refuses to confirm when the lookup failed or there is no email", () => {
    expect(evaluateHistory({ appointments: null, limit: 100 }, first)).toEqual({
      status: "unverified",
      reason: "lookup_failed",
    });
    expect(evaluateHistory(null, first)).toEqual({ status: "unverified", reason: "no_email" });
  });
});

describe("buildProgressionView", () => {
  function run(appointments: AcuityAppointment[], history: Record<string, HistoryCheck> = {}) {
    const customers = groupCustomers(appointments);
    const candidates = progressionCandidates(customers, NOW);
    const checks = new Map(
      candidates.map((c) => [c.customer.key, history[c.customer.key] ?? verified()])
    );
    return buildProgressionView(candidates, checks, new Set(["member@example.com"]), NOW);
  }

  it("detects a completed second session", () => {
    const view = run([appt(-20), appt(-10)]);
    expect(view.rows[0]).toMatchObject({
      secondSessionStatus: "completed",
      daysSinceFirstSession: 20,
      grade: "E",
    });
  });

  it("detects a booked second session and ignores cancelled bookings", () => {
    const booked = run([appt(-10), appt(4, { canceled: true }), appt(6)]);
    expect(booked.rows[0]).toMatchObject({ secondSessionStatus: "booked", grade: "D" });

    const cancelledOnly = run([appt(-10), appt(4, { canceled: true })]);
    expect(cancelledOnly.rows[0]).toMatchObject({
      secondSessionStatus: "none",
      secondSessionAt: null,
      grade: "B",
    });
  });

  it("counts an intro call as the first session and reports session types", () => {
    const view = run([appt(-12, { type: INTRO_CALL }), appt(-3)]);
    expect(view.rows[0]).toMatchObject({
      daysSinceFirstSession: 12,
      firstSessionType: INTRO_CALL,
      secondSessionStatus: "completed",
      secondSessionType: THERAPY,
    });
  });

  it("counts assessments as sessions but never matching calls", () => {
    const assessed = run([appt(-10, { type: SCREENING }), appt(5, { type: SCREENING })]);
    expect(assessed.rows[0]).toMatchObject({ secondSessionStatus: "booked" });

    const matching = run([appt(-12, { type: MATCHING_CALL }), appt(-3), appt(4, { type: MATCHING_CALL })]);
    expect(matching.rows[0]).toMatchObject({ daysSinceFirstSession: 3, secondSessionStatus: "none" });
  });

  it("excludes returning customers and customers outside the window", () => {
    const view = run(
      [appt(-10), appt(-40, { email: "old@example.com" })],
      { "email:aoife@example.com": verified(true) }
    );
    expect(view.rows).toHaveLength(0);
    expect(view.totals.returningCustomers).toBe(1);
  });

  it("keeps unverified customers visible but ungraded, after graded rows", () => {
    const view = run(
      [appt(-20, { email: "unknown@example.com" }), appt(-2)],
      { "email:unknown@example.com": { status: "unverified", reason: "history_truncated" } }
    );
    expect(view.rows.map((r) => [r.email, r.grade, r.historyStatus])).toEqual([
      ["aoife@example.com", "C", "verified"],
      ["unknown@example.com", null, "unverified"],
    ]);
    expect(view.rows[1].historyNote).toMatch(/confirm/);
    expect(view.totals).toMatchObject({ firstTimers: 1, unverified: 1 });
  });

  it("reports portal status for each row", () => {
    const view = run([appt(-3, { email: "Member@Example.com" })]);
    expect(view.rows[0].portalStatus).toBe("has_account");
  });
});

describe("fetchAppointmentsInWindows", () => {
  it("splits full chunks until each fits and deduplicates by id", async () => {
    // Two appointments per day from Sep 1–Sep 8, limit 5 per request.
    const all = Array.from({ length: 16 }, (_, i) => ({
      ...appt(0),
      id: 1000 + i,
      datetime: `2026-09-0${Math.floor(i / 2) + 1}T10:00:00Z`,
    }));
    const calls: string[] = [];
    const fetchRange = async (from: string, to: string) => {
      calls.push(`${from}..${to}`);
      return all.filter((a) => a.datetime.slice(0, 10) >= from && a.datetime.slice(0, 10) <= to);
    };

    const result = await fetchAppointmentsInWindows(fetchRange, "2026-09-01", "2026-09-08", {
      limit: 5,
      chunkDays: 8,
      concurrency: 2,
    });
    expect(result.appointments).toHaveLength(16);
    expect(result.incompleteDates).toEqual([]);
    expect(calls[0]).toBe("2026-09-01..2026-09-08");
  });

  it("reports a single day that is still full as incomplete", async () => {
    const fetchRange = async () => [appt(0), appt(0)];
    const result = await fetchAppointmentsInWindows(fetchRange, "2026-09-01", "2026-09-02", {
      limit: 2,
      chunkDays: 1,
      concurrency: 1,
    });
    expect(result.incompleteDates).toEqual(["2026-09-01", "2026-09-02"]);
  });
});
