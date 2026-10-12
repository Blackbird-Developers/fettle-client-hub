// Summaries for the "Account set-up emails" panel on the admin Portal adoption
// page, built from email_sends rows (see the portal-adoption-emails function).

import type { Campaign } from "../../supabase/functions/portal-adoption-emails/logic.ts";

export interface EmailSendRow {
  id: string;
  campaign: Campaign;
  status: "claimed" | "sent" | "seeded";
  customer_name: string | null;
  email: string;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  first_clicked_at: string | null;
  bounced_at: string | null;
  complained_at: string | null;
  signed_up_at: string | null;
}

export const CAMPAIGN_LABELS: Record<Campaign, { title: string; audience: string }> = {
  existing_clients: {
    title: "Email 1 · Your Fettle account is waiting",
    audience: "Existing clients without an account",
  },
  new_enquiries: {
    title: "Email 2 · Start your Fettle journey your way",
    audience: "New enquiries after a free call",
  },
};

export const CAMPAIGN_ORDER: Campaign[] = ["existing_clients", "new_enquiries"];

export interface CampaignSummary {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  signedUp: number;
  bounced: number;
  complained: number;
  /** Recorded without emailing when going live (the backlog). */
  seeded: number;
}

/** Counts per email. Only rows actually sent count towards the funnel. */
export function summarizeSends(rows: EmailSendRow[]): Record<Campaign, CampaignSummary> {
  const blank = (): CampaignSummary => ({
    sent: 0, delivered: 0, opened: 0, clicked: 0, signedUp: 0, bounced: 0, complained: 0, seeded: 0,
  });
  const result: Record<Campaign, CampaignSummary> = {
    existing_clients: blank(),
    new_enquiries: blank(),
  };
  for (const row of rows) {
    const summary = result[row.campaign];
    if (!summary) continue;
    if (row.status === "seeded") {
      summary.seeded++;
      continue;
    }
    if (row.status !== "sent") continue;
    summary.sent++;
    if (row.delivered_at) summary.delivered++;
    if (row.opened_at) summary.opened++;
    if (row.first_clicked_at) summary.clicked++;
    if (row.signed_up_at) summary.signedUp++;
    if (row.bounced_at) summary.bounced++;
    if (row.complained_at) summary.complained++;
  }
  return result;
}

/** "42%" of a whole, or "–" when there's nothing to divide by. */
export function percentOf(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

export type SendStage = "signed_up" | "clicked" | "opened" | "delivered" | "bounced" | "complained" | "sent";

export const STAGE_LABELS: Record<SendStage, string> = {
  signed_up: "Signed up",
  clicked: "Clicked",
  opened: "Opened",
  delivered: "Delivered",
  bounced: "Bounced",
  complained: "Marked as spam",
  sent: "Sent",
};

/** The furthest thing that happened to one email. */
export function sendStage(row: EmailSendRow): SendStage {
  if (row.complained_at) return "complained";
  if (row.bounced_at) return "bounced";
  if (row.signed_up_at) return "signed_up";
  if (row.first_clicked_at) return "clicked";
  if (row.opened_at) return "opened";
  if (row.delivered_at) return "delivered";
  return "sent";
}

/** Sent rows, newest first, at most `limit`. */
export function recentSends(rows: EmailSendRow[], limit: number): EmailSendRow[] {
  return rows
    .filter((row) => row.status === "sent" && row.sent_at)
    .sort((a, b) => Date.parse(b.sent_at!) - Date.parse(a.sent_at!))
    .slice(0, limit);
}
