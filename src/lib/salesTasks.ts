import type { Tables } from "@/integrations/supabase/types";
import { progressionRangeSlug } from "@/lib/adminNavigation";
import {
  type SalesPriority,
  type SalesTaskKind,
  KIND_LABELS,
  SECTION_ORDER,
  compareTasks,
  daysBetween,
  dublinDate,
  progressionStageLabel,
} from "../../supabase/functions/sales-tasks/logic.ts";
import type { ScorePart } from "../../supabase/functions/admin-leads/score.ts";

// Display rules for the admin Sales Tasks page. The tasks themselves are
// made by the sales-tasks edge function (rules in its logic.ts); the page
// only groups, labels and sorts them.

export type SalesTask = Tables<"sales_tasks">;
export type { SalesPriority, SalesTaskKind };
export { KIND_LABELS, SECTION_ORDER };

export const SECTION_LABELS: Record<SalesTaskKind, { title: string; description: string }> = {
  progression: {
    title: "Progressions",
    description: "Customers between sessions 1→2, 2→3, 3→4 and 4→5 with nothing booked for a week or more.",
  },
  bundle: {
    title: "Bundles",
    description: "Stalled bundles (credits left, no session in 30+ days) and nearly-done ones (1 credit left), most urgent first.",
  },
  followup: {
    title: "Follow-ups",
    description: "Customers who asked to be called back, and tasks moved to today with “Follow up on…”.",
  },
  no_answer: {
    title: "No answers",
    description: "Customers who didn't pick up, with their next attempt due today.",
  },
  hot_lead: { title: "Hot leads", description: "Courtney's open quotes and missed Let's Talk calls." },
  psychiatry: { title: "Psychiatry", description: "Clients due a call to book their psychiatry follow-up." },
  assessment: { title: "Assessments", description: "Clients whose next assessment step isn't booked." },
};

/** How staff completed a task (the Complete pop-up). */
export type CompletionOutcome = "completed" | "no_answer";

/** "No answer · emailed and WhatsApped", for the history tab; null for older or auto-closed tasks. */
export function completionLabel(
  task: Pick<SalesTask, "completion_outcome" | "contacted_by_email" | "contacted_by_whatsapp">
): string | null {
  if (task.completion_outcome !== "no_answer") return null;
  const channels = [task.contacted_by_email && "emailed", task.contacted_by_whatsapp && "WhatsApped"].filter(Boolean);
  return channels.length ? `No answer · ${channels.join(" and ")}` : "No answer";
}

/** Completed and auto-closed tasks shown in the history tab. */
export const HISTORY_DAYS = 30;

export const PRIORITY_LABELS: Record<SalesPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Today's date in Ireland (YYYY-MM-DD), which is when tasks fall due. */
export function todayInIreland(now: number = Date.now()): string {
  return dublinDate(now);
}

// pending   — due today
// overdue   — due before today and still open
// upcoming  — moved to a later date
// completed / auto_closed — finished (history only)
export type TaskState = "pending" | "overdue" | "upcoming" | "completed" | "auto_closed";

export function taskState(task: Pick<SalesTask, "status" | "due_on">, today: string): TaskState {
  if (task.status === "completed") return "completed";
  if (task.status === "auto_closed") return "auto_closed";
  if (task.due_on < today) return "overdue";
  if (task.due_on > today) return "upcoming";
  return "pending";
}

export const STATE_LABELS: Record<TaskState, string> = {
  pending: "Due today",
  overdue: "Overdue",
  upcoming: "Scheduled",
  completed: "Completed",
  auto_closed: "Closed automatically",
};

function asSortable(task: SalesTask) {
  return {
    ...task,
    priority: (task.priority as SalesPriority) ?? "low",
  };
}

export interface TaskGroups {
  /** Due today or overdue, most important first. */
  today: SalesTask[];
  /** Moved to a later date, soonest first. */
  upcoming: SalesTask[];
}

/** Splits open tasks into today's list and later ones. Finished tasks are left out. */
export function groupTasks(tasks: readonly SalesTask[], today: string): TaskGroups {
  const open = tasks.filter((task) => task.status === "pending");
  const todayList = open
    .filter((task) => task.due_on <= today)
    .map(asSortable)
    .sort(compareTasks);
  const upcoming = open
    .filter((task) => task.due_on > today)
    .sort((a, b) => a.due_on.localeCompare(b.due_on) || b.score - a.score);
  return { today: todayList, upcoming };
}

/**
 * The section a task shows in: its kind, except that a task moved to a
 * later date with "Follow up on…" comes back under Follow-ups.
 */
