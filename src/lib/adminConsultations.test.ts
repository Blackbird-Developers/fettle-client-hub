import { describe, expect, it } from "vitest";
import {
  canGroupByDay,
  consultationGroupBy,
  consultationsQuery,
  describeConsultationPeriod,
  isConsultationsResponse,
} from "./adminConsultations";

const NOVEMBER = { from: "2026-11-01", to: "2026-11-30" };
const LONG = { from: "2026-07-29", to: "2026-11-26" };

describe("consultationsQuery", () => {
  it("asks for the consultations action with the shared range, window and comparison", () => {
    expect(consultationsQuery(NOVEMBER, "day", 30, { preset: "previous", range: { from: "2026-10-02", to: "2026-10-31" } })).toBe(
      "action=consultations&from=2026-11-01&to=2026-11-30&group=day&window=30&compare=previous"
    );
    expect(consultationsQuery(NOVEMBER, "week", 14, { preset: "custom", range: { from: "2026-09-01", to: "2026-09-30" } })).toBe(
      "action=consultations&from=2026-11-01&to=2026-11-30&group=week&window=14&compare=custom&cfrom=2026-09-01&cto=2026-09-30"
    );
  });
});

describe("grouping", () => {
  it("uses the URL's choice when it suits the range, otherwise the default", () => {
    expect(consultationGroupBy(new URLSearchParams(), NOVEMBER)).toBe("day");
    expect(consultationGroupBy(new URLSearchParams("cgroup=month"), NOVEMBER)).toBe("month");
    expect(consultationGroupBy(new URLSearchParams(), LONG)).toBe("month");
    // Day isn't offered for 121 days, so the default is used.
    expect(canGroupByDay(LONG)).toBe(false);
    expect(consultationGroupBy(new URLSearchParams("cgroup=day"), LONG)).toBe("month");
    expect(consultationGroupBy(new URLSearchParams("cgroup=nope"), NOVEMBER)).toBe("day");
  });

  it("labels a day with its weekday", () => {
    expect(describeConsultationPeriod("2026-11-26", "day")).toBe("Thu 26 Nov 2026");
    expect(describeConsultationPeriod("2026-11-23", "week")).toBe("Week of 23 Nov 2026");
  });
});

describe("isConsultationsResponse", () => {
  it("tells this tab's answer from an older deployment's board numbers", () => {
    expect(isConsultationsResponse({ totals: { segments: {} }, series: [], byCalendar: [] })).toBe(true);
    expect(isConsultationsResponse({ progression: {}, customers: {} })).toBe(false);
    expect(isConsultationsResponse(null)).toBe(false);
  });
});
