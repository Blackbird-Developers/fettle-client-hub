// Pure logic for the sales-tasks edge function: the admin "Sales Tasks" page,
// a daily prioritised call list built from three existing admin views:
//   hot_lead    — Hot leads that are still open (admin-leads)
//   assessment  — assessment clients whose next step isn't booked (admin-clinical)
//   psychiatry  — psychiatry clients due or overdue their follow-up call (admin-clinical)
//
// Each morning planDailyRun() compares what those views say now with the
// tasks already saved, and returns what to insert, update and close. It is
// safe to run any number of times a day: a task is identified by its
// dedupe_key (kind + customer + the Acuity event behind it), carrying over
// happens at most once a day, and finished tasks are never touched.
//
// No Deno or network imports, so the same file runs inside the edge function
// and under Vitest (logic.test.ts).

import { DAY_MS } from "../admin-customer-insights/logic.ts";
import type { LeadRow, LeadSource } from "../admin-leads/logic.ts";
import {
  type LeadContact,
  type LeadFollowup,
  type ScorePart,
  contactSinceLead,
  leadTab,
  scoreLead,
} from "../admin-leads/score.ts";
import type { RecentAttempt } from "../admin-leads/score.ts";
import {
  type AssessmentRow,
  type PsychiatryRow,
  NEXT_STEP_LABELS,
} from "../admin-clinical/logic.ts";

export type SalesTaskKind = "hot_lead" | "assessment" | "psychiatry";
export type SalesPriority = "high" | "medium" | "low";
export type SalesTaskStatus = "pending" | "completed" | "auto_closed";

/** New hot-lead tasks only for lead events up to this many days old (older open leads stay on Hot leads). */
export const HOT_LEAD_TASK_MAX_AGE_DAYS = 30;

// Priority levels from the score. Starting values, to be reviewed with
// Courtney after a few weeks of use.
export const HIGH_PRIORITY_SCORE = 70;
export const MEDIUM_PRIORITY_SCORE = 45;

/** Points per day a task is past its due date, up to OVERDUE_MAX_POINTS. */
const OVERDUE_POINTS_PER_DAY = 10;
const OVERDUE_MAX_POINTS = 30;
const RECENTLY_CONTACTED_HOURS = 48;

export const KIND_LABELS: Record<SalesTaskKind, string> = {
  hot_lead: "Hot lead",
  assessment: "Assessment",
  psychiatry: "Psychiatry",
};

// Whose list this is. Tasks are only made for events on these Acuity
// calendars, and only of these kinds: for now, Courtney's own calendar and
// her hot leads (Let's Talk calls and quotes). Assessment and psychiatry
// clients stay on their own admin pages until Fettle confirms Courtney should
// chase them; widening the list is a change to these two constants.
// Calendar names are matched loosely (case, stray spaces, a surname added).
export const SALES_TASK_CALENDARS: readonly string[] = ["courtney"];
export const SALES_TASK_KINDS: readonly SalesTaskKind[] = ["hot_lead"];

export function inSalesScope(candidate: Pick<TaskCandidate, "kind" | "owner">): boolean {
  const calendar = candidate.owner?.trim().toLowerCase() ?? "";
  return (
    SALES_TASK_KINDS.includes(candidate.kind) &&
    SALES_TASK_CALENDARS.some((name) => calendar.includes(name))
  );
}

// ---------------------------------------------------------------------------
// Dates (Irish calendar days, as staff see them)
// ---------------------------------------------------------------------------

