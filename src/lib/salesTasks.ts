import type { Tables } from "@/integrations/supabase/types";
import {
  type SalesPriority,
  type SalesTaskKind,
  KIND_LABELS,
  compareTasks,
  daysBetween,
  dublinDate,
} from "../../supabase/functions/sales-tasks/logic.ts";
import type { ScorePart } from "../../supabase/functions/admin-leads/score.ts";

// Display rules for the admin Sales Tasks page. The tasks themselves are
// made by the sales-tasks edge function (rules in its logic.ts); the page
// only groups, labels and sorts them.

export type SalesTask = Tables<"sales_tasks">;
export type { SalesPriority, SalesTaskKind };
export { KIND_LABELS };

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
  hot_lead: "/admin/leads",
  assessment: "/admin/assessments",
  psychiatry: "/admin/psychiatry",
};

/** The admin page the task came from, searched for this customer. */
export function sourceHref(
  task: Pick<SalesTask, "kind" | "customer_email" | "customer_phone" | "customer_name">
): string {
  const page = SOURCE_PAGES[task.kind as SalesTaskKind] ?? "/admin";
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
