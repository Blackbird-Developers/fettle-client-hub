import { describe, expect, it } from "vitest";
import type { LeadRow } from "../admin-leads/logic.ts";
import type { AssessmentRow, PsychiatryRow } from "../admin-clinical/logic.ts";
import {
  type SavedTask,
  type TaskCandidate,
  assessmentCandidates,
  compareTasks,
  daysBetween,
  dedupeKey,
  dublinDate,
  hotLeadCandidates,
  mergeCandidateSets,
  overduePart,
  planDailyRun,
  priorityFor,
  psychiatryCandidates,
  scopeCandidates,
  scoreTask,
} from "./logic.ts";

const DAY = 86_400_000;
// Friday 16 Oct 2026, 09:00 Irish time (08:00 UTC).
const NOW = Date.parse("2026-10-16T08:00:00Z");
const TODAY = "2026-10-16";

function lead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    key: "email:aoife@example.com",
    name: "Aoife Byrne",
    email: "aoife@example.com",
    phone: "087 123 4567",
    source: "quoted",
    leadAt: "2026-10-15T10:00:00Z",
    leadType: "Let's Talk - Finding your Path",
    owner: "Courtney",
    daysSinceLead: 1,
    status: "open",
    statusAt: null,
    statusDetail: null,
    priorSessions: 0,
    noShows: 0,
    historyStatus: "unverified",
    portalStatus: "no_account",
    ...overrides,
  };
}

function assessment(overrides: Partial<AssessmentRow> = {}): AssessmentRow {
  return {
    key: "email:sean@example.com",
    name: "Seán Kelly",
    email: "sean@example.com",
    phone: null,
    status: "needs_booking",
    lastStep: "screening",
    lastAt: "2026-10-13T10:00:00Z",
    lastType: "OCD Consultation + screening",
    clinician: "Dr Smith",
    daysSinceLast: 3,
    nextStep: "full",
    nextAt: null,
    nextType: null,
    ...overrides,
  };
}

function psychiatry(overrides: Partial<PsychiatryRow> = {}): PsychiatryRow {
  return {
    key: "email:mary@example.com",
    name: "Mary Walsh",
    email: "mary@example.com",
    phone: null,
    status: "due",
    lastAt: "2026-09-23T10:00:00Z",
    lastType: "Psychiatry Medication Appointment",
    psychiatrist: "Dr Rubeo",
    daysSinceLast: 23,
    contactOn: "2026-10-14T10:00:00Z",
    followUpBy: "2026-10-21T10:00:00Z",
    nextAt: null,
    nextType: null,
    appointmentsInWindow: 1,
    ...overrides,
  };
}

function candidate(overrides: Partial<TaskCandidate> = {}): TaskCandidate {
  const customerKey = overrides.customerKey ?? "email:aoife@example.com";
  const triggerAt = overrides.triggerAt ?? "2026-10-15T10:00:00Z";
  return {
    kind: "hot_lead",
    customerKey,
    dedupeKey: dedupeKey(overrides.kind ?? "hot_lead", customerKey, triggerAt),
    name: "Aoife Byrne",
    email: "aoife@example.com",
    phone: null,
    triggerAt,
    serviceType: "Let's Talk",
    owner: "Courtney",
    leadStatus: "open",
    reason: "Quoted yesterday and hasn't booked since",
    nextAction: "Call",
    baseParts: [{ label: "Quoted", points: 80 }],
    dueOn: TODAY,
    canCreate: true,
    ...overrides,
  };
}

let ids = 0;
const newId = () => `task-${++ids}`;

/** Turns a plan's inserts into saved rows, as the database would hold them. */
function saveInserts(plan: ReturnType<typeof planDailyRun>): SavedTask[] {
  return plan.inserts.map((row) => ({
    id: row.id,
    dedupe_key: row.dedupe_key,
    customer_key: row.customer_key,
    kind: row.kind,
    status: "pending",
    trigger_at: row.trigger_at,
    due_on: row.due_on,
    priority: row.priority,
    score: row.score,
    carried_over_count: 0,
    last_carried_on: null,
    created_on: row.created_on,
  }));
}