const DUBLIN_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Dublin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD in Irish time. */
export function dublinDate(ms: number): string {
  return DUBLIN_DATE.format(new Date(ms));
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function ago(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export function priorityFor(score: number): SalesPriority {
  if (score >= HIGH_PRIORITY_SCORE) return "high";
  if (score >= MEDIUM_PRIORITY_SCORE) return "medium";
  return "low";
}

/** Points for being past the due date; null when not overdue. */
export function overduePart(dueOn: string, today: string): ScorePart | null {
  const days = daysBetween(dueOn, today);
  if (days <= 0) return null;
  return {
    label: `Overdue by ${days} day${days === 1 ? "" : "s"}`,
    points: Math.min(days * OVERDUE_POINTS_PER_DAY, OVERDUE_MAX_POINTS),
  };
}

export interface TaskScore {
  score: number;
  priority: SalesPriority;
  parts: ScorePart[];
}

/** The candidate's own reasons plus the overdue bonus for the given due date. */
export function scoreTask(baseParts: readonly ScorePart[], dueOn: string, today: string): TaskScore {
  const parts = [...baseParts];
  const overdue = overduePart(dueOn, today);
  if (overdue) parts.push(overdue);
  const score = parts.reduce((sum, part) => sum + part.points, 0);
  return { score, priority: priorityFor(score), parts };
}

const PRIORITY_RANK: Record<SalesPriority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Order for the task list: highest priority first, then the most overdue
 * (earliest due date), then the highest score, then by name.
 */
export function compareTasks<
  T extends { priority: SalesPriority; due_on: string; score: number; customer_name: string | null },
>(a: T, b: T): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.due_on.localeCompare(b.due_on) ||
    b.score - a.score ||
    (a.customer_name ?? "").localeCompare(b.customer_name ?? "")
  );
}

// Shared by assessment and psychiatry tasks (hot leads use scoreLead's own).
function attemptsPart(contact: LeadContact | undefined): ScorePart {
  const attempts = contact?.attempts ?? 0;
  const points = attempts === 0 ? 15 : attempts <= 2 ? 10 : attempts <= 4 ? 5 : 0;
  return {
    label: attempts === 0 ? "Not contacted yet" : `${attempts} attempt${attempts === 1 ? "" : "s"} since`,
    points,
  };
}

function recentContactPart(contact: LeadContact | undefined, now: number): ScorePart | null {
  if (!contact?.lastAttemptAt) return null;
  const hours = (now - Date.parse(contact.lastAttemptAt)) / 3_600_000;
  return hours < RECENTLY_CONTACTED_HOURS ? { label: "Contacted in the last 48 hours", points: -20 } : null;
}

function keep(parts: (ScorePart | null)[]): ScorePart[] {
  return parts.filter((part): part is ScorePart => part !== null && part.points !== 0);
}

// ---------------------------------------------------------------------------
// Candidates: one per customer and kind that needs, or still has, a task
// ---------------------------------------------------------------------------

export interface TaskCandidate {
  kind: SalesTaskKind;
  customerKey: string;
  dedupeKey: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** The Acuity event behind the task. */
  triggerAt: string;
  serviceType: string | null;
  owner: string | null;
  leadStatus: string;
  reason: string;
  nextAction: string;
  /** Reasons and points, before the overdue bonus. */
  baseParts: ScorePart[];
  /** Due date for a new task (YYYY-MM-DD). */
  dueOn: string;
  /** False when the event is too old to start a new task (an existing one is still kept up to date). */
  canCreate: boolean;
}

/** kind + customer + event time: the same event never makes two tasks. */
export function dedupeKey(kind: SalesTaskKind, customerKey: string, triggerAt: string): string {
  return `${kind}|${customerKey}|${new Date(triggerAt).toISOString()}`;
}

/**
 * Why a customer no longer needs a task of this kind (used to close an open
 * one automatically). Only customers the source view still lists appear here.
 */
export type Resolutions = Map<string, string>;

export const taskSlot = (kind: SalesTaskKind, customerKey: string) => `${kind}|${customerKey}`;

export interface CandidateSet {
  candidates: TaskCandidate[];
  resolutions: Resolutions;
}

