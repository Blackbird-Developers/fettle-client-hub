import { differenceInCalendarDays, format, isSameDay, parseISO, subDays } from "date-fns";
import type { Tables } from "@/integrations/supabase/types";
import type { AttemptSource, ContactMethod } from "./contactOutcomes";
import { type FollowUpTiming, followUpTiming } from "./contactOutcomes";

// The No answer page: six-attempt follow-up sequences for customers who
// didn't pick up. The database works out when each attempt is due (see
// migration 20261013120000_no_answer_sequences.sql); these helpers group
// and describe the sequences for the page.

export type NoAnswerSequence = Tables<"no_answer_sequences">;

export type SequenceStatus =
  | "active"
  | "booked"
  | "not_continuing"
  | "follow_up_later"
  | "exhausted"
  | "closed";

export const MAX_ATTEMPTS = 6;

/** Closed sequences stay on the page this many days. */
export const CLOSED_LIST_DAYS = 30;

export interface PlannedAttempt {
  attempt: number;
  /** Days after the first attempt, when every attempt is on time. */
  day: number;
  method: ContactMethod;
  /** What to do, shown in the log dialog. */
  hint: string;
  /** A follow-up email goes with this attempt. */
  withEmail: boolean;
}

// Spacing: a next-day retry at a different time catches people who were
// busy; then the gaps widen as the chance of reaching them falls. The
// sixth is a kind close that leaves the door open.
export const ATTEMPT_PLAN: PlannedAttempt[] = [
  { attempt: 1, day: 0, method: "call", hint: "Call", withEmail: false },
  { attempt: 2, day: 1, method: "call", hint: "Call at a different time of day, plus a short email", withEmail: true },
  { attempt: 3, day: 3, method: "call", hint: "Call, or a text/WhatsApp from the work phone", withEmail: false },
  { attempt: 4, day: 7, method: "call", hint: "Call: a check-in, not chasing", withEmail: false },
  { attempt: 5, day: 14, method: "call", hint: "Call, plus an email", withEmail: true },
  { attempt: 6, day: 21, method: "call", hint: "Final call, plus a \"we'll leave it with you\" email", withEmail: true },
];

export const METHOD_LABELS: Record<ContactMethod, string> = {
  call: "Call",
  email: "Email",
  sms: "Text",
  whatsapp: "WhatsApp",
  other: "Other",
};

export const METHODS: ContactMethod[] = ["call", "email", "sms", "whatsapp", "other"];

export const SOURCE_LABELS: Record<AttemptSource, string> = {
  progression: "Progression",
  hot_lead: "Hot lead",
  followups: "Follow-ups",
  no_answer: "Restarted",
};

export const STATUS_LABELS: Record<SequenceStatus, string> = {
  active: "In progress",
  booked: "Booked",
  not_continuing: "Not continuing",
  follow_up_later: "Continue later",
  exhausted: "No answer after 6 attempts",
  closed: "Closed",
};

export function isContactMethod(value: string | null | undefined): value is ContactMethod {
  return METHODS.includes(value as ContactMethod);
}

/** The attempt the next log will be (1–6). */
export function nextAttemptNumber(sequence: Pick<NoAnswerSequence, "attempts_done">): number {
  return Math.min(sequence.attempts_done + 1, MAX_ATTEMPTS);
}

export function plannedAttempt(attempt: number): PlannedAttempt {
  return ATTEMPT_PLAN[Math.min(Math.max(attempt, 1), MAX_ATTEMPTS) - 1];
}

/** Whether someone already logged an attempt today (shown as a warning). */
export function attemptedToday(
  sequence: Pick<NoAnswerSequence, "last_attempt_at">,
  now: Date = new Date()
): boolean {
  return Boolean(sequence.last_attempt_at) && isSameDay(parseISO(sequence.last_attempt_at!), now);
}

