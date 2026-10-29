import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  addMonthsToKey,
  cleanDays,
  defaultDay,
  dublinDateKey,
  earliestSlot,
  formatLongDate,
  formatShortDate,
  formatSlot,
  formatSlotTime,
  groupTimes,
  isSlotStillOpen,
  partOfDay,
  visibleTimes,
  weekdayOfKey,
} from "./time";

// Thursday 29 October 2026, 10:00 in Dublin (GMT, after the clocks went back).
const NOW = new Date("2026-10-29T10:00:00Z");

describe("formatting in Irish time", () => {
  it("formats times as 5:00pm whatever the offset", () => {
    expect(formatSlotTime("2026-10-28T17:00:00+0000")).toBe("5:00pm");
    expect(formatSlotTime("2026-09-24T07:00:00+0100")).toBe("7:00am");
    expect(formatSlotTime("2026-09-24T06:30:00Z")).toBe("7:30am");
    expect(formatSlotTime("2026-10-28T12:00:00+0000")).toBe("12:00pm");
  });

  it("formats long and short dates", () => {
    expect(formatLongDate("2026-10-28")).toBe("Wednesday, 28 October");
    expect(formatShortDate("2026-10-28")).toBe("Wed 28 Oct");
    expect(formatShortDate("2026-09-01")).toBe("Tue 1 Sep");
    expect(formatSlot("2026-10-28T17:00:00+0000")).toBe("Wednesday, 28 October at 5:00pm");
  });

  it("uses the Dublin day, not UTC", () => {
    // 23:30 UTC on 30 June is 00:30 on 1 July in Dublin (IST).
    expect(dublinDateKey(new Date("2026-06-30T23:30:00Z"))).toBe("2026-07-01");
  });
});

describe("day keys", () => {
  it("adds days and months across boundaries", () => {
    expect(addDaysToKey("2026-10-30", 3)).toBe("2026-11-02");
    expect(addMonthsToKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthsToKey("2026-10", 11)).toBe("2027-09");
    expect(weekdayOfKey("2026-10-31")).toBe(6);
  });
});

describe("partOfDay", () => {
  it("splits at 12:00 and 17:00 Dublin time", () => {
    expect(partOfDay("2026-10-28T11:59:00+0000")).toBe("morning");
    expect(partOfDay("2026-10-28T12:00:00+0000")).toBe("afternoon");
    expect(partOfDay("2026-10-28T16:59:00+0000")).toBe("afternoon");
    expect(partOfDay("2026-10-28T17:00:00+0000")).toBe("evening");
    // 11:00 UTC in summer is 12:00 in Dublin.
    expect(partOfDay("2026-07-01T11:00:00Z")).toBe("afternoon");
  });

  it("groups times and leaves out empty parts", () => {
    const groups = groupTimes(["2026-10-30T09:00:00+0000", "2026-10-30T18:00:00+0000", "2026-10-30T10:00:00+0000"]);
    expect(groups.map((g) => [g.part, g.times.length])).toEqual([
      ["morning", 2],
      ["evening", 1],
    ]);
  });

  it("shows every time when the filter hides them all", () => {
    const times = ["2026-10-30T18:00:00+0000"];
    expect(visibleTimes(times, "morning")).toEqual({ times, fallback: true });
    expect(visibleTimes(times, "evening")).toEqual({ times, fallback: false });
  });
});

describe("cleanDays", () => {
  const days = [
    { date: "2026-10-28", times: ["2026-10-28T17:00:00+0000"] },
    { date: "2026-10-29", times: ["2026-10-29T10:15:00+0000", "2026-10-29T10:45:00+0000"] },
    { date: "2026-10-31", times: ["2026-10-31T09:00:00+0000"] },
    { date: "2026-11-02", times: ["2026-11-02T09:00:00+0000"] },
    { date: "2026-11-03", times: [] },
  ];

  it("drops past days, times under 30 minutes away and empty days", () => {
    expect(cleanDays(days, { now: NOW })).toEqual([
      { date: "2026-10-29", times: ["2026-10-29T10:45:00+0000"] },
      { date: "2026-10-31", times: ["2026-10-31T09:00:00+0000"] },
      { date: "2026-11-02", times: ["2026-11-02T09:00:00+0000"] },
    ]);
  });

  it("starts psychologists at today + 3 with no weekends", () => {
    // Today + 3 = Sunday 1 November; Saturday 31 October is too soon anyway.
    expect(cleanDays(days, { now: NOW, psychologist: true }).map((d) => d.date)).toEqual(["2026-11-02"]);
  });
});

describe("earliest and default day", () => {
  const days = [
    { date: "2026-10-30", times: ["2026-10-30T18:00:00+0000"] },
    { date: "2026-11-02", times: ["2026-11-02T09:00:00+0000", "2026-11-02T19:00:00+0000"] },
  ];

  it("finds the earliest time, optionally by part of day", () => {
    expect(earliestSlot(days)).toEqual({ date: "2026-10-30", time: "2026-10-30T18:00:00+0000" });
    expect(earliestSlot(days, "morning")).toEqual({ date: "2026-11-02", time: "2026-11-02T09:00:00+0000" });
    expect(earliestSlot(days, "afternoon")).toBeNull();
  });

  it("prefers a chosen slot that is still open, then the filter, then the first day", () => {
    expect(defaultDay(days, "any", "2026-11-02T19:00:00+0000")).toBe("2026-11-02");
    expect(defaultDay(days, "any", "2026-11-05T19:00:00+0000")).toBe("2026-10-30");
    expect(defaultDay(days, "morning")).toBe("2026-11-02");
    expect(defaultDay(days, "afternoon")).toBe("2026-10-30");
    expect(defaultDay([], "any")).toBeNull();
  });
});

describe("isSlotStillOpen", () => {
  it("compares instants, not strings", () => {
    expect(isSlotStillOpen("2026-10-30T18:00:00+0000", ["2026-10-30T18:00:00Z"])).toBe(true);
    expect(isSlotStillOpen("2026-10-30T18:00:00+0000", ["2026-10-30T19:00:00+0000"])).toBe(false);
  });
});
