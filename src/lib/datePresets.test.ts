import { describe, expect, it } from "vitest";
import {
  compareRange,
  formatDayRange,
  isDay,
  matchingPreset,
  orderedRange,
  presetRange,
  rangeLength,
  rangeWithin,
} from "./datePresets";

// Thursday 19 November 2026
const TODAY = "2026-11-19";

describe("presetRange", () => {
  it.each([
    ["today", "2026-11-19", "2026-11-19"],
    ["yesterday", "2026-11-18", "2026-11-18"],
    ["thisWeek", "2026-11-16", "2026-11-19"],
    ["lastWeek", "2026-11-09", "2026-11-15"],
    ["last7", "2026-11-13", "2026-11-19"],
    ["last14", "2026-11-06", "2026-11-19"],
    ["last28", "2026-10-23", "2026-11-19"],
    ["last30", "2026-10-21", "2026-11-19"],
    ["last90", "2026-08-22", "2026-11-19"],
    ["thisMonth", "2026-11-01", "2026-11-19"],
    ["lastMonth", "2026-10-01", "2026-10-31"],
    ["quarterToDate", "2026-10-01", "2026-11-19"],
    ["thisYear", "2026-01-01", "2026-11-19"],
    ["lastYear", "2025-01-01", "2025-12-31"],
  ] as const)("%s", (preset, from, to) => {
    expect(presetRange(preset, TODAY)).toEqual({ from, to });
  });

  it("starts this week on Monday, even on a Sunday", () => {
    expect(presetRange("thisWeek", "2026-11-22")).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(presetRange("thisWeek", "2026-11-16")).toEqual({ from: "2026-11-16", to: "2026-11-16" });
  });

  it("has no dates for custom", () => {
    expect(presetRange("custom", TODAY)).toBeNull();
  });
});

describe("compareRange", () => {
  it("previous period has the same length and ends the day before", () => {
    expect(compareRange({ from: "2026-10-21", to: "2026-11-19" }, "previous")).toEqual({
      from: "2026-09-21",
      to: "2026-10-20",
    });
    expect(compareRange({ from: "2026-11-19", to: "2026-11-19" }, "previous")).toEqual({
      from: "2026-11-18",
      to: "2026-11-18",
    });
  });

  it("same period last year moves both ends back a year", () => {
    expect(compareRange({ from: "2026-10-01", to: "2026-10-31" }, "previousYear")).toEqual({
      from: "2025-10-01",
      to: "2025-10-31",
    });
    expect(compareRange({ from: "2028-02-29", to: "2028-03-01" }, "previousYear")).toEqual({
      from: "2027-02-28",
      to: "2027-03-01",
    });
  });

  it("offers weekday-aligned period and year comparisons", () => {
    expect(compareRange({ from: "2025-01-01", to: "2025-01-31" }, "previousWeekday")).toEqual({
      from: "2024-12-04",
      to: "2025-01-03",
    });
    expect(compareRange({ from: "2026-11-01", to: "2026-11-07" }, "previousYearWeekday")).toEqual({
      from: "2025-11-02",
      to: "2025-11-08",
    });
  });

  it("has no dates for custom", () => {
    expect(compareRange({ from: "2026-10-01", to: "2026-10-31" }, "custom")).toBeNull();
  });
});

describe("helpers", () => {
  it("matchingPreset finds an offered preset, or custom", () => {
    expect(matchingPreset({ from: "2026-10-01", to: "2026-10-31" }, TODAY, ["last7", "lastMonth"])).toBe("lastMonth");
    expect(matchingPreset({ from: "2026-10-01", to: "2026-10-31" }, TODAY, ["last7"])).toBe("custom");
  });

  it("rangeLength counts both ends, across a clock change", () => {
    expect(rangeLength({ from: "2026-10-20", to: "2026-10-30" })).toBe(11);
    expect(rangeLength({ from: "2026-11-19", to: "2026-11-19" })).toBe(1);
  });

  it("orderedRange and rangeWithin", () => {
    expect(orderedRange("2026-11-05", "2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-11-05" });
    expect(rangeWithin({ from: "2026-11-01", to: "2026-11-05" }, "2026-11-01", TODAY)).toBe(true);
    expect(rangeWithin({ from: "2026-10-31", to: "2026-11-05" }, "2026-11-01")).toBe(false);
    expect(rangeWithin({ from: "2026-11-01", to: "2026-11-20" }, undefined, TODAY)).toBe(false);
  });

  it("isDay only accepts real dates", () => {
    expect(isDay("2026-02-28")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("19/11/2026")).toBe(false);
  });

  it("formatDayRange shows the year once unless the range crosses years", () => {
    expect(formatDayRange({ from: "2026-10-01", to: "2026-10-31" })).toBe("1 Oct – 31 Oct 2026");
    expect(formatDayRange({ from: "2025-12-20", to: "2026-01-10" })).toBe("20 Dec 2025 – 10 Jan 2026");
    expect(formatDayRange({ from: "2026-11-19", to: "2026-11-19" })).toBe("19 Nov 2026");
  });
});
