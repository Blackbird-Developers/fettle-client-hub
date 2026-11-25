import { describe, expect, it } from "vitest";
import {
  type MarketingDay,
  CHANNELS,
  channelsMissingStart,
  marketingReport,
  marketingSeries,
  marketingTotals,
  parseMarketingParams,
  parseMarketingRows,
  parseSyncState,
  spanningRange,
} from "./marketing.ts";

const range = { from: "2026-11-01", to: "2026-11-30" };

function day(over: Partial<MarketingDay> = {}): MarketingDay {
  return {
    day: "2026-11-10",
    channel: "meta",
    currency: "EUR",
    spend: 100,
    impressions: 10_000,
    clicks: 200,
    outboundClicks: 120,
    conversions: 4,
    conversionValue: 400,
    campaigns: 2,
    ...over,
  };
}

describe("parseMarketingRows", () => {
  it("reads the SQL arrays, numbers or numeric strings, and skips malformed rows", () => {
    const rows = parseMarketingRows([
      ["2026-11-10", "meta", "EUR", 100.5, 10000, 200, 120, 4, 400, 2],
      ["2026-11-10", "google", "EUR", "55.25", "3000", "90", null, "2.5", null, "1"],
      ["2026-11-10", "bing", "EUR", 1, 1, 1, null, 1, null, 1], // unknown channel
      ["10/11/2026", "meta", "EUR", 1, 1, 1, null, 1, null, 1], // bad date
      ["2026-11-10", "meta", "eur", 1, 1, 1, null, 1, null, 1], // bad currency
      ["2026-11-10", "meta", "EUR", -5, 1, 1, null, 1, null, 1], // negative spend
      ["2026-11-10", "meta", "EUR", null, 1, 1, null, 1, null, 1], // missing spend
      "nope",
    ]);
    expect(rows).toEqual([
      day({ spend: 100.5 }),
      day({
        channel: "google",
        spend: 55.25,
        impressions: 3000,
        clicks: 90,
        outboundClicks: null,
        conversions: 2.5,
        conversionValue: null,
        campaigns: 1,
      }),
    ]);
  });

  it("returns nothing for a non-array", () => {
    expect(parseMarketingRows(null)).toEqual([]);
    expect(parseMarketingRows({})).toEqual([]);
  });
});

