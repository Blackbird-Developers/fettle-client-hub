// Pure logic for the portal-adoption-emails edge function: who should get
// which email, and who must be skipped. No Deno or network imports, so the
// same file runs inside the edge function and under Vitest (logic.test.ts).
//
// Two one-off emails, each sent at most once per person (never resent):
//   existing_clients — "Your Fettle account is waiting": the people on the
//                      admin Portal adoption page (a counted session in the
//                      last 30 days, no hub account with that email).
//   new_enquiries    — "Start your Fettle journey your way": a free call
//                      (Let's Talk / Introduction Chat) 2–14 days ago, no paid
//                      session ever (past or booked), no hub account.
//                      Fettle's earlier rule kept free calls out of portal
//                      work until stage 2; this email was written for them,
//                      so the rule is relaxed for it only.

import {
  type AcuityAppointment,
  type Customer,
  DAY_MS,
  appointmentTime,
  buildAdoptionView,
  isCompleted,
  isSession,
  isUpcoming,
  matchPortalAccount,
} from "../admin-customer-insights/logic.ts";

export type Campaign = "existing_clients" | "new_enquiries";

/** Free 20-minute consultations, on any calendar. */
const FREE_CALL_TYPE = /let.?s talk|introduction chat/i;

/** Days after the free call before Email 2 goes out, and the last day it can. */
export const ENQUIRY_MIN_DAYS = 2;
export const ENQUIRY_MAX_DAYS = 14;

/** Nobody gets a second portal email within this many days of the first. */
export const EMAIL_GAP_DAYS = 14;

export function isFreeCall(appt: AcuityAppointment): boolean {
  return FREE_CALL_TYPE.test(appt.type ?? "");
}

export interface Recipient {
  campaign: Campaign;
  customerKey: string;
  email: string;
  name: string | null;
  firstName: string | null;
}

/** First name from the customer's most recent appointment that has one. */
function firstNameOf(customer: Customer): string | null {
  for (let i = customer.appointments.length - 1; i >= 0; i--) {
    const name = (customer.appointments[i].firstName ?? "").trim();
    if (name) return name;
  }
  return null;
}

function toRecipient(campaign: Campaign, customer: Customer): Recipient {
  return {
    campaign,
    customerKey: customer.key,
    email: customer.email!,
    name: customer.name,
    firstName: firstNameOf(customer),
  };
}

// Email 1: the same people as the admin Portal adoption page, in the page's
// priority order, so the list and the emails always agree.
export function existingClientRecipients(
  customers: Customer[],
  portalEmails: Set<string>,
  now: number
): Recipient[] {
  const byKey = new Map(customers.map((customer) => [customer.key, customer]));
  return buildAdoptionView(customers, portalEmails, now)
    .rows.filter((row) => row.portalStatus === "no_account")
    .map((row) => toRecipient("existing_clients", byKey.get(row.key)!));
}

export interface EnquiryCandidate {
  customer: Customer;
  freeCallAt: number;
}

// Email 2, first pass on the fetched window: the latest free call is 2–14 days
// old, nothing counted as a session is in the window (past or booked), no
// later free call is booked, and there's no hub account. Paid sessions from
// before the window are checked separately (hasEarlierSession), per person.
export function enquiryCandidates(
  customers: Customer[],
  portalEmails: Set<string>,
  now: number
): EnquiryCandidate[] {
  const candidates: EnquiryCandidate[] = [];
  for (const customer of customers) {
    if (matchPortalAccount(customer, portalEmails) !== "no_account") continue;
    if (customer.appointments.some(isSession)) continue;

    const freeCalls = customer.appointments.filter(isFreeCall);
    if (freeCalls.some((appt) => isUpcoming(appt, now))) continue;
    const completed = freeCalls.filter((appt) => isCompleted(appt, now));
    if (completed.length === 0) continue;

    const freeCallAt = appointmentTime(completed[completed.length - 1]);
    const age = now - freeCallAt;
    if (age < ENQUIRY_MIN_DAYS * DAY_MS || age > ENQUIRY_MAX_DAYS * DAY_MS) continue;
    candidates.push({ customer, freeCallAt });
  }
  // Oldest call first: they're closest to the end of the 14-day window.
  return candidates.sort((a, b) => a.freeCallAt - b.freeCallAt);
}

// Result of looking a candidate's whole history up by email. Null history =
// the lookup failed; a full page may have cut history off. Either way we
// can't be sure they're new, so they're not emailed (true = skip).
export function hasEarlierSession(
  history: AcuityAppointment[] | null,
  limit: number
): boolean {
  if (history === null || history.length >= limit) return true;
  return history.some((appt) => !appt.canceled && isSession(appt));
}

export function enquiryRecipients(candidates: EnquiryCandidate[]): Recipient[] {
  return candidates.map(({ customer }) => toRecipient("new_enquiries", customer));
}

export type SkipReason =
  | "already_sent"
  | "suppressed"
  | "not_continuing"
  | "emailed_recently"
  | "duplicate_in_run";

export interface SendPlan {
  /** Due now, in send order, at most `max`. */
  send: Recipient[];
  /** Eligible but over this run's cap; picked up by the next runs. */
  waiting: Recipient[];
  skipped: Record<SkipReason, number>;
}

export interface SendHistory {
  /** Emails already sent (or seeded) per campaign. */
  sent: Record<Campaign, Set<string>>;
  /** Latest portal email to each address, any campaign (ms). */
  lastSentAt: Map<string, number>;
  suppressed: Set<string>;
  /** Customer keys whose latest staff outcome is "Not continuing". */
  notContinuing: Set<string>;
}

// Applies the stop rules to both lists and caps the run. Existing clients go
// first, so someone on both lists gets Email 1 and Email 2 is skipped for at
// least EMAIL_GAP_DAYS.
export function planSends(
  recipients: Recipient[],
  history: SendHistory,
  now: number,
  max: number
): SendPlan {
  const skipped: Record<SkipReason, number> = {
    already_sent: 0,
    suppressed: 0,
    not_continuing: 0,
    emailed_recently: 0,
    duplicate_in_run: 0,
  };
  const ordered = [
    ...recipients.filter((r) => r.campaign === "existing_clients"),
    ...recipients.filter((r) => r.campaign === "new_enquiries"),
  ];
  const inRun = new Set<string>();
  const due: Recipient[] = [];

  for (const recipient of ordered) {
    const lastSent = history.lastSentAt.get(recipient.email);
    let reason: SkipReason | null = null;
    if (history.sent[recipient.campaign].has(recipient.email)) reason = "already_sent";
    else if (history.suppressed.has(recipient.email)) reason = "suppressed";
    else if (history.notContinuing.has(recipient.customerKey)) reason = "not_continuing";
    else if (lastSent !== undefined && now - lastSent < EMAIL_GAP_DAYS * DAY_MS) {
      reason = "emailed_recently";
    } else if (inRun.has(recipient.email)) reason = "duplicate_in_run";

    if (reason) {
      skipped[reason]++;
      continue;
    }
    inRun.add(recipient.email);
    due.push(recipient);
  }

  return { send: due.slice(0, Math.max(0, max)), waiting: due.slice(Math.max(0, max)), skipped };
}

export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${(user || "").slice(0, 2)}***@${domain || ""}`;
}
