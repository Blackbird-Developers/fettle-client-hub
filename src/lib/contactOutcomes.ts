import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { type CustomerFollowup, blankFollowup } from "./customerFollowups";

// Contact outcomes staff record against a customer (Progression pages and the
// Follow-ups report). Each one is a row in customer_contact_attempts; the
// database keeps the summary on customer_followups in step. The helpers here
// mirror those rules so the page can update before the save comes back.

export type ContactOutcome = "no_answer" | "not_continuing" | "follow_up_later" | "booked";
export type NotContinuingReason = "price" | "timing" | "not_interested" | "other";
export type ContactAttempt = Tables<"customer_contact_attempts">;

/** In the order the action buttons show them. */
export const CONTACT_OUTCOMES: ContactOutcome[] = [
  "no_answer",
  "not_continuing",
  "follow_up_later",
  "booked",
];

export const OUTCOME_LABELS: Record<ContactOutcome, { label: string; short: string }> = {
  no_answer: { label: "No answer", short: "No answer" },
  not_continuing: { label: "Doesn't want to continue", short: "Not continuing" },
  follow_up_later: { label: "Interested, but will continue later", short: "Continue later" },
  booked: { label: "Successfully booked", short: "Booked" },
};

export const NOT_CONTINUING_REASONS: { id: NotContinuingReason; label: string }[] = [
  { id: "price", label: "Price" },
  { id: "timing", label: "Timing" },
  { id: "not_interested", label: "No longer interested" },
  { id: "other", label: "Other" },
];

const REASON_LABELS = Object.fromEntries(
  NOT_CONTINUING_REASONS.map((r) => [r.id, r.label])
) as Record<string, string>;

/** "Continue later" customers come up for a call again after this many days. */
export const FOLLOW_UP_AFTER_DAYS = 30;

/** Matches the CHECK constraint on customer_contact_attempts.reason_other. */
export const REASON_OTHER_MAX_LENGTH = 500;

/** What a click records. "cleared" undoes a mistaken outcome. */
export type OutcomeInput =
  | { outcome: Exclude<ContactOutcome, "not_continuing"> | "cleared" }
  | { outcome: "not_continuing"; reasons: NotContinuingReason[]; reasonOther?: string | null };

export function isContactOutcome(value: string | null | undefined): value is ContactOutcome {
  return CONTACT_OUTCOMES.includes(value as ContactOutcome);
}

/** Error message for the "not continuing" popup, or null when it can be saved. */
export function validateReasons(
  reasons: readonly NotContinuingReason[],
  other: string | null | undefined
): string | null {
  if (reasons.length === 0) return "Choose at least one reason.";
  const text = (other ?? "").trim();
  if (reasons.includes("other") && !text) return "Enter the reason.";
  if (text.length > REASON_OTHER_MAX_LENGTH) {
    return `The reason can be up to ${REASON_OTHER_MAX_LENGTH} characters (currently ${text.length}).`;
  }
  return null;
}

/** "Price, Other: moving abroad" */
export function describeReasons(
  reasons: readonly string[] | null | undefined,
  other: string | null | undefined
): string {
  return (reasons ?? [])
    .map((r) => (r === "other" && other ? `Other: ${other}` : (REASON_LABELS[r] ?? r)))
    .join(", ");
}

/** Row for customer_contact_attempts. Who/when are stamped by the database. */
export function attemptInsert(
  customerKey: string,
  customerName: string | null,
  input: OutcomeInput
): TablesInsert<"customer_contact_attempts"> {
  const notContinuing = input.outcome === "not_continuing";
  // Stored in the popup's order, without duplicates.
  const reasons = notContinuing
    ? NOT_CONTINUING_REASONS.map((r) => r.id).filter((id) => input.reasons.includes(id))
    : null;
  return {
    customer_key: customerKey,
    customer_name: customerName?.trim() || null,
    outcome: input.outcome,
    reasons,
    reason_other:
      notContinuing && reasons?.includes("other") ? input.reasonOther?.trim() || null : null,
  };
}

/** The follow-up date for "Continue later" recorded on `at` (yyyy-MM-dd). */
export function followUpDueDate(at: Date): string {
  return format(addDays(at, FOLLOW_UP_AFTER_DAYS), "yyyy-MM-dd");
}

/**
 * Optimistic copy of what the database trigger does with a new attempt:
 * replaces (or adds) only this customer's row.
 */