function applyUpdates(saved: SavedTask[], plan: ReturnType<typeof planDailyRun>): SavedTask[] {
  return saved.map((task) => {
    const update = plan.updates.find((u) => u.id === task.id);
    return update ? ({ ...task, ...update.patch } as SavedTask) : task;
  });
}

describe("dates", () => {
  it("uses the Irish calendar day", () => {
    // 23:30 UTC on 15 Oct is 00:30 on 16 Oct in Dublin (summer time).
    expect(dublinDate(Date.parse("2026-10-15T23:30:00Z"))).toBe("2026-10-16");
    expect(dublinDate(Date.parse("2026-12-15T23:30:00Z"))).toBe("2026-12-15");
  });

  it("counts days between dates", () => {
    expect(daysBetween("2026-10-14", "2026-10-16")).toBe(2);
    expect(daysBetween("2026-10-16", "2026-10-14")).toBe(-2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2); // across the clock change
  });
});

describe("prioritisation", () => {
  it("maps scores to levels", () => {
    expect(priorityFor(70)).toBe("high");
    expect(priorityFor(69)).toBe("medium");
    expect(priorityFor(45)).toBe("medium");
    expect(priorityFor(44)).toBe("low");
  });

  it("adds 10 points per day overdue, up to 30", () => {
    expect(overduePart(TODAY, TODAY)).toBeNull();
    expect(overduePart("2026-10-17", TODAY)).toBeNull();
    expect(overduePart("2026-10-15", TODAY)).toEqual({ label: "Overdue by 1 day", points: 10 });
    expect(overduePart("2026-10-01", TODAY)).toEqual({ label: "Overdue by 15 days", points: 30 });
  });

  it("explains the score with its parts", () => {
    const score = scoreTask([{ label: "Quoted", points: 50 }], "2026-10-14", TODAY);
    expect(score).toEqual({
      score: 70,
      priority: "high",
      parts: [
        { label: "Quoted", points: 50 },
        { label: "Overdue by 2 days", points: 20 },
      ],
    });
  });

  it("sorts by priority, then earliest due, then score, then name", () => {
    const task = (customer_name: string, priority: "high" | "medium" | "low", due_on: string, score: number) => ({
      customer_name,
      priority,
      due_on,
      score,
    });
    const sorted = [
      task("Low", "low", "2026-10-01", 10),
      task("High today", "high", TODAY, 90),
      task("High overdue", "high", "2026-10-14", 75),
      task("Medium b", "medium", TODAY, 50),
      task("Medium a", "medium", TODAY, 50),
      task("Medium higher", "medium", TODAY, 60),
    ].sort(compareTasks);
    expect(sorted.map((t) => t.customer_name)).toEqual([
      "High overdue",
      "High today",
      "Medium higher",
      "Medium a",
      "Medium b",
      "Low",
    ]);
  });
});