const HOT_LEAD_ACTIONS: Record<LeadSource, string> = {
  quoted: "Call to follow up on the quote and book a first session",
  no_show: "Call to rebook the missed Let's Talk call",
  both: "Call to rebook the Let's Talk call and follow up on the quote",
};

function hotLeadReason(row: LeadRow): string {
  const when = ago(row.daysSinceLead);
  if (row.source === "quoted") return `Quoted ${when} and hasn't booked since`;
  if (row.source === "no_show") return `Missed a Let's Talk call ${when} and hasn't rebooked`;
  return `Quoted and missed a Let's Talk call (latest ${when}); not booked since`;
}

function retryAction(attempts: number, action: string): string {
  return attempts >= 3 ? `${action} — ${attempts} attempts so far, try SMS or email` : action;
}

const OUTCOME_LABELS: Record<string, string> = {
  not_continuing: "Not continuing",
  follow_up_later: "Continue later",
  booked: "Booked",
};

export function hotLeadCandidates(
  rows: readonly LeadRow[],
  attempts: readonly RecentAttempt[],
  followups: ReadonlyMap<string, LeadFollowup>,
  now: number
): CandidateSet {
  const today = dublinDate(now);
  const contacts = contactSinceLead(rows, attempts);
  const candidates: TaskCandidate[] = [];
  const resolutions: Resolutions = new Map();

  for (const row of rows) {
    const followup = followups.get(row.key);
    const tab = leadTab(row, followup);
    const slot = taskSlot("hot_lead", row.key);
    if (tab === "converted") {
      resolutions.set(slot, row.statusDetail ? `Booked: ${row.statusDetail}` : "Booked a session");
      continue;
    }
    if (tab === "call_rebooked") {
      resolutions.set(slot, "Let's Talk call rebooked");
      continue;
    }
    if (tab === "closed") {
      const label = OUTCOME_LABELS[followup?.outcome ?? ""] ?? "An outcome";
      resolutions.set(slot, `${label} recorded by staff`);
      continue;
    }

    const contact = contacts.get(row.key);
    const score = scoreLead(row, contact, new Date(now));
    candidates.push({
      kind: "hot_lead",
      customerKey: row.key,
      dedupeKey: dedupeKey("hot_lead", row.key, row.leadAt),
      name: row.name,
      email: row.email,
      phone: row.phone,
      triggerAt: row.leadAt,
      serviceType: row.leadType,
      owner: row.owner,
      leadStatus: row.status,
      reason: hotLeadReason(row),
      nextAction: retryAction(contact?.attempts ?? 0, HOT_LEAD_ACTIONS[row.source]),
      baseParts: score.parts,
      dueOn: today,
      canCreate: row.daysSinceLead <= HOT_LEAD_TASK_MAX_AGE_DAYS,
    });
  }
  return { candidates, resolutions };
}

const STEP_PARTS: Record<string, ScorePart> = {
  screening: { label: "Screening done, full assessment not booked", points: 35 },
  full: { label: "Full assessment done, aftercare not booked", points: 30 },
  other: { label: "Assessment done, next step not booked", points: 25 },
};

function assessmentRecencyPart(days: number): ScorePart {
  const points = days <= 3 ? 35 : days <= 7 ? 30 : days <= 14 ? 20 : days <= 30 ? 10 : 5;
  return { label: `Last assessment ${ago(days)}`, points };
}

