import { describe, expect, it } from "vitest";
import {
  type AnalyticsCustomer,
  analyticsQuery,
  boardSettingsToSearch,
  customerHref,
  customersCsv,
  dashedPoints,
  formatCountChange,
  formatPoints,
  isPartialPeriod,
  pointsChange,
  presetRange,
  progressionChartRows,
  readBoardSettings,
} from "./adminAnalytics";
import { type ProgressionPoint, periodEnd } from "../../supabase/functions/admin-analytics/logic.ts";

const TODAY = "2026-10-28";

describe("presetRange", () => {
  it("covers the expected dates up to today", () => {
    expect(presetRange("last7", TODAY)).toEqual({ from: "2026-10-22", to: TODAY });
    expect(presetRange("lastMonth", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("thisQuarter", TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(presetRange("custom", TODAY)).toBeNull();
  });

  it("goes back three calendar months", () => {
    expect(presetRange("last3Months", "2027-01-15")).toEqual({ from: "2026-10-15", to: "2027-01-15" });
    expect(presetRange("last3Months", "2027-05-31")).toEqual({ from: "2027-02-28", to: "2027-05-31" });
  });

  it("starts no earlier than the tracking start", () => {
    expect(presetRange("thisYear", TODAY)).toEqual({ from: "2026-07-29", to: TODAY });
    expect(presetRange("last12Months", TODAY)).toEqual({ from: "2026-07-29", to: TODAY });
    expect(presetRange("thisYear", "2027-03-01")).toEqual({ from: "2027-01-01", to: "2027-03-01" });
  });
});

describe("board settings in the URL", () => {
  it("defaults to the Progression tab and the last 3 months by week", () => {
    const settings = readBoardSettings(new URLSearchParams(), TODAY);
    expect(settings).toMatchObject({
      board: "progression",
      preset: "last3Months",
      range: { from: "2026-07-29", to: TODAY },
      groupBy: "week",
      groupByChosen: false,
      compareTo: "previous",
      windowDays: 30,
      basis: "session",
    });
    expect(boardSettingsToSearch(settings).toString()).toBe("");
  });

  it("round-trips a shared link", () => {
    const search = new URLSearchParams(
      "board=customers&range=custom&from=2026-08-01&to=2026-09-30&group=week&compare=year&window=60&basis=booking&type=couples&calendar=42"
    );
    const settings = readBoardSettings(search, TODAY);
    expect(settings).toMatchObject({
      board: "customers",
      preset: "custom",
      range: { from: "2026-08-01", to: "2026-09-30" },
      groupBy: "week",
      groupByChosen: true,
      compareTo: "year",
      windowDays: 60,
      basis: "booking",
      filters: { category: "couples", calendarId: 42 },
    });
    expect(Object.fromEntries(boardSettingsToSearch(settings))).toEqual(Object.fromEntries(search));
    expect(analyticsQuery(settings)).toBe(
      "from=2026-08-01&to=2026-09-30&group=week&compare=year&window=60&basis=booking&type=couples&calendar=42"
    );
  });

  it("moves a custom start before the tracking start up to it", () => {
    const settings = readBoardSettings(new URLSearchParams("range=custom&from=2026-01-01&to=2026-09-30"), TODAY);
    expect(settings.range).toEqual({ from: "2026-07-29", to: "2026-09-30" });
  });

  it("groups long ranges by month unless a grouping was picked", () => {
    expect(readBoardSettings(new URLSearchParams("range=custom&from=2026-08-01&to=2026-12-31"), TODAY).groupBy).toBe(
      "month"
    );
  });

  it("ignores invalid values", () => {
    const settings = readBoardSettings(
      new URLSearchParams(
        "board=nope&range=custom&from=2026-06-30&to=2026-01-01&window=45&basis=nope&type=family&calendar="
      ),
      TODAY
    );
    expect(settings).toMatchObject({
      board: "progression",
      preset: "last3Months",
      windowDays: 30,
      basis: "session",
      filters: { category: null, calendarId: null },
    });
  });
});

describe("formatting", () => {
  it("shows percentage-point and count changes", () => {
    expect(pointsChange(0.65, 0.608)).toBe(4.2);
    expect(pointsChange(null, 0.5)).toBeNull();
    expect(formatPoints(4.2)).toBe("+4.2 pts");
    expect(formatPoints(-1)).toBe("−1.0 pts");
    expect(formatCountChange(45, 40)).toBe("+5 (+13%)");
    expect(formatCountChange(3, 0)).toBe("+3");
  });
});

describe("progressionChartRows", () => {
  const point = (key: string, rate: number, final: boolean, from = key): ProgressionPoint => ({
    period: { key, from, to: periodEnd(key, "month") },
    stages: [1, 2, 3, 4].map((stage) => ({
      stage: stage as 1,
      cohort: 10,
      progressed: rate * 10,
      rate,
      medianDays: null,
    })),
    final,
    finalOn: key,
  });

  it("draws final periods solid and maturing ones dashed, joined at the last final point", () => {
    const rows = progressionChartRows(
      [point("2026-08-01", 0.5, true), point("2026-09-01", 0.6, true), point("2026-10-01", 0.3, false)],
      "month"
    );
    expect(rows.map((r) => [r.s1, r.s1Maturing])).toEqual([
      [50, null],
      [60, 60],
      [null, 30],
    ]);
  });

  it("draws a partial first period dashed, joined to the first whole one", () => {
    const rows = progressionChartRows(
      [point("2026-08-01", 1, true, "2026-08-30"), point("2026-09-01", 0.6, true), point("2026-10-01", 0.5, true)],
      "month"
    );
    expect(rows.map((r) => [r.s1, r.s1Maturing, r.partial])).toEqual([
      [null, 100, true],
      [60, 60, false],
      [50, null, false],
    ]);
  });
});

describe("isPartialPeriod", () => {
  it("spots a week or month cut off by the range", () => {
    expect(isPartialPeriod({ key: "2026-07-27", from: "2026-07-31", to: "2026-08-02" }, "week")).toBe(true);
    expect(isPartialPeriod({ key: "2026-10-26", from: "2026-10-26", to: "2026-10-28" }, "week")).toBe(true);
    expect(isPartialPeriod({ key: "2026-08-03", from: "2026-08-03", to: "2026-08-09" }, "week")).toBe(false);
    expect(isPartialPeriod({ key: "2026-09-01", from: "2026-09-01", to: "2026-09-30" }, "month")).toBe(false);
  });
});

describe("dashedPoints", () => {
  it("covers faded points and their neighbours", () => {
    expect(dashedPoints([true, false, false, false, true])).toEqual([true, true, false, true, true]);
    expect(dashedPoints([false, false])).toEqual([false, false]);
  });
});

describe("customer lists", () => {
  const customer: AnalyticsCustomer = {
    customerKey: "email:aoife@example.com",
    name: "Aoife, Byrne",
    email: "aoife@example.com",
    phone: "+353 87 123 4567",
    firstSessionAt: "2026-10-05T23:30:00.000Z",
    sessionAt: null,
    sessionType: '=HYPERLINK("x")',
    bookedBy: null,
    portalAccount: false,
    progressionFrom: 1,
  };

  it("links to the Progression page searched for the customer", () => {
    expect(customerHref(customer)).toBe("/admin/progression/1-2?q=aoife%40example.com");
    expect(customerHref({ ...customer, progressionFrom: null })).toBeNull();
  });

  it("exports CSV with Dublin dates, quoting, and formulas defused", () => {
    const [header, row] = customersCsv([customer]).split("\r\n");
    expect(header).toBe("Name,Email,Phone,First session,Session in range,Session type,Booked by,Hub account");
    expect(row).toBe(
      `"Aoife, Byrne",aoife@example.com,'+353 87 123 4567,2026-10-06,,"'=HYPERLINK(""x"")",Not checked yet,No`
    );
  });
});