describe("hot lead candidates", () => {
  it("makes a candidate for an open lead, scored like the Hot leads page", () => {
    const { candidates } = hotLeadCandidates([lead()], [], new Map(), NOW);
    expect(candidates).toHaveLength(1);
    const [c] = candidates;
    expect(c.reason).toBe("Quoted yesterday and hasn't booked since");
    expect(c.nextAction).toBe("Call to follow up on the quote and book a first session");
    expect(c.dueOn).toBe(TODAY);
    // 40 (recent) + 25 (quoted) + 15 (not contacted) = 80
    expect(c.baseParts.reduce((s, p) => s + p.points, 0)).toBe(80);
    expect(c.dedupeKey).toBe("hot_lead|email:aoife@example.com|2026-10-15T10:00:00.000Z");
  });

  it("counts contact attempts since the lead and suggests another channel after three", () => {
    const attempts = ["2026-10-15T12:00:00Z", "2026-10-15T15:00:00Z", "2026-10-16T07:30:00Z"].map((created_at) => ({
      customer_key: "email:aoife@example.com",
      outcome: "no_answer",
      created_at,
    }));
    const [c] = hotLeadCandidates([lead()], attempts, new Map(), NOW).candidates;
    expect(c.nextAction).toMatch(/3 attempts so far, try SMS or email/);
    expect(c.baseParts.map((p) => p.label)).toContain("Contacted in the last 48 hours");
  });

  it("resolves converted, rebooked and staff-closed leads instead of making tasks", () => {
    const { candidates, resolutions } = hotLeadCandidates(
      [
        lead({ key: "email:a@x.ie", status: "converted", statusDetail: "Individual Therapy" }),
        lead({ key: "email:b@x.ie", status: "call_rebooked" }),
        lead({ key: "email:c@x.ie" }),
      ],
      [],
      new Map([["email:c@x.ie", { outcome: "not_continuing", outcome_at: "2026-10-16T07:00:00Z" }]]),
      NOW
    );
    expect(candidates).toHaveLength(0);
    expect(resolutions.get("hot_lead|email:a@x.ie")).toBe("Booked: Individual Therapy");
    expect(resolutions.get("hot_lead|email:b@x.ie")).toBe("Let's Talk call rebooked");
    expect(resolutions.get("hot_lead|email:c@x.ie")).toBe("Not continuing recorded by staff");
  });

  it("doesn't start tasks for leads older than 30 days", () => {
    const [c] = hotLeadCandidates([lead({ daysSinceLead: 31, leadAt: "2026-09-15T10:00:00Z" })], [], new Map(), NOW)
      .candidates;
    expect(c.canCreate).toBe(false);
  });
});

describe("assessment and psychiatry candidates", () => {
  it("makes a task for an assessment client whose next step isn't booked", () => {
    const { candidates, resolutions } = assessmentCandidates(
      [assessment(), assessment({ key: "email:b@x.ie", status: "booked" }), assessment({ key: "email:c@x.ie", status: "upcoming" })],
      [],
      NOW
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].reason).toBe("OCD Consultation + screening 3 days ago; full clinical assessment not booked");
    expect(candidates[0].nextAction).toBe("Call to book the full clinical assessment");
    // 35 (screening) + 35 (≤3 days) + 15 (not contacted) = 85
    expect(candidates[0].baseParts.reduce((s, p) => s + p.points, 0)).toBe(85);
    expect(resolutions.get("assessment|email:b@x.ie")).toBe("Next step booked");
    expect(resolutions.has("assessment|email:c@x.ie")).toBe(false);
  });

  it("makes psychiatry tasks due 3 weeks after the appointment", () => {
    const { candidates, resolutions } = psychiatryCandidates(
      [
        psychiatry(),
        psychiatry({ key: "email:o@x.ie", status: "overdue", daysSinceLast: 35, lastAt: "2026-09-11T10:00:00Z", contactOn: "2026-10-02T10:00:00Z" }),
        psychiatry({ key: "email:b@x.ie", status: "booked" }),
        psychiatry({ key: "email:n@x.ie", status: "not_due", daysSinceLast: 5 }),
      ],
      [],
      NOW
    );
    expect(candidates.map((c) => [c.customerKey, c.dueOn])).toEqual([
      ["email:mary@example.com", "2026-10-14"],
      ["email:o@x.ie", "2026-10-02"],
    ]);
    expect(candidates[1].reason).toMatch(/week-4 deadline has passed/);
    expect(resolutions.get("psychiatry|email:b@x.ie")).toBe("Follow-up appointment booked");
    expect(resolutions.get("psychiatry|email:n@x.ie")).toBe("Had another psychiatry appointment");
  });

  it("gives an overdue psychiatry task its overdue points straight away", () => {
    const set = psychiatryCandidates([psychiatry()], [], NOW);
    const plan = planDailyRun({ ...set, saved: [], now: NOW, newId });
    // 40 (due) + 15 (not contacted) + 20 (2 days overdue) = 75
    expect(plan.inserts[0]).toMatchObject({ score: 75, priority: "high", original_due_on: "2026-10-14" });
  });

  it("keeps one task per customer per kind across the merged sources", () => {
    const merged = mergeCandidateSets(
      hotLeadCandidates([lead({ key: "email:sean@example.com" })], [], new Map(), NOW),
      assessmentCandidates([assessment()], [], NOW)
    );
    const plan = planDailyRun({ ...merged, saved: [], now: NOW, newId });
    expect(plan.inserts.map((r) => r.kind).sort()).toEqual(["assessment", "hot_lead"]);
  });
});