export function assessmentCandidates(
  rows: readonly AssessmentRow[],
  attempts: readonly RecentAttempt[],
  now: number
): CandidateSet {
  const today = dublinDate(now);
  const waiting = rows.filter((row) => row.status === "needs_booking" && row.lastAt && row.lastStep);
  const contacts = contactSinceLead(
    waiting.map((row) => ({ key: row.key, leadAt: row.lastAt! })),
    attempts
  );
  const candidates: TaskCandidate[] = [];
  const resolutions: Resolutions = new Map();

  for (const row of rows) {
    const slot = taskSlot("assessment", row.key);
    if (row.status === "booked") resolutions.set(slot, "Next step booked");
    if (row.status === "in_therapy") resolutions.set(slot, "Started aftercare therapy");
  }

  for (const row of waiting) {
    const contact = contacts.get(row.key);
    const next = row.nextStep ? NEXT_STEP_LABELS[row.nextStep] : "the next step";
    candidates.push({
      kind: "assessment",
      customerKey: row.key,
      dedupeKey: dedupeKey("assessment", row.key, row.lastAt!),
      name: row.name,
      email: row.email,
      phone: row.phone,
      triggerAt: row.lastAt!,
      serviceType: row.lastType,
      owner: row.clinician,
      leadStatus: row.status,
      reason: `${row.lastType ?? "Assessment"} ${ago(row.daysSinceLast ?? 0)}; ${next.toLowerCase()} not booked`,
      nextAction: retryAction(contact?.attempts ?? 0, `Call to book the ${next.toLowerCase()}`),
      baseParts: keep([
        STEP_PARTS[row.lastStep!],
        assessmentRecencyPart(row.daysSinceLast ?? 0),
        attemptsPart(contact),
        recentContactPart(contact, now),
      ]),
      dueOn: today,
      canCreate: true,
    });
  }
  return { candidates, resolutions };
}

export function psychiatryCandidates(
  rows: readonly PsychiatryRow[],
  attempts: readonly RecentAttempt[],
  now: number
): CandidateSet {
  const waiting = rows.filter(
    (row) => (row.status === "due" || row.status === "overdue") && row.lastAt && row.contactOn
  );
  const contacts = contactSinceLead(
    waiting.map((row) => ({ key: row.key, leadAt: row.lastAt! })),
    attempts
  );
  const candidates: TaskCandidate[] = [];
  const resolutions: Resolutions = new Map();

  for (const row of rows) {
    const slot = taskSlot("psychiatry", row.key);
    if (row.status === "booked") resolutions.set(slot, "Follow-up appointment booked");
    // A newer appointment restarted the 3-week clock; a new task follows when it's due.
    if (row.status === "not_due") resolutions.set(slot, "Had another psychiatry appointment");
  }

  for (const row of waiting) {
    const contact = contacts.get(row.key);
    const overdue = row.status === "overdue";
    candidates.push({
      kind: "psychiatry",
      customerKey: row.key,
      dedupeKey: dedupeKey("psychiatry", row.key, row.lastAt!),
      name: row.name,
      email: row.email,
      phone: row.phone,
      triggerAt: row.lastAt!,
      serviceType: row.lastType,
      owner: row.psychiatrist,
      leadStatus: row.status,
      reason: `Psychiatry appointment ${ago(row.daysSinceLast ?? 0)}; no follow-up booked${
        overdue ? " and the week-4 deadline has passed" : ""
      }`,
      nextAction: retryAction(
        contact?.attempts ?? 0,
        overdue ? "Call today to book the overdue psychiatry follow-up" : "Call to book the week-4 psychiatry follow-up"
      ),
      baseParts: keep([
        overdue
          ? { label: "Past the week-4 follow-up deadline", points: 50 }
          : { label: "Due a 3-week follow-up call", points: 40 },
        attemptsPart(contact),
        recentContactPart(contact, now),
      ]),
      // The call is due 3 weeks after the appointment.
      dueOn: dublinDate(Date.parse(row.contactOn!)),
      canCreate: true,
    });
  }
  return { candidates, resolutions };
}

export function mergeCandidateSets(...sets: CandidateSet[]): CandidateSet {
  return {
    candidates: sets.flatMap((set) => set.candidates),
    resolutions: new Map(sets.flatMap((set) => [...set.resolutions])),
  };
}

/** Keeps only the candidates on Courtney's list (see inSalesScope). Resolutions are kept so her open tasks still close. */
export function scopeCandidates(set: CandidateSet): CandidateSet {
  return { candidates: set.candidates.filter(inSalesScope), resolutions: set.resolutions };
}

