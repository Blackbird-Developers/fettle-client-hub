import { describe, expect, it } from "vitest";
import {
  type FunnelSession,
  funnelReport,
  furthestStage,
  parseFunnelParams,
  parseFunnelRows,
  queryBounds,
  sessionPath,
} from "./funnel.ts";

const T = Date.parse("2026-11-10T12:00:00Z");
const range = { from: "2026-11-01", to: "2026-11-30" };
const NO_FILTERS = { flow: null, device: null, path: null, service: null, therapist: null };

const WEBSITE_TO = (last: string) => {
  const all = ["booking_page_view", "step:who", "step:slot", "step:history", "step:details", "step:plan", "step:review", "step:pay", "booking_payment_submitted", "booking_completed"];
  return all.slice(0, all.indexOf(last) + 1);
};

function session(over: Partial<FunnelSession> = {}): FunnelSession {
  return {
    startedAt: T,
    flow: "website",
    bookingFlow: "quiz_v2_time_first",
    device: "mobile",
    clickTherapist: "Lisa Kelly",
    therapist: "Lisa Kelly",
    service: "individual",
    markers: ["booking_page_redirect", ...WEBSITE_TO("booking_completed")],
    failReasons: [],
    referralSource: null,
    utmSource: null,
    ...over,
  };
}

describe("parseFunnelRows", () => {
  it("reads the SQL arrays and skips malformed rows", () => {
    const rows = parseFunnelRows([
      [T, "website", "quiz_v2_time_first", "mobile", "Lisa Kelly", "Lisa Kelly", "Couples", ["booking_page_view"], [], "Google", null],
      [T, "app", null, null, null, null, null, [], [], null, null],
      "junk",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ flow: "website", service: "couples", referralSource: "Google", markers: ["booking_page_view"] });
  });
});

describe("furthestStage and paths", () => {
  it("counts skipped steps as passed", () => {
    // no "who", no "history" (one-service therapist, returning hub client)
    expect(furthestStage(["booking_page_view", "step:slot", "step:details"])).toBe("details");
  });

  it("puts details_submitted at the plan stage and failures at Pressed Pay", () => {
    expect(furthestStage(["booking_page_view", "booking_details_submitted"])).toBe("plan");
    expect(furthestStage(["booking_page_view", "step:pay", "booking_payment_failed"])).toBe("paid");
  });

  it("leaves out sessions that never opened a booking form", () => {
    expect(furthestStage(["booking_page_redirect"])).toBeNull();
    expect(furthestStage(["booking_bundle_purchased"])).toBeNull();
  });

  it("tells matching and psychologist paths apart", () => {
    expect(sessionPath(session({ markers: ["booking_page_view", "step:topics", "step:matches"] }))).toBe("matching");
    expect(sessionPath(session({ markers: ["booking_page_view", "step:consultation"] }))).toBe("psychologist");
    expect(sessionPath(session())).toBe("therapist");
  });
});