describe("Courtney's list", () => {
  it("keeps hot leads on Courtney's calendar and drops everything else", () => {
    const { candidates } = scopeCandidates({
      candidates: [
        candidate({ customerKey: "email:a@example.com", owner: "Courtney" }),
        candidate({ customerKey: "email:b@example.com", owner: "Alex Hamm" }),
        candidate({ customerKey: "email:c@example.com", owner: null }),
        candidate({ customerKey: "email:d@example.com", kind: "psychiatry", owner: "Dr Rubeo" }),
        // Even on her calendar, assessment and psychiatry stay off for now.
        candidate({ customerKey: "email:e@example.com", kind: "assessment", owner: "Courtney" }),
      ],
      resolutions: new Map(),
    });
    expect(candidates.map((c) => c.customerKey)).toEqual(["email:a@example.com"]);
  });

  it("matches her calendar name loosely", () => {
    const owners = ["Courtney ", "courtney", "Courtney Byrne"];
    const { candidates } = scopeCandidates({
      candidates: owners.map((owner, i) => candidate({ customerKey: `email:${i}@example.com`, owner })),
      resolutions: new Map(),
    });
    expect(candidates).toHaveLength(3);
  });

  it("keeps resolutions so her open tasks still close when the client books", () => {
    const resolutions = new Map([["hot_lead|email:aoife@example.com", "Booked a session"]]);
    expect(scopeCandidates({ candidates: [], resolutions }).resolutions).toBe(resolutions);
  });
});