export function sectionFor(task: Pick<SalesTask, "kind" | "due_on" | "original_due_on">): SalesTaskKind {
  if (task.due_on > task.original_due_on) return "followup";
  return SECTION_ORDER.includes(task.kind as SalesTaskKind) ? (task.kind as SalesTaskKind) : "hot_lead";
}

/** Session N of a progression task ("session_2" → 2), or null. */
export function progressionStage(task: Pick<SalesTask, "kind" | "lead_status">): number | null {
  if (task.kind !== "progression") return null;
  const match = /^session_(\d+)$/.exec(task.lead_status ?? "");
  return match ? Number(match[1]) : null;
}

export interface TaskSection {
  kind: SalesTaskKind;
  tasks: SalesTask[];
  /** Progressions only: the tasks per stage, 1→2 first. */
  stages?: { fromSession: number; label: string; tasks: SalesTask[] }[];
}

/**
 * Today's tasks in the page's seven sections, in working order. Each keeps
 * the order it was given (most important first); progressions are also
 * split by stage.
 */
export function groupSections(tasks: readonly SalesTask[]): TaskSection[] {
  return SECTION_ORDER.map((kind) => {
    const inSection = tasks.filter((task) => sectionFor(task) === kind);
    if (kind !== "progression") return { kind, tasks: inSection };
    const byStage = new Map<number, SalesTask[]>();
    for (const task of inSection) {
      const stage = progressionStage(task) ?? 0;
      byStage.set(stage, [...(byStage.get(stage) ?? []), task]);
    }
    const stages = [...byStage.entries()]
      .sort(([a], [b]) => a - b)
      .map(([fromSession, list]) => ({
        fromSession,
        label: fromSession ? progressionStageLabel(fromSession) : "Other",
        tasks: list,
      }));
    return { kind, tasks: stages.flatMap((stage) => stage.tasks), stages };
  });
}

/** The first section with tasks: where the page starts. */
export function firstSectionWithTasks(sections: readonly TaskSection[]): SalesTaskKind | null {
  return sections.find((section) => section.tasks.length > 0)?.kind ?? null;
}

/** e.g. "Due today", "Overdue by 2 days", "In 3 days". */
export function dueLabel(task: Pick<SalesTask, "due_on">, today: string): string {
  const days = daysBetween(today, task.due_on);
  if (days === 0) return "Due today";
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/** "Carried over 2 days" for unfinished tasks from earlier days; null otherwise. */
export function carriedOverLabel(task: Pick<SalesTask, "carried_over_count">): string | null {
  const n = task.carried_over_count;
  if (n <= 0) return null;
  return `Carried over ${n} day${n === 1 ? "" : "s"}`;
}

/** The saved priority reasons, ignoring anything malformed. */
export function priorityReasons(task: Pick<SalesTask, "priority_reasons">): ScorePart[] {
  const value: unknown = task.priority_reasons;
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter(
    (part): part is ScorePart =>
      !!part &&
      typeof part === "object" &&
      typeof (part as { label?: unknown }).label === "string" &&
      typeof (part as { points?: unknown }).points === "number"
  );
}

const SOURCE_PAGES: Record<SalesTaskKind, string> = {
  progression: "/admin/progression",
  bundle: "/admin/bundles",
  followup: "/admin/followups",
  no_answer: "/admin/no-answer",
  hot_lead: "/admin/leads",
  assessment: "/admin/assessments",
  psychiatry: "/admin/psychiatry",
};

/** The admin page the task came from, searched for this customer. */
export function sourceHref(
  task: Pick<SalesTask, "kind" | "lead_status" | "customer_email" | "customer_phone" | "customer_name">
): string {
  const stage = progressionStage(task);
  const page = stage
    ? `/admin/progression/${progressionRangeSlug(stage)}`
    : (SOURCE_PAGES[task.kind as SalesTaskKind] ?? "/admin");
  const query = task.customer_email ?? task.customer_phone ?? task.customer_name;
  return query ? `${page}?q=${encodeURIComponent(query)}` : page;
}

/** Open tasks due today or earlier (the sidebar badge). */
export function countDueTasks(tasks: readonly SalesTask[], today: string): number {
  return tasks.filter((task) => task.status === "pending" && task.due_on <= today).length;
}

/** Search box on the page: name, email, phone or service. */
export function matchesTaskSearch(task: SalesTask, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  return (
    [task.customer_name, task.customer_email, task.service_type, task.owner].some((value) =>
      (value ?? "").toLowerCase().includes(q)
    ) ||
    (digits.length >= 3 && (task.customer_phone ?? "").replace(/\D/g, "").includes(digits))
  );
}

/** Starting search for pages opened from a task (?q=…). */
export function initialSearchFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q") ?? "";
}
