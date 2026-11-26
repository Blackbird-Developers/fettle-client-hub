import { describe, expect, it } from "vitest";
import {
  costTone,
  formatConversions,
  formatCtr,
  formatForeignMoney,
  formatMoney,
  formatMoneyChange,
  marketingQuery,
} from "./adminMarketing";

describe("marketingQuery", () => {
  it("asks admin-analytics for the marketing action with the shared settings", () => {
    const range = { from: "2026-11-01", to: "2026-11-25" };
    expect(marketingQuery(range, "week", { preset: "previousYear", range: { from: "2025-11-01", to: "2025-11-25" } })).toBe(
      "action=marketing&from=2026-11-01&to=2026-11-25&group=week&compare=year"
    );
    expect(marketingQuery(range, "week", { preset: "custom", range: { from: "2026-09-01", to: "2026-09-25" } })).toBe(
      "action=marketing&from=2026-11-01&to=2026-11-25&group=week&compare=custom&cfrom=2026-09-01&cto=2026-09-25"
    );
  });
});

describe("formatMoney", () => {
  it("shows cents under €100 and whole euro above", () => {
    expect(formatMoney(12.5)).toBe("€12.50");
    expect(formatMoney(1234.56)).toBe("€1,235");
    expect(formatMoney(0)).toBe("€0.00");
    expect(formatMoney(null)).toBe("–");
  });

  it("formats other currencies, falling back for unknown codes", () => {
    expect(formatForeignMoney(42.5, "USD")).toMatch(/42\.50/);
    expect(formatForeignMoney(1, "ZZZZ")).toBe("1.00 ZZZZ");
  });
});

describe("formatConversions and formatCtr", () => {
  it("keeps one decimal only for fractional conversions", () => {
    expect(formatConversions(12)).toBe("12");
    expect(formatConversions(12.46)).toBe("12.5");
  });

  it("shows CTR to two decimals, n/a when not reported", () => {
    expect(formatCtr(0.01234)).toBe("1.23%");
    expect(formatCtr(null)).toBe("n/a");
  });
});

describe("formatMoneyChange and costTone", () => {
  it("shows the change in euro and percent", () => {
    expect(formatMoneyChange(1100, 1000)).toBe("+€100 (+10%)");
    expect(formatMoneyChange(45, 50)).toBe("−€5.00 (−10%)");
    expect(formatMoneyChange(20, 0)).toBe("+€20.00");
    expect(formatMoneyChange(null, 10)).toBeNull();
  });

  it("is green when a cost falls and red when it rises", () => {
    expect(costTone(40, 50)).toBe("up");
    expect(costTone(60, 50)).toBe("down");
    expect(costTone(50, 50)).toBe("neutral");
    expect(costTone(null, 50)).toBe("neutral");
  });
});
