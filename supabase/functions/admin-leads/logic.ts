// Pure logic for the admin-leads edge function: which Acuity customers are
// hot leads (a free "Let's Talk" call they didn't show up for, or a call
// marked "Quoted"), and whether they have since booked. No Deno or network
// imports, so the same file runs inside the edge function and under Vitest
// (logic.test.ts). Shares customer matching with admin-customer-insights.

import {
  type AcuityAppointment,
  type Customer,
  type HistoryLookup,
  type PortalStatus,
  DAY_MS,
  appointmentTime,
  daysSince,
  isCompleted,
  isSession,
  isUpcoming,
  matchPortalAccount,
} from "../admin-customer-insights/logic.ts";

/** Lead events older than this many days are left out. */
export const LEAD_LOOKBACK_DAYS = 90;

// ---------------------------------------------------------------------------
// Appointment types and labels
// ---------------------------------------------------------------------------

// Labels are matched by trimmed name, ignoring case: Acuity's names carry
// trailing spaces ("Quoted ", "Booked in "), and the No Show / Quoted ids
// haven't been confirmed by Fettle yet. "Booked in" is also matched by its id.
// Once the ids are known, add them here; nothing else needs to change.
const NO_SHOW_LABEL = /^no[\s-]?shows?$/i;
const QUOTED_LABEL = /^quoted$/i;
const BOOKED_IN_LABEL = /^booked in$/i;
export const BOOKED_IN_LABEL_ID = 23047490;

// Any free consultation called "Let's Talk" (straight or curly apostrophe),
// on any calendar — Alex's, Courtney's or one added later.
const LETS_TALK_TYPE = /let.?s talk/i;

export function isLetsTalk(appt: AcuityAppointment): boolean {
  return LETS_TALK_TYPE.test(appt.type ?? "");
}

function hasLabel(appt: AcuityAppointment, name: RegExp, id?: number): boolean {
  return (appt.labels ?? []).some(
    (label) => (id !== undefined && label?.id === id) || name.test((label?.name ?? "").trim())
  );
}

export const isNoShow = (appt: AcuityAppointment) => hasLabel(appt, NO_SHOW_LABEL);
export const isQuoted = (appt: AcuityAppointment) => hasLabel(appt, QUOTED_LABEL);
export const isBookedIn = (appt: AcuityAppointment) =>
  hasLabel(appt, BOOKED_IN_LABEL, BOOKED_IN_LABEL_ID);

// ---------------------------------------------------------------------------
// Who is a lead
// ---------------------------------------------------------------------------

export type LeadSource = "quoted" | "no_show" | "both";

export interface LeadCandidate {
  customer: Customer;
  source: LeadSource;
  /** The most recent lead event (a missed call or a quote). */
  lead: AcuityAppointment;
  leadAt: number;
}