describe("daily run", () => {
  it("creates new tasks with their analytics fields", () => {
    const plan = planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId });
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      created_on: TODAY,
      original_due_on: TODAY,
      due_on: TODAY,
      priority: "high",
      priority_at_creation: "high",
      score: 80,
      score_at_creation: 80,
    });
    expect(plan.summary).toMatchObject({ created: 1, pending: 1 });
  });

  it("is idempotent: running again the same day changes nothing new", () => {
    const first = planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId });
    const saved = saveInserts(first);
    const second = planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved, now: NOW + 3_600_000, newId });
    expect(second.inserts).toHaveLength(0);
    expect(second.events).toHaveLength(0);
    expect(second.summary).toMatchObject({ created: 0, carriedOver: 0, pending: 1 });
  });

  it("doesn't create two tasks when the same customer appears twice", () => {
    const plan = planDailyRun({
      candidates: [candidate(), candidate({ triggerAt: "2026-10-14T10:00:00Z" })],
      resolutions: new Map(),
      saved: [],
      now: NOW,
      newId,
    });
    expect(plan.inserts).toHaveLength(1);
  });

  it("carries unfinished tasks over once a day, keeping their original context", () => {
    const saved = saveInserts(planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId }));
    const tomorrow = NOW + DAY;
    const next = planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved, now: tomorrow, newId });
    expect(next.inserts).toHaveLength(0);
    const patch = next.updates[0].patch;
    expect(patch).toMatchObject({ carried_over_count: 1, last_carried_on: "2026-10-17" });
    expect(patch).not.toHaveProperty("due_on");
    expect(patch).not.toHaveProperty("created_on");
    expect(next.events.find((e) => e.event === "carried_over")?.details).toMatchObject({ days_overdue: 1, times: 1 });

    // A second run the same day doesn't count it again.
    const again = planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: applyUpdates(saved, next), now: tomorrow + 60_000, newId });
    expect(again.summary.carriedOver).toBe(0);
    expect(again.updates[0]?.patch ?? {}).not.toHaveProperty("carried_over_count");
  });

  it("doesn't carry over a task on the day it was made, even if it started overdue", () => {
    const late = candidate({ dueOn: "2026-09-12" });
    const saved = saveInserts(planDailyRun({ candidates: [late], resolutions: new Map(), saved: [], now: NOW, newId }));
    const sameDay = planDailyRun({ candidates: [late], resolutions: new Map(), saved, now: NOW + 3_600_000, newId });
    expect(sameDay.summary.carriedOver).toBe(0);
    const nextDay = planDailyRun({ candidates: [late], resolutions: new Map(), saved, now: NOW + DAY, newId });
    expect(nextDay.summary.carriedOver).toBe(1);
  });

  it("carries over even when the lead has dropped out of the source data", () => {
    const saved = saveInserts(planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId }));
    const next = planDailyRun({ candidates: [], resolutions: new Map(), saved, now: NOW + 2 * DAY, newId });
    expect(next.updates[0].patch).toMatchObject({ carried_over_count: 1 });
    expect(next.summary.autoClosed).toBe(0);
  });

  it("raises priority as a task becomes overdue and logs the change", () => {
    const medium = candidate({ baseParts: [{ label: "Quoted", points: 50 }] });
    const saved = saveInserts(planDailyRun({ candidates: [medium], resolutions: new Map(), saved: [], now: NOW, newId }));
    expect(saved[0].priority).toBe("medium");
    const next = planDailyRun({ candidates: [medium], resolutions: new Map(), saved, now: NOW + 2 * DAY, newId });
    expect(next.updates[0].patch).toMatchObject({ priority: "high", score: 70 });
    expect(next.events.find((e) => e.event === "priority_changed")?.details).toEqual({ from: "medium", to: "high", score: 70 });
  });

  it("never brings back a completed task for the same event", () => {
    const saved = saveInserts(planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId }));
    const completed = saved.map((t) => ({ ...t, status: "completed" as const }));
    const next = planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: completed, now: NOW + DAY, newId });
    expect(next.inserts).toHaveLength(0);
    expect(next.updates).toHaveLength(0);
    expect(next.summary.pending).toBe(0);
  });

  it("does create a task for a newer event after the old one was completed", () => {
    const saved = saveInserts(planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId }));
    const completed = saved.map((t) => ({ ...t, status: "completed" as const }));
    const newer = candidate({ triggerAt: "2026-10-17T10:00:00Z" });
    const next = planDailyRun({ candidates: [newer], resolutions: new Map(), saved: completed, now: NOW + 2 * DAY, newId });
    expect(next.inserts).toHaveLength(1);
    expect(next.inserts[0].dedupe_key).toBe(newer.dedupeKey);
  });

  it("moves an open task onto a newer event instead of adding a second one", () => {
    const saved = saveInserts(planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId }));
    // Courtney had pushed it to next week.
    saved[0].due_on = "2026-10-23";
    const newer = candidate({ triggerAt: "2026-10-17T10:00:00Z", dueOn: "2026-10-17" });
    const next = planDailyRun({ candidates: [newer], resolutions: new Map(), saved, now: NOW + DAY, newId });
    expect(next.inserts).toHaveLength(0);
    expect(next.updates[0].patch).toMatchObject({
      dedupe_key: newer.dedupeKey,
      trigger_at: newer.triggerAt,
      due_on: "2026-10-17",
    });
    expect(next.events.map((e) => e.event)).toContain("context_updated");
  });

  it("auto-closes an open task once the source shows it's dealt with", () => {
    const saved = saveInserts(planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId }));
    const next = planDailyRun({
      candidates: [],
      resolutions: new Map([["hot_lead|email:aoife@example.com", "Booked a session"]]),
      saved,
      now: NOW + DAY,
      newId,
    });
    expect(next.updates[0].patch).toMatchObject({
      status: "auto_closed",
      closed_reason: "Booked a session",
      priority_at_completion: "high",
      score_at_completion: 80,
    });
    expect(next.summary).toMatchObject({ autoClosed: 1, pending: 0, carriedOver: 0 });
  });

  it("leaves tasks the user moved to a later date alone until then", () => {
    const saved = saveInserts(planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved: [], now: NOW, newId }));
    saved[0].due_on = "2026-10-20";
    const next = planDailyRun({ candidates: [candidate()], resolutions: new Map(), saved, now: NOW + DAY, newId });
    expect(next.summary.carriedOver).toBe(0);
    expect(next.updates[0]?.patch ?? {}).not.toHaveProperty("due_on");
  });
});
