import { addDays, format, parseISO, startOfDay } from "date-fns";
import type { DatePresetId, DayRange } from "@/lib/datePresets";
import type { Tables } from "@/integrations/supabase/types";
import { KIND_LABELS } from "@/lib/salesTasks";
import { OUTCOME_LABELS, contactFromKey, describeReasons, isContactOutcome } from "@/lib/contactOutcomes";
import { FEEDBACK_STATUSES } from "@/lib/hubFeedback";

// Display rules for the admin Activity log: what staff did, as sentences.
// Rows are written by database triggers and two edge functions (see the
// admin_activity migration); the page only reads them.

export type ActivityRow = Tables<"admin_activity">;

export const ACTIVITY_ACTIONS = [
  { id: "task.completed", label: "Task completed" },
  { id: "task.reopened", label: "Task reopened" },
  { id: "task.due_moved", label: "Task date moved" },
  { id: "task.note_edited", label: "Task note edited" },
  { id: "tasks.list_prepared", label: "Sales Tasks list prepared" },
  { id: "customer.outcome_logged", label: "Contact outcome logged" },
  { id: "customer.contacted_changed", label: "Contacted ticked/unticked" },
  { id: "customer.note_edited", label: "Customer note edited" },
  { id: "sequence.closed", label: "No-answer sequence closed" },
  { id: "sequence.restarted", label: "No-answer sequence restarted" },
  { id: "feedback.status_changed", label: "Feedback status changed" },
  { id: "team.admin_added", label: "Admin added" },
  { id: "team.admin_removed", label: "Admin removed" },
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]["id"];

export const ACTIVITY_PAGE_SIZE = 25;

/** The date picker's presets on the Activity log. */
export const ACTIVITY_PRESETS: readonly DatePresetId[] = [
  "today",
  "yesterday",
  "thisWeek",
  "lastWeek",
  "last7",
  "last14",
  "last30",
  "thisMonth",
  "lastMonth",
  "allTime",
];

export const DEFAULT_ACTIVITY_PRESET: DatePresetId = "last7";

/** The earliest day the log can hold (history was copied from October 2026). */
export const LOG_START_DAY = "2026-01-01";

/**
 * Start (inclusive) and end (exclusive) of a range of "yyyy-MM-dd" days, as
 * ISO times. Days are local days; staff are in Ireland.
 */
export function activityBounds(range: DayRange): { from: string; to: string } {
  return {
    from: startOfDay(parseISO(range.from)).toISOString(),
    to: startOfDay(addDays(parseISO(range.to), 1)).toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** Who the row is about: their name, else the email or phone in the key. */
export function activityCustomer(row: Pick<ActivityRow, "customer_name" | "customer_key">): string | null {
  if (row.customer_name?.trim()) return row.customer_name.trim();
  if (!row.customer_key) return null;
  const { email, phone } = contactFromKey(row.customer_key);
  return email ?? phone ?? null;
}

function taskLabel(details: Record<string, unknown>): string {
  const kind = text(details.kind);
  const label = kind && kind in KIND_LABELS ? KIND_LABELS[kind as keyof typeof KIND_LABELS] : null;
  return label ? `${label} task` : "task";
}

function dayLabel(value: unknown): string | null {
  const day = text(value);
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return format(parseISO(day), "d MMM");
}

const FEEDBACK_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  FEEDBACK_STATUSES.map((s) => [s.id, s.label])
);

const METHOD_LABELS: Record<string, string> = {
  call: "call",
  email: "email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  other: "other",
};

export interface ActivityDescription {
  /** What they did, e.g. "Completed a Bundle task: No answer (emailed)". */
  summary: string;
  /** Extra context, e.g. the new note or a close reason. */
  detail: string | null;
}

/** One log row as a sentence (without the staff member, shown separately). */
export function describeActivity(row: { action: string; details: unknown }): ActivityDescription {
  const d = asRecord(row.details);

  switch (row.action) {
    case "task.completed": {
      if (d.outcome === "no_answer") {
        const channels = [d.emailed === true && "emailed", d.whatsapped === true && "WhatsApp sent"].filter(Boolean);
        return {
          summary: `Completed a ${taskLabel(d)}: No answer${channels.length ? ` (${channels.join(", ")})` : ""}`,
          detail: null,
        };
      }
      return { summary: `Completed a ${taskLabel(d)}`, detail: null };
    }
    case "task.reopened":
      return { summary: `Reopened a ${taskLabel(d)}`, detail: text(d.reason) };
    case "task.due_moved": {
      const from = dayLabel(d.from);
      const to = dayLabel(d.to);
      return {
        summary: `Moved a ${taskLabel(d)}${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}`,
        detail: null,
      };
    }
    case "task.note_edited": {
      const note = text(d.to);
      // History copied from before the log only knows the note's length.
      const cleared = "to" in d ? note === null : d.length === 0;
      return {
        summary: cleared ? `Cleared the note on a ${taskLabel(d)}` : `Edited the note on a ${taskLabel(d)}`,
        detail: note,
      };
    }
    case "tasks.list_prepared": {
      const created = typeof d.created === "number" ? d.created : null;
      return {
        summary: "Prepared the Sales Tasks list",
        detail: created === null ? null : `${created} new task${created === 1 ? "" : "s"}`,
      };
    }
    case "customer.outcome_logged": {
      if (d.outcome === "cleared") return { summary: "Cleared the contact outcome", detail: text(d.note) };
      const outcome = isContactOutcome(text(d.outcome)) ? OUTCOME_LABELS[d.outcome as keyof typeof OUTCOME_LABELS].short : "an outcome";
      const method = text(d.method);
      const attempt = typeof d.attempt_number === "number" ? `attempt ${d.attempt_number}` : null;
      const extras = [method && METHOD_LABELS[method], attempt].filter(Boolean);
      const reasons = Array.isArray(d.reasons)
        ? describeReasons(d.reasons as string[], text(d.reason_other))
        : null;
      return {
        summary: `Logged "${outcome}"${extras.length ? ` (${extras.join(", ")})` : ""}`,
        detail: [reasons, text(d.note)].filter(Boolean).join(" · ") || null,
      };
    }
    case "customer.contacted_changed":
      return { summary: d.to === true ? "Marked as contacted" : "Unmarked as contacted", detail: null };
    case "customer.note_edited": {
      const note = text(d.to);
      return { summary: note ? "Edited the customer note" : "Cleared the customer note", detail: note };
    }
    case "sequence.closed":
      return { summary: "Closed the no-answer sequence", detail: text(d.reason) };
    case "sequence.restarted":
      return { summary: "Restarted the no-answer sequence", detail: null };
    case "feedback.status_changed": {
      const to = FEEDBACK_STATUS_LABELS[String(d.to)] ?? String(d.to ?? "");
      const from = d.from ? FEEDBACK_STATUS_LABELS[String(d.from)] ?? String(d.from) : null;
      return { summary: `Marked feedback as ${to}${from ? ` (was ${from})` : ""}`, detail: null };
    }
    case "team.admin_added":
      return { summary: `Gave admin access to ${text(d.email) ?? "a user"}`, detail: null };
    case "team.admin_removed":
      return { summary: `Removed admin access from ${text(d.email) ?? "a user"}`, detail: null };
    default:
      return { summary: row.action, detail: null };
  }
}
