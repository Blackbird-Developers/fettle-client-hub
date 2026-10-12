import { describe, expect, it } from "vitest";
import type { LeadRow } from "../../supabase/functions/admin-leads/logic.ts";
import { blankFollowup } from "./customerFollowups";
import { contactSinceLead, leadTab, scoreLead } from "./hotLeads";

const NOW = new Date("2026-10-09T12:00:00Z");

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    key: "email:aoife@example.com",
    name: "Aoife Byrne",
    email: "aoife@example.com",
    phone: "087 123 4567",
    source: "quoted",
    leadAt: "2026-10-04T10:00:00Z",
    leadType: "Let's Talk - Finding your Path",
    owner: "Alex",
    daysSinceLead: 5,
    status: "open",
    statusAt: null,
    statusDetail: null,
    priorSessions: 0,
    noShows: 0,
    historyStatus: "verified",
    portalStatus: "no_account",
    ...overrides,
  };
}

const attempt = (created_at: string, outcome = "no_answer", customer_key = "email:aoife@example.com") => ({
  customer_key,
  outcome,
  created_at,
});

describe("contactSinceLead", () => {
  it("counts only attempts after the lead, ignoring undos and other customers", () => {
    const contact = contactSinceLead(
      [lead()],
      [
        attempt("2026-09-20T09:00:00Z"),
        attempt("2026-10-05T09:00:00Z"),
        attempt("2026-10-07T09:00:00Z"),
        attempt("2026-10-07T10:00:00Z", "cleared"),
        attempt("2026-10-08T09:00:00Z", "no_answer", "email:other@example.com"),
      ]
    );
    expect(contact.get("email:aoife@example.com")).toEqual({
      attempts: 2,
      lastAttemptAt: "2026-10-07T09:00:00Z",
    });
    expect(contact.has("email:other@example.com")).toBe(false);
  });
});

describe("scoreLead", () => {
  it("adds recency, source and no attempts for a fresh quote", () => {
    expect(scoreLead(lead({ daysSinceLead: 1 }), undefined, NOW).score).toBe(40 + 25 + 15);
  });

  it.each([
    [0, 40],
    [2, 40],
    [3, 30],
    [7, 30],
    [14, 20],
    [30, 10],
    [60, 5],
  ])("gives a lead %i days old %i recency points", (days, points) => {
    expect(scoreLead(lead({ daysSinceLead: days }), undefined, NOW).parts[0].points).toBe(points);
  });

  it("ranks quoted + no-show over quoted over no-show", () => {
    const score = (source: LeadRow["source"]) => scoreLead(lead({ source }), undefined, NOW).score;
    expect(score("both")).toBeGreaterThan(score("quoted"));
    expect(score("quoted")).toBeGreaterThan(score("no_show"));
  });

  it("lowers the score as attempts build up and right after a call", () => {
    const fresh = scoreLead(lead(), undefined, NOW).score;
    const calledToday = scoreLead(lead(), { attempts: 1, lastAttemptAt: "2026-10-09T09:00:00Z" }, NOW);
    const calledOften = scoreLead(lead(), { attempts: 5, lastAttemptAt: "2026-10-06T09:00:00Z" }, NOW);
    expect(calledToday.score).toBe(fresh - 5 - 20);
    expect(calledOften.score).toBe(fresh - 15);
  });

  it("explains engagement points and leaves zero-point parts out", () => {
    const { parts } = scoreLead(
      lead({ priorSessions: 2, portalStatus: "has_account", noShows: 2 }),
      { attempts: 5, lastAttemptAt: "2026-10-01T09:00:00Z" },
      NOW
    );
    expect(parts.map((p) => p.label)).toEqual([
      "Lead event 5 days ago",
      "Quoted",
      "Has had a paid session before",
      "Has a portal account",
      "2 missed calls",
    ]);
  });
});

describe("leadTab", () => {
  const withOutcome = (outcome: string, outcome_at: string) => ({
    ...blankFollowup("email:aoife@example.com"),
    outcome,
    outcome_at,
  });

  it("puts Acuity conversions first", () => {
    expect(leadTab(lead({ status: "converted" }), withOutcome("not_continuing", "2026-10-06T09:00:00Z"))).toBe(
      "converted"
    );
  });

  it("closes a lead when staff record an outcome after it", () => {
    expect(leadTab(lead(), withOutcome("not_continuing", "2026-10-06T09:00:00Z"))).toBe("closed");
    expect(leadTab(lead(), withOutcome("follow_up_later", "2026-10-06T09:00:00Z"))).toBe("closed");
  });

  it("keeps a lead open after a no-answer, or an outcome from before the lead", () => {
    expect(leadTab(lead(), withOutcome("no_answer", "2026-10-06T09:00:00Z"))).toBe("open");
    expect(leadTab(lead(), withOutcome("not_continuing", "2026-09-01T09:00:00Z"))).toBe("open");
    expect(leadTab(lead(), undefined)).toBe("open");
  });

  it("separates rebooked calls", () => {
    expect(leadTab(lead({ status: "call_rebooked" }), undefined)).toBe("call_rebooked");
  });
});
