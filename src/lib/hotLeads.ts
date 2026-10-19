import type { LeadSource } from "../../supabase/functions/admin-leads/logic.ts";

// Scoring and tabs live in supabase/functions/admin-leads/score.ts so the
// sales-tasks function ranks leads the same way as this page.
export {
  type LeadContact,
  type LeadFollowup,
  type LeadScore,
  type LeadTab,
  type RecentAttempt,
  type ScorePart,
  LEAD_TABS,
  contactSinceLead,
  leadTab,
  scoreLead,
} from "../../supabase/functions/admin-leads/score.ts";

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  both: "Quoted + no-show",
  quoted: "Quoted",
  no_show: "No-show",
};
