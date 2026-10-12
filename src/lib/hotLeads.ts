import type { LeadRow, LeadSource } from "../../supabase/functions/admin-leads/logic.ts";
import type { CustomerFollowup } from "./customerFollowups";

// Priority score and tabs for the admin Hot leads page. The edge function
// says who is a lead and whether Acuity shows them booked; what staff have
// done since (attempts, outcomes) is added here from the follow-up tables.

/** One row of customer_contact_attempts, as much as the page needs. */
export interface RecentAttempt {
  customer_key: string;
  outcome: string;
  created_at: string;
}

export interface LeadContact {
  /** Attempts logged since the lead event ("cleared" undos not counted). */
  attempts: number;
  lastAttemptAt: string | null;
}

// Attempts per customer from the recent log, counting only those made after
// each customer's lead event.
export function contactSinceLead(
  rows: readonly LeadRow[],
  attempts: readonly RecentAttempt[]
): Map<string, LeadContact> {
  const leadAtByKey = new Map(rows.map((row) => [row.key, Date.parse(row.leadAt)]));
  const result = new Map<string, LeadContact>();
  for (const attempt of attempts) {
    const leadAt = leadAtByKey.get(attempt.customer_key);
    if (leadAt === undefined || attempt.outcome === "cleared") continue;
    if (Date.parse(attempt.created_at) < leadAt) continue;
    const current = result.get(attempt.customer_key) ?? { attempts: 0, lastAttemptAt: null };
    current.attempts++;
    if (!current.lastAttemptAt || attempt.created_at > current.lastAttemptAt) {
      current.lastAttemptAt = attempt.created_at;
    }
    result.set(attempt.customer_key, current);
  }
  return result;
}

export interface ScorePart {
  label: string;
  points: number;
}

export interface LeadScore {
  score: number;
  parts: ScorePart[];
}

// Starting weights agreed in the implementation plan; to be reviewed against
// which leads actually booked after about four weeks.
const SOURCE_POINTS: Record<LeadSource, number> = { both: 30, quoted: 25, no_show: 15 };
const SOURCE_LABELS: Record<LeadSource, string> = {
  both: "Quoted and missed a call",
  quoted: "Quoted",
  no_show: "Missed a Let's Talk call",
};
const RECENTLY_CONTACTED_HOURS = 48;

function recencyPart(days: number): ScorePart {
  const points = days <= 2 ? 40 : days <= 7 ? 30 : days <= 14 ? 20 : days <= 30 ? 10 : 5;
  return { label: days <= 0 ? "Lead event today" : `Lead event ${days} day${days === 1 ? "" : "s"} ago`, points };
}

function attemptsPart(attempts: number): ScorePart {
  const points = attempts === 0 ? 15 : attempts <= 2 ? 10 : attempts <= 4 ? 5 : 0;
  return {
    label: attempts === 0 ? "Not contacted yet" : `${attempts} attempt${attempts === 1 ? "" : "s"} since`,
    points,
  };
}

/** Higher = call first. `parts` explains the total (zero-point parts left out). */
export function scoreLead(row: LeadRow, contact: LeadContact | undefined, now: Date = new Date()): LeadScore {
  const parts: ScorePart[] = [
    recencyPart(row.daysSinceLead),
    { label: SOURCE_LABELS[row.source], points: SOURCE_POINTS[row.source] },
    attemptsPart(contact?.attempts ?? 0),
  ];
  if (contact?.lastAttemptAt) {
    const hours = (now.getTime() - Date.parse(contact.lastAttemptAt)) / 3_600_000;
    if (hours < RECENTLY_CONTACTED_HOURS) parts.push({ label: "Contacted in the last 48 hours", points: -20 });
  }
  if (row.priorSessions > 0) parts.push({ label: "Has had a paid session before", points: 5 });
  if (row.portalStatus === "has_account") parts.push({ label: "Has a portal account", points: 5 });
  if (row.noShows >= 2) parts.push({ label: `${row.noShows} missed calls`, points: -10 });

  const kept = parts.filter((part) => part.points !== 0);
  return { score: kept.reduce((sum, part) => sum + part.points, 0), parts: kept };
}

// open          — to work on
// call_rebooked — a new Let's Talk is booked; wait for it
// closed        — staff recorded an outcome after the lead (not continuing,
//                 continue later, or booked)
// converted     — Acuity shows a paid session or "Booked in" since the lead
export type LeadTab = "open" | "call_rebooked" | "closed" | "converted";

export const LEAD_TABS: { id: LeadTab; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "call_rebooked", label: "Call rebooked" },
  { id: "closed", label: "Closed by staff" },
  { id: "converted", label: "Converted" },
];

const CLOSING_OUTCOMES = new Set(["not_continuing", "follow_up_later", "booked"]);

export function leadTab(row: LeadRow, followup: CustomerFollowup | undefined): LeadTab {
  if (row.status === "converted") return "converted";
  if (
    followup?.outcome &&
    followup.outcome_at &&
    CLOSING_OUTCOMES.has(followup.outcome) &&
    Date.parse(followup.outcome_at) >= Date.parse(row.leadAt)
  ) {
    return "closed";
  }
  return row.status === "call_rebooked" ? "call_rebooked" : "open";
}

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  both: "Quoted + no-show",
  quoted: "Quoted",
  no_show: "No-show",
};
