import { describe, expect, it } from "vitest";
import { type CustomerFollowup, blankFollowup } from "./customerFollowups";
import {
  applyOutcome,
  attemptInsert,
  contactFromKey,
  countFollowUpsDue,
  describeReasons,
  followUpDueDate,
  followUpLater,
  followUpTiming,
  followUpTimingLabel,
  matchesOutcomeFilter,
  reasonCounts,
  validateReasons,
} from "./contactOutcomes";

function followup(customerKey: string, overrides: Partial<CustomerFollowup> = {}): CustomerFollowup {
  return { ...blankFollowup(customerKey), updated_at: "2026-10-07T09:00:00Z", ...overrides };
}

const NOW = new Date(2026, 9, 8, 11, 0); // 8 Oct 2026, local time

describe("not-continuing reasons", () => {
  it("needs at least one reason", () => {
    expect(validateReasons([], "")).toBe("Choose at least one reason.");
    expect(validateReasons(["price"], "")).toBeNull();
  });

  it("needs text when Other is ticked", () => {
    expect(validateReasons(["other"], "   ")).toBe("Enter the reason.");
    expect(validateReasons(["timing", "other"], "Moving abroad")).toBeNull();
  });

  it("limits the Other text", () => {
    expect(validateReasons(["other"], "x".repeat(501))).toMatch(/up to 500/);
  });

  it("describes reasons in plain words", () => {
    expect(describeReasons(["price", "other"], "Moving abroad")).toBe("Price, Other: Moving abroad");
    expect(describeReasons(["not_interested"], null)).toBe("No longer interested");
    expect(describeReasons(null, null)).toBe("");
  });
});

describe("attemptInsert", () => {
  it("keeps reasons in the popup's order without duplicates and trims the text", () => {
    expect(
      attemptInsert("email:a@x.ie", " Ann ", {
        outcome: "not_continuing",
        reasons: ["other", "price", "price"],
        reasonOther: "  moving  ",
      })
    ).toEqual({
      customer_key: "email:a@x.ie",
      customer_name: "Ann",
      outcome: "not_continuing",
      reasons: ["price", "other"],
      reason_other: "moving",
    });
  });

  it("drops the Other text when Other isn't ticked", () => {
    expect(
      attemptInsert("email:a@x.ie", null, {
        outcome: "not_continuing",
        reasons: ["timing"],
        reasonOther: "leftover",
      }).reason_other
    ).toBeNull();
  });

  it("sends no reasons for other outcomes", () => {
    expect(attemptInsert("email:a@x.ie", "Ann", { outcome: "booked" })).toMatchObject({
      reasons: null,
      reason_other: null,
    });
  });
});

