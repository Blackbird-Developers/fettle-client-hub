// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOAD_PROFILES,
  estimateLoad,
  formatRemaining,
  getLoadStart,
  readExpectedDuration,
  recordDuration,
  timeLoad,
} from "./adminLoadProgress";

const profile = LOAD_PROFILES["admin-customer-insights"];

afterEach(() => localStorage.clear());

describe("estimateLoad", () => {
  it("starts at zero on the first step", () => {
    expect(estimateLoad(profile, 0, 40_000)).toMatchObject({ percent: 0, activeStep: 0, overdue: false });
  });

  it("moves linearly to 90% by the expected time", () => {
    expect(estimateLoad(profile, 20_000, 40_000).percent).toBeCloseTo(45);
    expect(estimateLoad(profile, 40_000, 40_000).percent).toBeCloseTo(90);
  });

  it("creeps toward but never reaches 100% once overdue", () => {
    const late = estimateLoad(profile, 80_000, 40_000);
    expect(late.overdue).toBe(true);
    expect(late.percent).toBeGreaterThan(90);
    expect(estimateLoad(profile, 10_000_000, 40_000).percent).toBeLessThanOrEqual(99);
  });

  it("picks the step by share of the expected time", () => {
    // Shares: 0.35, 0.05, 0.55, 0.05
    expect(estimateLoad(profile, 10_000, 40_000).activeStep).toBe(0);
    expect(estimateLoad(profile, 15_000, 40_000).activeStep).toBe(1);
    expect(estimateLoad(profile, 30_000, 40_000).activeStep).toBe(2);
    expect(estimateLoad(profile, 39_000, 40_000).activeStep).toBe(3);
    expect(estimateLoad(profile, 90_000, 40_000).activeStep).toBe(3);
  });

  it("counts down the time left", () => {
    expect(estimateLoad(profile, 15_000, 40_000).remainingMs).toBe(25_000);
    expect(estimateLoad(profile, 60_000, 40_000).remainingMs).toBe(0);
  });
});

describe("profiles", () => {
  it.each(Object.entries(LOAD_PROFILES))("%s step shares add up to 1", (_, p) => {
    expect(p.steps.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });
});

describe("formatRemaining", () => {
  it.each([
    [3_000, "A few seconds left"],
    [12_000, "About 15s left"],
    [45_000, "About 45s left"],
    [100_000, "About 2 min left"],
  ])("%d ms → %s", (ms, label) => {
    expect(formatRemaining(ms)).toBe(label);
  });
});

describe("durations", () => {
  it("uses the default until a load has been timed", () => {
    expect(readExpectedDuration("admin-leads")).toBe(LOAD_PROFILES["admin-leads"].defaultMs);
  });

  it("stores the first timing, then averages with the previous one", () => {
    recordDuration("admin-leads", 20_000);
    expect(readExpectedDuration("admin-leads")).toBe(20_000);
    recordDuration("admin-leads", 40_000);
    expect(readExpectedDuration("admin-leads")).toBe(30_000);
  });

  it("ignores nonsense timings", () => {
    recordDuration("admin-leads", Number.NaN);
    recordDuration("admin-leads", -5);
    expect(readExpectedDuration("admin-leads")).toBe(LOAD_PROFILES["admin-leads"].defaultMs);
  });
});

describe("timeLoad", () => {
  it("marks the start while loading and records the duration on success", async () => {
    vi.useFakeTimers();
    let seenStart: number | undefined;
    const result = await timeLoad("admin-bundles", async () => {
      seenStart = getLoadStart("admin-bundles");
      vi.setSystemTime(Date.now() + 12_000);
      return 42;
    });
    vi.useRealTimers();
    expect(result).toBe(42);
    expect(seenStart).toBeTypeOf("number");
    expect(getLoadStart("admin-bundles")).toBeUndefined();
    expect(readExpectedDuration("admin-bundles")).toBe(12_000);
  });

  it("records nothing when the load fails", async () => {
    await expect(
      timeLoad("admin-bundles", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(getLoadStart("admin-bundles")).toBeUndefined();
    expect(localStorage.getItem("fettle-admin-load-ms:admin-bundles")).toBeNull();
  });
});