export function dueTiming(sequence: Pick<NoAnswerSequence, "next_due_on">, today: Date = new Date()): FollowUpTiming | null {
  return sequence.next_due_on ? followUpTiming(sequence.next_due_on, today) : null;
}

export interface SequenceGroups {
  /** Active and due today or overdue, most overdue first. */
  due: NoAnswerSequence[];
  /** Active and due later, soonest first. */
  upcoming: NoAnswerSequence[];
  /** Six unanswered attempts, newest first. */
  exhausted: NoAnswerSequence[];
  /** Ended any other way in the last CLOSED_LIST_DAYS days, newest first. */
  closed: NoAnswerSequence[];
}

export function groupSequences(rows: readonly NoAnswerSequence[], today: Date = new Date()): SequenceGroups {
  const todayIso = format(today, "yyyy-MM-dd");
  const closedSince = subDays(today, CLOSED_LIST_DAYS).toISOString();
  const byDue = (a: NoAnswerSequence, b: NoAnswerSequence) =>
    (a.next_due_on ?? "").localeCompare(b.next_due_on ?? "") ||
    (a.last_attempt_at ?? "").localeCompare(b.last_attempt_at ?? "");
  const byClosedDesc = (a: NoAnswerSequence, b: NoAnswerSequence) =>
    (b.closed_at ?? "").localeCompare(a.closed_at ?? "");

  const active = rows.filter((row) => row.status === "active");
  return {
    due: active.filter((row) => !row.next_due_on || row.next_due_on <= todayIso).sort(byDue),
    upcoming: active.filter((row) => row.next_due_on && row.next_due_on > todayIso).sort(byDue),
    exhausted: rows.filter((row) => row.status === "exhausted").sort(byClosedDesc),
    closed: rows
      .filter((row) => !["active", "exhausted"].includes(row.status) && (row.closed_at ?? "") >= closedSince)
      .sort(byClosedDesc),
  };
}

/** Active sequences due today or overdue (the sidebar badge). */
export function countDue(rows: readonly NoAnswerSequence[], today: Date = new Date()): number {
  return groupSequences(rows, today).due.length;
}

/** Days since the sequence started, for "Day 7 of 21". */
export function sequenceDay(sequence: Pick<NoAnswerSequence, "started_at">, today: Date = new Date()): number {
  return Math.max(0, differenceInCalendarDays(today, parseISO(sequence.started_at)));
}

export interface EmailDraft {
  subject: string;
  body: string;
}

// DRAFT COPY, to be replaced by the content team's wording. Neutral on
// purpose: no therapy details, since inboxes are often shared.
export function emailDraft(attempt: number, firstName: string | null): EmailDraft | null {
  const hi = `Hi ${firstName?.trim() || "there"},`;
  const signOff = "Warmly,\nThe Fettle Team\nhello@fettle.ie · 1 912 5688";
  switch (attempt) {
    case 2:
      return {
        subject: "Sorry we missed you",
        body: `${hi}\n\nWe've tried to call you but couldn't get through. No problem at all.\n\nIf it's easier, just reply to this email with a good time to call, or book directly at https://my.fettle.ie.\n\n${signOff}`,
      };
    case 5:
      return {
        subject: "Checking in from Fettle",
        body: `${hi}\n\nWe've tried to reach you a few times over the last couple of weeks and wanted to check in.\n\nWhenever you're ready, reply to this email or call us on 1 912 5688, and we'll find a time that suits you.\n\n${signOff}`,
      };
    case 6:
      return {
        subject: "We'll leave it with you",
        body: `${hi}\n\nWe haven't been able to reach you, so we won't keep calling. We'll leave it with you.\n\nIf you'd like to talk or book a session at any point, just reply to this email or call us on 1 912 5688. We'd be glad to hear from you.\n\n${signOff}`,
      };
    default:
      return null;
  }
}

/** First word of a full name, for the email greeting. */
export function firstNameOf(name: string | null): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}