// Customers with a lead event in the last LEAD_LOOKBACK_DAYS. A "Let's Talk"
// call that went ahead (no No Show label) cancels any no-shows before it:
// they had the conversation in the end, so only a quote can make them a lead.
export function leadCandidates(customers: Customer[], now: number): LeadCandidate[] {
  const since = now - LEAD_LOOKBACK_DAYS * DAY_MS;
  const candidates: LeadCandidate[] = [];

  for (const customer of customers) {
    // Appointments are non-cancelled and oldest first (groupCustomers).
    const past = customer.appointments.filter(
      (appt) => isCompleted(appt, now) && appointmentTime(appt) >= since
    );
    const heldCalls = past.filter((appt) => isLetsTalk(appt) && !isNoShow(appt));
    const lastHeldAt = heldCalls.length > 0 ? appointmentTime(heldCalls[heldCalls.length - 1]) : -Infinity;
    const noShows = past.filter(
      (appt) => isLetsTalk(appt) && isNoShow(appt) && appointmentTime(appt) > lastHeldAt
    );
    const quotes = past.filter(isQuoted);
    if (noShows.length === 0 && quotes.length === 0) continue;

    const events = [...noShows, ...quotes].sort((a, b) => appointmentTime(a) - appointmentTime(b));
    const lead = events[events.length - 1];
    candidates.push({
      customer,
      source: noShows.length > 0 && quotes.length > 0 ? "both" : quotes.length > 0 ? "quoted" : "no_show",
      lead,
      leadAt: appointmentTime(lead),
    });
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Has the lead booked since?
// ---------------------------------------------------------------------------

// open          — nothing booked since the lead event
// call_rebooked — a new "Let's Talk" is booked (and nothing paid yet)
// converted     — a counted session is booked or done after the lead event,
//                 or an appointment from the lead event on is labelled "Booked in"
export type LeadStatus = "open" | "call_rebooked" | "converted";

export interface LeadStatusResult {
  status: LeadStatus;
  /** When the converting session / rebooked call is (or was). */
  at: string | null;
  detail: string | null;
}

export function leadStatus(customer: Customer, leadAt: number, now: number): LeadStatusResult {
  const after = customer.appointments.filter((appt) => appointmentTime(appt) > leadAt);
  const session = after.find(isSession);
  if (session) {
    return { status: "converted", at: session.datetime, detail: session.type?.trim() || null };
  }
  const bookedIn = customer.appointments.find(
    (appt) => appointmentTime(appt) >= leadAt && isBookedIn(appt)
  );
  if (bookedIn) {
    return { status: "converted", at: bookedIn.datetime, detail: 'Labelled "Booked in" in Acuity' };
  }
  const call = after.find((appt) => isLetsTalk(appt) && isUpcoming(appt, now));
  if (call) {
    return { status: "call_rebooked", at: call.datetime, detail: call.type?.trim() || null };
  }
  return { status: "open", at: null, detail: null };
}

// ---------------------------------------------------------------------------
// Engagement history
// ---------------------------------------------------------------------------

export interface LeadHistory {
  /** Completed counted sessions before the lead event. */
  priorSessions: number;
  /** Every "Let's Talk" no-show we can see, the lead's own included. */
  noShows: number;
  /** "verified" = the whole history was searched. */
  status: "verified" | "unverified";
}

// Combines the lookback window with one Acuity lookup by email (earlier
// history up to the lead event). Null lookup = no email to search by.
export function evaluateLeadHistory(
  lookup: HistoryLookup | null,
  candidate: LeadCandidate,
  now: number
): LeadHistory {
  const byId = new Map<number, AcuityAppointment>();
  for (const appt of [...(lookup?.appointments ?? []), ...candidate.customer.appointments]) {
    if (!appt.canceled) byId.set(appt.id, appt);
  }
  let priorSessions = 0;
  let noShows = 0;
  for (const appt of byId.values()) {
    if (!isCompleted(appt, now)) continue;
    if (isSession(appt) && appointmentTime(appt) < candidate.leadAt) priorSessions++;
    if (isLetsTalk(appt) && isNoShow(appt)) noShows++;
  }
  const verified =
    !!lookup && lookup.appointments !== null && lookup.appointments.length < lookup.limit;
  return { priorSessions, noShows, status: verified ? "verified" : "unverified" };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface LeadRow {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  leadAt: string;
  /** Acuity appointment type of the lead event. */
  leadType: string | null;
  /** Acuity calendar the lead event was on (whose call it was). */
  owner: string | null;
  daysSinceLead: number;
  status: LeadStatus;
  statusAt: string | null;
  statusDetail: string | null;
  priorSessions: number;
  noShows: number;
  historyStatus: "verified" | "unverified";
  portalStatus: PortalStatus;
}

export interface LeadsView {
  rows: LeadRow[];
  totals: Record<LeadStatus, number> & { quoted: number; noShow: number };
}

const NO_HISTORY: LeadHistory = { priorSessions: 0, noShows: 0, status: "unverified" };

export function buildLeadsView(
  candidates: LeadCandidate[],
  history: Map<string, LeadHistory>,
  portalEmails: Set<string>,
  now: number
): LeadsView {
  const totals = { open: 0, call_rebooked: 0, converted: 0, quoted: 0, noShow: 0 };
  const rows = candidates.map((candidate): LeadRow => {
    const { customer, lead, leadAt, source } = candidate;
    const status = leadStatus(customer, leadAt, now);
    const past = history.get(customer.key) ?? NO_HISTORY;

    totals[status.status]++;
    if (source !== "no_show") totals.quoted++;
    if (source !== "quoted") totals.noShow++;

    return {
      key: customer.key,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      source,
      leadAt: lead.datetime,
      leadType: lead.type?.trim() || null,
      owner: lead.calendar?.trim() || null,
      daysSinceLead: daysSince(leadAt, now),
      status: status.status,
      statusAt: status.at,
      statusDetail: status.detail,
      priorSessions: past.priorSessions,
      noShows: past.noShows,
      historyStatus: past.status,
      portalStatus: matchPortalAccount(customer, portalEmails),
    };
  });

  // Newest lead first; the page re-sorts open leads by priority score.
  rows.sort((a, b) => a.daysSinceLead - b.daysSinceLead);
  return { rows, totals };
}
