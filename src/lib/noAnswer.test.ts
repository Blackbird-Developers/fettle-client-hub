import { describe, expect, it } from "vitest";
import {
  type NoAnswerSequence,
  ATTEMPT_PLAN,
  MAX_ATTEMPTS,
  attemptedToday,
  countDue,
  emailDraft,
  firstNameOf,
  groupSequences,
  nextAttemptNumber,
  plannedAttempt,
} from "./noAnswer";

const TODAY = new Date("2026-10-14T10:00:00");

let nextId = 1;
function sequence(overrides: Partial<NoAnswerSequence> = {}): NoAnswerSequence {
  return {
    id: String(nextId++),
    customer_key: `email:c${nextId}@example.com`,
    customer_name: "Ann Archer",
    customer_phone: "087 123 4567",
    source: "progression",
    status: "active",
    attempts_done: 1,
    started_at: "2026-10-12T09:00:00Z",
    started_by_email: "alex@fettle.ie",
    last_attempt_at: "2026-10-12T09:00:00Z",
    last_attempt_by_email: "alex@fettle.ie",
    last_method: "call",
    next_due_on: "2026-10-14",
    closed_at: null,
    closed_by: null,
    closed_by_email: null,
    closed_reason: null,
    ...overrides,
  };
}

describe("the attempt plan", () => {
  it("has six attempts on days 0, 1, 3, 7, 14 and 21, emails with 2, 5 and 6", () => {
    expect(ATTEMPT_PLAN.map((a) => a.day)).toEqual([0, 1, 3, 7, 14, 21]);
    expect(ATTEMPT_PLAN.filter((a) => a.withEmail).map((a) => a.attempt)).toEqual([2, 5, 6]);
  });

  it("names the next attempt and never goes past six", () => {
    expect(nextAttemptNumber({ attempts_done: 0 })).toBe(1);
    expect(nextAttemptNumber({ attempts_done: 2 })).toBe(3);
    expect(nextAttemptNumber({ attempts_done: 6 })).toBe(MAX_ATTEMPTS);
    expect(plannedAttempt(9).attempt).toBe(6);
    expect(plannedAttempt(0).attempt).toBe(1);
  });
});

describe("groupSequences", () => {
  it("splits active sequences into due (incl. overdue) and coming up, soonest first", () => {
    const overdue = sequence({ next_due_on: "2026-10-12" });
    const today = sequence({ next_due_on: "2026-10-14" });
    const later = sequence({ next_due_on: "2026-10-20" });
    const soon = sequence({ next_due_on: "2026-10-15" });
    const groups = groupSequences([later, today, soon, overdue], TODAY);
    expect(groups.due).toEqual([overdue, today]);
    expect(groups.upcoming).toEqual([soon, later]);
    expect(countDue([later, today, soon, overdue], TODAY)).toBe(2);
  });

  it("lists finished sequences, and other ended ones from the last 30 days, newest first", () => {
    const exhausted = sequence({ status: "exhausted", attempts_done: 6, next_due_on: null, closed_at: "2026-10-01T09:00:00Z" });
    const booked = sequence({ status: "booked", next_due_on: null, closed_at: "2026-10-13T09:00:00Z" });
    const closed = sequence({ status: "closed", next_due_on: null, closed_at: "2026-10-10T09:00:00Z" });
    const old = sequence({ status: "booked", next_due_on: null, closed_at: "2026-08-01T09:00:00Z" });
    const groups = groupSequences([exhausted, closed, old, booked], TODAY);
    expect(groups.exhausted).toEqual([exhausted]);
    expect(groups.closed).toEqual([booked, closed]);
    expect(groups.due).toEqual([]);
  });
});

describe("attemptedToday", () => {
  it("is true only when the last attempt was today", () => {
    expect(attemptedToday({ last_attempt_at: "2026-10-14T08:00:00" }, TODAY)).toBe(true);
    expect(attemptedToday({ last_attempt_at: "2026-10-13T17:00:00" }, TODAY)).toBe(false);
    expect(attemptedToday({ last_attempt_at: null }, TODAY)).toBe(false);
  });
});

describe("email drafts", () => {
  it("exists only for attempts 2, 5 and 6 and greets by first name", () => {
    expect(emailDraft(1, "Ann")).toBeNull();
    expect(emailDraft(3, "Ann")).toBeNull();
    expect(emailDraft(2, "Ann")?.body).toMatch(/^Hi Ann,/);
    expect(emailDraft(6, null)?.body).toMatch(/^Hi there,/);
    expect(emailDraft(6, "Ann")?.subject).toBe("We'll leave it with you");
  });

  it("never mentions therapy in the subject", () => {
    for (const attempt of [2, 5, 6]) {
      expect(emailDraft(attempt, "Ann")!.subject).not.toMatch(/therap|session|counsel/i);
    }
  });

  it("takes the first word of a name", () => {
    expect(firstNameOf(" Ann  Archer ")).toBe("Ann");
    expect(firstNameOf(null)).toBeNull();
  });
});
