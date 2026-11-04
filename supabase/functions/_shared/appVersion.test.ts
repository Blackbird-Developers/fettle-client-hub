import { describe, expect, it } from "vitest";
import { compareVersions, isAppVersionTooOld } from "./appVersion";

describe("compareVersions", () => {
  it("orders by major, minor, patch", () => {
    expect(compareVersions("1.4.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.4", "1.4.0")).toBe(0);
  });
});

describe("isAppVersionTooOld", () => {
  it("never blocks the website (no header) or when no minimum is set", () => {
    expect(isAppVersionTooOld(null, "1.4.0")).toBe(false);
    expect(isAppVersionTooOld("1.0.0", undefined)).toBe(false);
  });

  it("blocks only builds below the minimum", () => {
    expect(isAppVersionTooOld("1.3.9", "1.4.0")).toBe(true);
    expect(isAppVersionTooOld("1.4.0", "1.4.0")).toBe(false);
    expect(isAppVersionTooOld("1.5.0", "1.4.0")).toBe(false);
  });

  it("ignores unparseable versions rather than blocking", () => {
    expect(isAppVersionTooOld("dev", "1.4.0")).toBe(false);
  });
});