export function applyOutcome(
  rows: CustomerFollowup[],
  customerKey: string,
  customerName: string | null,
  input: OutcomeInput,
  author: string | null,
  now: Date = new Date()
): CustomerFollowup[] {
  const existing = rows.find((row) => row.customer_key === customerKey);
  const base = existing ?? blankFollowup(customerKey);
  const at = now.toISOString();
  const insert = attemptInsert(customerKey, customerName, input);
  const cleared = input.outcome === "cleared";
  const reached = !cleared && input.outcome !== "no_answer";

  const next: CustomerFollowup = {
    ...base,
    contacted: base.contacted || reached,
    outcome: cleared ? null : input.outcome,
    outcome_at: cleared ? null : at,
    outcome_by_email: cleared ? null : author,
    not_continuing_reasons: insert.reasons ?? null,
    not_continuing_other: insert.reason_other ?? null,
    follow_up_due: input.outcome === "follow_up_later" ? followUpDueDate(now) : null,
    attempt_count: base.attempt_count + (cleared ? 0 : 1),
    last_attempt_at: cleared ? base.last_attempt_at : at,
    last_reached_at: reached ? at : base.last_reached_at,
    customer_name: insert.customer_name ?? base.customer_name,
  };
  return existing
    ? rows.map((row) => (row.customer_key === customerKey ? next : row))
    : [...rows, next];
}

export type FollowUpTiming =
  | { kind: "overdue"; days: number }
  | { kind: "today"; days: 0 }
  | { kind: "soon"; days: number }
  | { kind: "upcoming"; days: number };

/** How far `due` (yyyy-MM-dd) is from today. "soon" = within the next 7 days. */
export function followUpTiming(due: string, today: Date = new Date()): FollowUpTiming {
  const days = differenceInCalendarDays(parseISO(due), today);
  if (days < 0) return { kind: "overdue", days: -days };
  if (days === 0) return { kind: "today", days: 0 };
  return days <= 7 ? { kind: "soon", days } : { kind: "upcoming", days };
}

export function followUpTimingLabel(timing: FollowUpTiming): string {
  switch (timing.kind) {
    case "overdue":
      return timing.days === 1 ? "1 day overdue" : `${timing.days} days overdue`;
    case "today":
      return "Due today";
    default:
      return timing.days === 1 ? "Due tomorrow" : `Due in ${timing.days} days`;
  }
}

/** "Continue later" customers, soonest (most overdue) first. */
export function followUpLater(rows: readonly CustomerFollowup[]): CustomerFollowup[] {
  return rows
    .filter((row) => row.outcome === "follow_up_later" && row.follow_up_due)
    .sort((a, b) => a.follow_up_due!.localeCompare(b.follow_up_due!));
}

/** Customers to call again now: "Continue later" due today or earlier. */
export function countFollowUpsDue(rows: readonly CustomerFollowup[], today: Date = new Date()): number {
  const todayIso = format(today, "yyyy-MM-dd");
  return followUpLater(rows).filter((row) => row.follow_up_due! <= todayIso).length;
}

/** Outcome filter on the Progression pages. */
export type OutcomeFilter = "all" | "none" | ContactOutcome;

export function matchesOutcomeFilter(
  followup: CustomerFollowup | undefined,
  filter: OutcomeFilter
): boolean {
  if (filter === "all") return true;
  const outcome = followup?.outcome ?? null;
  return filter === "none" ? !isContactOutcome(outcome) : outcome === filter;
}

/** How many "not continuing" customers gave each reason. */
export function reasonCounts(rows: readonly CustomerFollowup[]): Record<NotContinuingReason, number> {
  const counts: Record<NotContinuingReason, number> = { price: 0, timing: 0, not_interested: 0, other: 0 };
  for (const row of rows) {
    if (row.outcome !== "not_continuing") continue;
    for (const reason of row.not_continuing_reasons ?? []) {
      if (reason in counts) counts[reason as NotContinuingReason] += 1;
    }
  }
  return counts;
}

/** Email or phone from an insights customer key, for rows with no insights data. */
export function contactFromKey(customerKey: string): { email: string | null; phone: string | null } {
  const [kind, ...rest] = customerKey.split(":");
  const value = rest.join(":");
  return {
    email: kind === "email" ? value : null,
    phone: kind === "phone" ? value : null,
  };
}

export const attemptsLabel = (count: number) =>
  `${count} attempt${count === 1 ? "" : "s"}`;