// ---------------------------------------------------------------------------
// The daily run
// ---------------------------------------------------------------------------

/** A saved task, as much as the planner needs. */
export interface SavedTask {
  id: string;
  dedupe_key: string;
  customer_key: string;
  kind: SalesTaskKind;
  status: SalesTaskStatus;
  trigger_at: string;
  due_on: string;
  priority: SalesPriority;
  score: number;
  carried_over_count: number;
  last_carried_on: string | null;
  created_on: string;
}

export interface TaskEvent {
  task_id: string;
  event: "created" | "carried_over" | "priority_changed" | "context_updated" | "auto_closed";
  details: Record<string, unknown>;
}

/** Columns for a new sales_tasks row. */
export interface NewTaskRow {
  id: string;
  dedupe_key: string;
  customer_key: string;
  kind: SalesTaskKind;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  trigger_at: string;
  service_type: string | null;
  owner: string | null;
  lead_status: string;
  reason: string;
  priority_reasons: ScorePart[];
  next_action: string;
  priority: SalesPriority;
  score: number;
  created_on: string;
  priority_at_creation: SalesPriority;
  score_at_creation: number;
  original_due_on: string;
  due_on: string;
}

export interface TaskUpdate {
  id: string;
  patch: Record<string, unknown>;
}

export interface DailyPlan {
  inserts: NewTaskRow[];
  updates: TaskUpdate[];
  /** Events for updated tasks. Events for inserts are built once the insert is confirmed (createdEvent). */
  events: TaskEvent[];
  summary: {
    created: number;
    carriedOver: number;
    autoClosed: number;
    priorityChanged: number;
    contextUpdated: number;
    pending: number;
  };
}

export interface PlanInput {
  candidates: readonly TaskCandidate[];
  resolutions: Resolutions;
  /** Every pending task, plus any task (any status) whose dedupe_key a candidate uses. */
  saved: readonly SavedTask[];
  now: number;
  /** Makes ids for new tasks (crypto.randomUUID in the function). */
  newId: () => string;
}

export function createdEvent(row: NewTaskRow): TaskEvent {
  return {
    task_id: row.id,
    event: "created",
    details: {
      kind: row.kind,
      reason: row.reason,
      priority: row.priority,
      score: row.score,
      due_on: row.due_on,
      trigger_at: row.trigger_at,
      service_type: row.service_type,
    },
  };
}

function snapshot(candidate: TaskCandidate, score: TaskScore) {
  return {
    customer_name: candidate.name,
    customer_email: candidate.email,
    customer_phone: candidate.phone,
    service_type: candidate.serviceType,
    owner: candidate.owner,
    lead_status: candidate.leadStatus,
    reason: candidate.reason,
    next_action: candidate.nextAction,
    priority_reasons: score.parts,
    priority: score.priority,
    score: score.score,
  };
}