describe("applyOutcome (mirror of the database trigger)", () => {
  const apply = (rows: CustomerFollowup[], input: Parameters<typeof applyOutcome>[3]) =>
    applyOutcome(rows, "email:a@x.ie", "Ann", input, "alex@fettle.ie", NOW);

  it("counts No answer as an attempt, not as contacted", () => {
    const [row] = apply(apply([], { outcome: "no_answer" }), { outcome: "no_answer" });
    expect(row).toMatchObject({
      outcome: "no_answer",
      attempt_count: 2,
      contacted: false,
      last_reached_at: null,
      outcome_by_email: "alex@fettle.ie",
      customer_name: "Ann",
    });
  });

  it("sets a follow-up date 30 days out for Continue later, and marks contacted", () => {
    const [row] = apply([], { outcome: "follow_up_later" });
    expect(row.follow_up_due).toBe("2026-11-07");
    expect(row.contacted).toBe(true);
    expect(row.last_reached_at).toBe(NOW.toISOString());
  });

  it("clears the follow-up date and stores reasons when the outcome changes", () => {
    const later = apply([], { outcome: "follow_up_later" });
    const [row] = apply(later, { outcome: "not_continuing", reasons: ["price"] });
    expect(row).toMatchObject({
      outcome: "not_continuing",
      follow_up_due: null,
      not_continuing_reasons: ["price"],
      attempt_count: 2,
    });
  });

  it("Clear removes the outcome but keeps the attempt count and contacted status", () => {
    const booked = apply([], { outcome: "booked" });
    const [row] = apply(booked, { outcome: "cleared" });
    expect(row).toMatchObject({ outcome: null, outcome_at: null, attempt_count: 1, contacted: true });
  });

  it("only touches the given customer", () => {
    const other = followup("email:b@x.ie", { note: "keep" });
    const rows = apply([other], { outcome: "booked" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBe(other);
  });

  it("keeps an earlier manual contacted mark through No answer", () => {
    const [row] = apply([followup("email:a@x.ie", { contacted: true })], { outcome: "no_answer" });
    expect(row.contacted).toBe(true);
  });
});

describe("follow-up timing", () => {
  it("labels overdue, today, soon and later", () => {
    expect(followUpTiming("2026-10-05", NOW)).toEqual({ kind: "overdue", days: 3 });
    expect(followUpTiming("2026-10-08", NOW)).toEqual({ kind: "today", days: 0 });
    expect(followUpTiming("2026-10-09", NOW)).toEqual({ kind: "soon", days: 1 });
    expect(followUpTiming("2026-10-15", NOW)).toEqual({ kind: "soon", days: 7 });
    expect(followUpTiming("2026-10-16", NOW)).toEqual({ kind: "upcoming", days: 8 });
    expect(followUpTimingLabel({ kind: "overdue", days: 1 })).toBe("1 day overdue");
    expect(followUpTimingLabel({ kind: "soon", days: 1 })).toBe("Due tomorrow");
    expect(followUpTimingLabel({ kind: "upcoming", days: 12 })).toBe("Due in 12 days");
  });

  it("works out the due date from the day it was recorded", () => {
    expect(followUpDueDate(new Date(2026, 0, 31, 23, 30))).toBe("2026-03-02");
  });

  it("lists and counts only Continue later customers that are due", () => {
    const rows = [
      followup("email:a@x.ie", { outcome: "follow_up_later", follow_up_due: "2026-10-20" }),
      followup("email:b@x.ie", { outcome: "follow_up_later", follow_up_due: "2026-10-01" }),
      followup("email:c@x.ie", { outcome: "follow_up_later", follow_up_due: "2026-10-08" }),
      followup("email:d@x.ie", { outcome: "booked" }),
    ];
    expect(followUpLater(rows).map((r) => r.customer_key)).toEqual([
      "email:b@x.ie",
      "email:c@x.ie",
      "email:a@x.ie",
    ]);
    expect(countFollowUpsDue(rows, NOW)).toBe(2);
  });
});

describe("outcome filter and report helpers", () => {
  it("filters by outcome, with 'none' for customers without one", () => {
    const booked = followup("email:a@x.ie", { outcome: "booked" });
    expect(matchesOutcomeFilter(booked, "all")).toBe(true);
    expect(matchesOutcomeFilter(booked, "booked")).toBe(true);
    expect(matchesOutcomeFilter(booked, "none")).toBe(false);
    expect(matchesOutcomeFilter(undefined, "none")).toBe(true);
    expect(matchesOutcomeFilter(followup("email:b@x.ie"), "none")).toBe(true);
    expect(matchesOutcomeFilter(undefined, "no_answer")).toBe(false);
  });

  it("counts reasons across not-continuing customers only", () => {
    const rows = [
      followup("email:a@x.ie", { outcome: "not_continuing", not_continuing_reasons: ["price", "timing"] }),
      followup("email:b@x.ie", { outcome: "not_continuing", not_continuing_reasons: ["price"] }),
      followup("email:c@x.ie", { outcome: "booked", not_continuing_reasons: ["price"] }),
    ];
    expect(reasonCounts(rows)).toEqual({ price: 2, timing: 1, not_interested: 0, other: 0 });
  });

  it("reads email or phone from the customer key", () => {
    expect(contactFromKey("email:a@x.ie")).toEqual({ email: "a@x.ie", phone: null });
    expect(contactFromKey("phone:0871234567")).toEqual({ email: null, phone: "0871234567" });
    expect(contactFromKey("appointment:123")).toEqual({ email: null, phone: null });
  });
});