describe("marketingTotals", () => {
  it("adds up spend and works out cost per new customer across channels", () => {
    const totals = marketingTotals(
      [
        day({ channel: "meta", spend: 300, conversions: 6 }),
        day({ channel: "google", spend: 150.1, conversions: 3, outboundClicks: null }),
        day({ channel: "tiktok", spend: 49.9, conversions: 1, outboundClicks: null }),
      ],
      range,
      10
    );
    expect(totals.spend).toBe(500);
    expect(totals.conversions).toBe(10);
    expect(totals.newCustomers).toBe(10);
    expect(totals.costPerNewCustomer).toBe(50);
    expect(totals.costPerConversion).toBe(50);
    expect(totals.channels.map((c) => c.channel)).toEqual([...CHANNELS]);
    expect(totals.channels.find((c) => c.channel === "meta")!.costPerConversion).toBe(50);
  });

  it("works out CTR and outbound CTR, the latter only where reported", () => {
    const totals = marketingTotals(
      [
        day({ channel: "meta", impressions: 10_000, clicks: 300, outboundClicks: 150 }),
        day({ channel: "google", impressions: 2_000, clicks: 100, outboundClicks: null }),
      ],
      range,
      0
    );
    const meta = totals.channels.find((c) => c.channel === "meta")!;
    const google = totals.channels.find((c) => c.channel === "google")!;
    expect(meta.ctr).toBeCloseTo(0.03);
    expect(meta.outboundCtr).toBeCloseTo(0.015);
    expect(google.ctr).toBeCloseTo(0.05);
    expect(google.outboundCtr).toBeNull();
    expect(google.outboundClicks).toBeNull();
  });

  it("bases outbound CTR only on the days that reported outbound clicks", () => {
    const totals = marketingTotals(
      [
        day({ day: "2026-11-10", impressions: 1_000, outboundClicks: 20 }),
        day({ day: "2026-11-11", impressions: 9_000, outboundClicks: null }),
      ],
      range,
      0
    );
    expect(totals.channels.find((c) => c.channel === "meta")!.outboundCtr).toBeCloseTo(0.02);
  });

  it("gives null rates instead of dividing by zero", () => {
    const totals = marketingTotals([day({ spend: 80, impressions: 0, clicks: 0, conversions: 0 })], range, 0);
    expect(totals.costPerNewCustomer).toBeNull();
    expect(totals.costPerConversion).toBeNull();
    const meta = totals.channels.find((c) => c.channel === "meta")!;
    expect(meta.ctr).toBeNull();
    expect(meta.outboundCtr).toBeNull();
    expect(meta.costPerConversion).toBeNull();
  });

  it("shows channels with no data as zeros", () => {
    const totals = marketingTotals([], range, 3);
    expect(totals.spend).toBe(0);
    expect(totals.costPerNewCustomer).toBe(0);
    expect(totals.channels).toHaveLength(3);
    expect(totals.channels.every((c) => c.spend === 0 && c.conversionValue === null)).toBe(true);
  });

  it("leaves days outside the range out", () => {
    const totals = marketingTotals(
      [day({ day: "2026-10-31", spend: 999 }), day({ day: "2026-11-01", spend: 10 }), day({ day: "2026-11-30", spend: 20 }), day({ day: "2026-12-01", spend: 999 })],
      range,
      1
    );
    expect(totals.spend).toBe(30);
  });

  it("keeps other currencies out of the totals and lists them", () => {
    const totals = marketingTotals(
      [day({ spend: 100 }), day({ channel: "tiktok", currency: "USD", spend: 40 }), day({ channel: "tiktok", currency: "USD", day: "2026-11-11", spend: 2.5 })],
      range,
      2
    );
    expect(totals.spend).toBe(100);
    expect(totals.costPerNewCustomer).toBe(50);
    expect(totals.channels.find((c) => c.channel === "tiktok")!.spend).toBe(0);
    expect(totals.otherCurrencies).toEqual([{ channel: "tiktok", currency: "USD", spend: 42.5 }]);
  });

  it("rounds money to the cent", () => {
    const totals = marketingTotals([day({ spend: 0.1 }), day({ spend: 0.2 })], range, 0);
    expect(totals.spend).toBe(0.3);
  });
});