describe("funnelReport", () => {
  const sessions = [
    session(), // booked
    session({ markers: ["booking_page_redirect", ...WEBSITE_TO("step:slot")] }), // left at date & time
    session({ markers: ["booking_page_redirect", ...WEBSITE_TO("step:slot")], device: "desktop" }),
    session({ clickTherapist: "Judith Malone", therapist: "Judith Malone", markers: ["booking_page_redirect", ...WEBSITE_TO("step:pay"), "booking_payment_failed"], failReasons: ["slot_unavailable"] }),
    // website bundle hand-off, then bought in the hub
    session({ markers: [...WEBSITE_TO("step:plan"), "booking_bundle_handoff", "booking_bundle_purchased"], clickTherapist: null }),
    // matching, ends with a suggested therapist
    session({ clickTherapist: null, therapist: "Aoife Byrne", markers: ["booking_page_view", "step:who", "step:topics", "step:matches", "step:slot"] }),
    // outside the range
    session({ startedAt: Date.parse("2026-10-15T12:00:00Z") }),
    // hub Packages purchase with no booking form
    session({ flow: "hub", clickTherapist: null, therapist: null, markers: ["booking_bundle_purchased"] }),
  ];

  const report = funnelReport(sessions, { range, filters: NO_FILTERS });

  it("counts each stage as reached-or-further, from opened", () => {
    const byStage = Object.fromEntries(report.stages.map((s) => [s.stage, s.sessions]));
    // The bundle buyer goes plan → booked, so counts as passing review / pay / paid (skipped on the website).
    expect(byStage).toMatchObject({ opened: 6, started: 6, slot: 6, history: 3, details: 3, plan: 3, review: 3, pay: 3, paid: 3, booked: 2 });
    expect(report.stages[0].fromPrevious).toBeNull();
    expect(report.stages[3]).toMatchObject({ stage: "history", fromPrevious: 50, fromStart: 50 });
  });

  it("finds the biggest drop", () => {
    expect(report.biggestDrop).toMatchObject({ stage: "history", lost: 3, lostPct: 50 });
  });

  it("splits outcomes and leaves the Packages-only purchase out of the funnel", () => {
    expect(report.sessions).toBe(7);
    expect(report.outcomes).toEqual({ sessionsBooked: 1, bundleHandoffs: 1, bundlesBought: 1 });
    expect(report.bookNowClicks).toBe(4);
  });

  it("ranks therapists by sessions, with clicks by card and matched picks", () => {
    const lisa = report.therapists.find((t) => t.therapist === "Lisa Kelly")!;
    expect(lisa).toMatchObject({ clicks: 3, opened: 4, reachedPayment: 2, booked: 2, conversion: 50 });
    expect(report.therapists[0].therapist).toBe("Lisa Kelly");
    expect(report.therapists.find((t) => t.therapist === "Aoife Byrne")).toMatchObject({ opened: 1, matched: 1, clicks: 0 });
    expect(report.therapists.find((t) => t.therapist === "Judith Malone")).toMatchObject({ reachedPayment: 1, booked: 0 });
  });

  it("counts failure reasons, paths and devices", () => {
    expect(report.failReasons).toEqual([{ reason: "slot_unavailable", sessions: 1 }]);
    expect(report.byPath.find((p) => p.path === "matching")).toMatchObject({ opened: 1, booked: 0 });
    expect(report.byDevice.find((d) => d.device === "desktop")).toMatchObject({ opened: 1, booked: 0, conversion: 0 });
  });

  it("draws a daily series for a month", () => {
    expect(report.groupBy).toBe("day");
    expect(report.series).toHaveLength(30);
    expect(report.series.find((p) => p.key === "2026-11-10")).toMatchObject({ opened: 6, booked: 2 });
  });

  it("filters by therapist but keeps the full therapist list for the dropdown", () => {
    const r = funnelReport(sessions, { range, filters: { ...NO_FILTERS, therapist: "Judith Malone" } });
    expect(r.stages[0].sessions).toBe(1);
    expect(r.options.therapists).toEqual(["Aoife Byrne", "Judith Malone", "Lisa Kelly"]);
  });

  it("filters by flow and path", () => {
    expect(funnelReport(sessions, { range, filters: { ...NO_FILTERS, flow: "hub" } }).stages[0].sessions).toBe(0);
    expect(funnelReport(sessions, { range, filters: { ...NO_FILTERS, path: "matching" } }).stages[0].sessions).toBe(1);
  });

  it("handles no data", () => {
    const r = funnelReport([], { range, filters: NO_FILTERS });
    expect(r.biggestDrop).toBeNull();
    expect(r.stages.every((s) => s.sessions === 0 && s.fromStart === null)).toBe(true);
  });

  it("groups by week for long ranges", () => {
    const r = funnelReport(sessions, { range: { from: "2026-09-01", to: "2026-11-30" }, filters: NO_FILTERS });
    expect(r.groupBy).toBe("week");
    expect(r.series[0].key).toBe("2026-08-31");
  });
});

describe("params", () => {
  it("reads and checks the query string", () => {
    expect(parseFunnelParams(new URLSearchParams("from=2026-11-01&to=2026-11-30&flow=website&path=matching&therapist=Lisa%20Kelly")))
      .toEqual({ range, filters: { flow: "website", device: null, path: "matching", service: null, therapist: "Lisa Kelly" } });
    expect(parseFunnelParams(new URLSearchParams("from=2026-11-30&to=2026-11-01"))).toMatch(/from first/);
    expect(parseFunnelParams(new URLSearchParams("from=2025-01-01&to=2026-11-30"))).toMatch(/one year/);
    expect(parseFunnelParams(new URLSearchParams("from=2026-11-01&to=2026-11-30&flow=app"))).toMatch(/flow/);
  });

  it("widens the SQL bounds around the Dublin dates", () => {
    expect(queryBounds(range)).toEqual({ from: "2026-10-31T00:00:00Z", to: "2026-12-02T00:00:00Z" });
  });
});
