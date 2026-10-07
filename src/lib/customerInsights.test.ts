import { describe, expect, it } from "vitest";
import { normalizeProgression } from "./customerInsights";

const legend = [{ grade: "A" as const, label: "Overdue" }];

describe("normalizeProgression", () => {
  it("passes the current array of views through unchanged", () => {
    const views = [
      { fromSession: 1, rows: [], totals: { verified: 0, unverified: 0 }, legend },
      { fromSession: 2, rows: [], totals: { verified: 0, unverified: 0 }, legend },
    ];
    expect(normalizeProgression(views)).toBe(views);
  });

  it("turns the old single first-to-second view into Session 1–2", () => {
    const legacy = {
      rows: [
        {
          key: "email:a@example.com",
          name: "A",
          email: "a@example.com",
          phone: null,
          firstSessionAt: "2026-09-20T10:00:00Z",
          firstSessionType: "Therapy",
          daysSinceFirstSession: 17,
          secondSessionStatus: "booked",
          secondSessionAt: "2026-10-10T10:00:00Z",
          secondSessionType: "Therapy",
          portalStatus: "has_account",
          historyStatus: "verified",
          historyNote: null,
          grade: "D",
          gradeReason: "Booked",
        },
        {
          key: "phone:353871234567",
          name: "B",
          email: null,
          phone: "087 123 4567",
          firstSessionAt: "2026-09-25T10:00:00Z",
          firstSessionType: null,
          daysSinceFirstSession: 12,
          secondSessionStatus: "none",
          secondSessionAt: null,
          secondSessionType: null,
          portalStatus: "unknown",
          historyStatus: "unverified",
          historyNote: "Lookup failed",
          grade: null,
          gradeReason: null,
        },
      ],
      totals: { candidates: 2, firstTimers: 1, returningCustomers: 0, unverified: 1 },
      legend,
    };

    const [view, ...rest] = normalizeProgression(legacy);

    expect(rest).toEqual([]);
    expect(view.fromSession).toBe(1);
    expect(view.legend).toBe(legend);
    expect(view.totals).toEqual({ verified: 1, unverified: 1 });
    expect(view.rows[0]).toMatchObject({
      key: "email:a@example.com",
      fromSessionAt: "2026-09-20T10:00:00Z",
      fromSessionType: "Therapy",
      daysSinceFromSession: 17,
      nextSessionStatus: "booked",
      nextSessionAt: "2026-10-10T10:00:00Z",
      nextSessionType: "Therapy",
      grade: "D",
    });
    expect(view.rows[1]).toMatchObject({ nextSessionStatus: "none", historyStatus: "unverified" });
  });

  it("returns no views when progression is missing", () => {
    expect(normalizeProgression(undefined)).toEqual([]);
    expect(normalizeProgression(null)).toEqual([]);
  });
});