describe("marketingSeries", () => {
  it("splits spend by week and channel, with each week's cost per new customer", () => {
    const points = marketingSeries(
      [
        day({ day: "2026-11-03", channel: "meta", spend: 100, conversions: 2 }),
        day({ day: "2026-11-04", channel: "google", spend: 50, conversions: 1 }),
        day({ day: "2026-11-12", channel: "meta", spend: 30, conversions: 0 }),
      ],
      { from: "2026-11-03", to: "2026-11-16" },
      "week",
      new Map([
        ["2026-11-02", 5],
        ["2026-11-09", 0],
      ])
    );
    expect(points.map((p) => p.period.key)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(points[0].spendByChannel).toEqual({ google: 50, meta: 100, tiktok: 0 });
    expect(points[0].conversionsByChannel).toEqual({ google: 1, meta: 2, tiktok: 0 });
    expect(points[0].spend).toBe(150);
    expect(points[0].costPerNewCustomer).toBe(30);
    expect(points[1].spend).toBe(30);
    expect(points[1].costPerNewCustomer).toBeNull();
    // A week with no figures and no new-customer entry.
    expect(points[2]).toMatchObject({ spend: 0, newCustomers: 0, costPerNewCustomer: null });
  });

  it("groups by month and skips other currencies", () => {
    const points = marketingSeries(
      [day({ day: "2026-10-15", spend: 10 }), day({ day: "2026-11-15", spend: 20 }), day({ day: "2026-11-16", currency: "USD", spend: 99 })],
      { from: "2026-10-01", to: "2026-11-30" },
      "month",
      new Map([["2026-11-01", 4]])
    );
    expect(points.map((p) => [p.period.key, p.spend, p.costPerNewCustomer])).toEqual([
      ["2026-10-01", 10, null],
      ["2026-11-01", 20, 5],
    ]);
  });
});

describe("parseSyncState", () => {
  it("gives every channel a status, connected once a sync has succeeded", () => {
    const statuses = parseSyncState([
      {
        channel: "meta",
        last_success_at: "2026-11-25T03:00:00Z",
        last_attempt_at: "2026-11-25T03:00:00Z",
        last_error: null,
        history_from: "2025-11-25",
      },
      { channel: "google", last_success_at: null, last_attempt_at: "2026-11-25T03:00:00Z", last_error: "Token rejected" },
      { channel: "nope", last_success_at: "2026-11-25T03:00:00Z" },
    ]);
    expect(statuses).toEqual([
      { channel: "google", connected: false, lastSuccessAt: null, lastAttemptAt: "2026-11-25T03:00:00Z", lastError: "Token rejected", historyFrom: null },
      { channel: "meta", connected: true, lastSuccessAt: "2026-11-25T03:00:00Z", lastAttemptAt: "2026-11-25T03:00:00Z", lastError: null, historyFrom: "2025-11-25" },
      { channel: "tiktok", connected: false, lastSuccessAt: null, lastAttemptAt: null, lastError: null, historyFrom: null },
    ]);
  });

  it("treats a missing table response as nothing connected", () => {
    expect(parseSyncState(null).every((s) => !s.connected)).toBe(true);
  });
});

describe("channelsMissingStart", () => {
  it("lists connected channels whose history starts after the range", () => {
    const statuses = parseSyncState([
      { channel: "meta", last_success_at: "2026-11-25T03:00:00Z", history_from: "2026-11-05" },
      { channel: "google", last_success_at: "2026-11-25T03:00:00Z", history_from: "2026-10-01" },
      { channel: "tiktok", last_success_at: null, history_from: "2026-11-20" },
    ]);
    expect(channelsMissingStart(statuses, range)).toEqual(["meta"]);
  });
});

describe("marketingReport", () => {
  it("puts the range, the comparison and the series together", () => {
    const compareRange = { from: "2026-10-02", to: "2026-10-31" };
    const report = marketingReport({
      params: { range, groupBy: "month", compareTo: "previous" },
      compareRange,
      days: [day({ day: "2026-10-15", spend: 40 }), day({ day: "2026-11-15", spend: 90 })],
      statuses: parseSyncState([{ channel: "meta", last_success_at: "2026-11-25T03:00:00Z", history_from: "2026-10-10" }]),
      newCustomers: 3,
      compareNewCustomers: 4,
      newCustomersByPeriod: new Map([["2026-11-01", 3]]),
    });
    expect(report.params).toEqual({ range, groupBy: "month", compareTo: "previous", compareRange });
    expect(report.totals).toMatchObject({ spend: 90, newCustomers: 3, costPerNewCustomer: 30 });
    expect(report.compare).toMatchObject({ spend: 40, newCustomers: 4, costPerNewCustomer: 10 });
    expect(report.series).toHaveLength(1);
    expect(report.series[0]).toMatchObject({ spend: 90, costPerNewCustomer: 30 });
    expect(report.missingStart).toEqual([]);
    expect(report.compareMissingStart).toEqual(["meta"]);
    expect(report.channels.find((c) => c.channel === "meta")!.connected).toBe(true);
  });
});

describe("spanningRange", () => {
  it("covers both ranges", () => {
    expect(spanningRange(range, { from: "2025-11-01", to: "2025-11-30" })).toEqual({ from: "2025-11-01", to: "2026-11-30" });
    expect(spanningRange(range, { from: "2026-10-02", to: "2026-10-31" })).toEqual({ from: "2026-10-02", to: "2026-11-30" });
  });
});

describe("parseMarketingParams", () => {
  it("reads the range, grouping and comparison, with defaults", () => {
    expect(parseMarketingParams(new URLSearchParams("from=2026-11-01&to=2026-11-30"))).toEqual({
      range,
      groupBy: "week",
      compareTo: "previous",
    });
    expect(parseMarketingParams(new URLSearchParams("from=2026-01-01&to=2026-11-30&compare=year"))).toEqual({
      range: { from: "2026-01-01", to: "2026-11-30" },
      groupBy: "month",
      compareTo: "year",
    });
  });

  it("rejects bad input", () => {
    expect(parseMarketingParams(new URLSearchParams("from=2026-11-30&to=2026-11-01"))).toMatch(/from first/);
    expect(parseMarketingParams(new URLSearchParams("from=2020-01-01&to=2026-11-30"))).toMatch(/three years/);
    expect(parseMarketingParams(new URLSearchParams("from=2026-11-01&to=2026-11-30&group=day"))).toMatch(/group/);
    expect(parseMarketingParams(new URLSearchParams("from=2026-11-01&to=2026-11-30&compare=custom"))).toMatch(/compare/);
  });
});