export function planDailyRun({ candidates, resolutions, saved, now, newId }: PlanInput): DailyPlan {
  const today = dublinDate(now);
  const nowIso = new Date(now).toISOString();
  const takenKeys = new Set(saved.map((task) => task.dedupe_key));
  const pendingBySlot = new Map(
    saved.filter((task) => task.status === "pending").map((task) => [taskSlot(task.kind, task.customer_key), task])
  );
  const candidateBySlot = new Map(candidates.map((c) => [taskSlot(c.kind, c.customerKey), c]));

  const plan: DailyPlan = {
    inserts: [],
    updates: [],
    events: [],
    summary: { created: 0, carriedOver: 0, autoClosed: 0, priorityChanged: 0, contextUpdated: 0, pending: 0 },
  };

  // 1. Open tasks: close, refresh, carry over.
  for (const [slot, task] of pendingBySlot) {
    const resolution = resolutions.get(slot);
    const candidate = candidateBySlot.get(slot);

    // The source says it's dealt with — unless a newer event (a candidate)
    // needs action again.
    if (resolution && !candidate) {
      plan.updates.push({
        id: task.id,
        patch: {
          status: "auto_closed",
          completed_at: nowIso,
          closed_reason: resolution,
          priority_at_completion: task.priority,
          score_at_completion: task.score,
          updated_at: nowIso,
        },
      });
      plan.events.push({ task_id: task.id, event: "auto_closed", details: { reason: resolution, priority: task.priority } });
      plan.summary.autoClosed++;
      continue;
    }

    const patch: Record<string, unknown> = {};
    let dueOn = task.due_on;

    if (candidate) {
      // A newer event for the same customer moves the task onto it, unless
      // that event already had a task that was finished.
      if (candidate.dedupeKey !== task.dedupe_key && !takenKeys.has(candidate.dedupeKey)) {
        patch.dedupe_key = candidate.dedupeKey;
        patch.trigger_at = candidate.triggerAt;
        takenKeys.add(candidate.dedupeKey);
        if (candidate.dueOn < dueOn) dueOn = candidate.dueOn;
        plan.events.push({
          task_id: task.id,
          event: "context_updated",
          details: { from_trigger: task.trigger_at, to_trigger: candidate.triggerAt, reason: candidate.reason },
        });
        plan.summary.contextUpdated++;
      }
      if (dueOn !== task.due_on) patch.due_on = dueOn;
      const score = scoreTask(candidate.baseParts, dueOn, today);
      Object.assign(patch, snapshot(candidate, score));
      if (score.priority !== task.priority) {
        plan.events.push({
          task_id: task.id,
          event: "priority_changed",
          details: { from: task.priority, to: score.priority, score: score.score },
        });
        plan.summary.priorityChanged++;
      }
    }

    // Still open after its due date: carried over (once per day). A task made
    // today isn't carried over yet, even if it started out overdue.
    if (dueOn < today && task.last_carried_on !== today && task.created_on !== today) {
      patch.carried_over_count = task.carried_over_count + 1;
      patch.last_carried_on = today;
      plan.events.push({
        task_id: task.id,
        event: "carried_over",
        details: { due_on: dueOn, days_overdue: daysBetween(dueOn, today), times: task.carried_over_count + 1 },
      });
      plan.summary.carriedOver++;
    }

    plan.summary.pending++;
    if (Object.keys(patch).length > 0) {
      patch.updated_at = nowIso;
      plan.updates.push({ id: task.id, patch });
    }
  }

  // 2. New tasks: one per customer and kind, never for an event that already had one.
  const filledSlots = new Set(pendingBySlot.keys());
  for (const candidate of candidates) {
    const slot = taskSlot(candidate.kind, candidate.customerKey);
    if (!candidate.canCreate || filledSlots.has(slot) || takenKeys.has(candidate.dedupeKey)) continue;
    filledSlots.add(slot);
    takenKeys.add(candidate.dedupeKey);
    const score = scoreTask(candidate.baseParts, candidate.dueOn, today);
    plan.inserts.push({
      id: newId(),
      dedupe_key: candidate.dedupeKey,
      customer_key: candidate.customerKey,
      kind: candidate.kind,
      trigger_at: candidate.triggerAt,
      ...snapshot(candidate, score),
      lead_status: candidate.leadStatus,
      next_action: candidate.nextAction,
      created_on: today,
      priority_at_creation: score.priority,
      score_at_creation: score.score,
      original_due_on: candidate.dueOn,
      due_on: candidate.dueOn,
    });
    plan.summary.created++;
    plan.summary.pending++;
  }

  return plan;
}

/** Dedupe keys the planner needs saved tasks for (besides every pending one). */
export function candidateKeys(candidates: readonly TaskCandidate[]): string[] {
  return [...new Set(candidates.map((c) => c.dedupeKey))];
}
