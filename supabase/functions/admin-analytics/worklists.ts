// Pure logic for admin-analytics?action=periods: the "in this period" figures
// on the admin work-list pages that read live from Acuity (Hot leads,
// Psychiatry, Assessments, Portal adoption). The pages' lists cover a fixed
// live window (90 or 30 days); these figures come from the Acuity copy
// instead, so the date picker's period and its comparison can reach back
// further. The rules are the pages' own (admin-leads, admin-clinical,
// admin-customer-insights), applied to a chosen period instead of "the last
// N days". No Deno or network imports, so it runs under Vitest
// (worklists.test.ts).

import {
  type AcuityAppointment,
  type Customer,
  isCompleted,
} from "../admin-customer-insights/logic.ts";
import { assessmentStep, isPsychiatry } from "../admin-clinical/logic.ts";
import { isLetsTalk, isNoShow, isQuoted, leadStatus } from "../admin-leads/logic.ts";
import {
  type Comparison,
  type CustomerHistory,
  type DateRange,
  MAX_RANGE_DAYS,
  daysInRange,
  dublinDate,
  isDate,
  parseComparison,
} from "./logic.ts";

export const WORKLISTS = ["leads", "clinical", "adoption"] as const;
export type Worklist = (typeof WORKLISTS)[number];

const inRange = (ms: number, range: DateRange) => {
  const day = dublinDate(ms);
  return day >= range.from && day <= range.to;
};

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

type Label = { id: number; name?: string | null };

function parseLabels(raw: unknown): Label[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((l): l is { id: unknown; name?: unknown } => !!l && typeof l === "object")
    .filter((l) => typeof l.id === "number")
    .map((l) => ({ id: l.id as number, name: typeof l.name === "string" ? l.name : null }));
}

// ---------------------------------------------------------------------------
// Hot leads
// ---------------------------------------------------------------------------

/** admin_analytics_lead_rows() as customers (non-cancelled appointments,
 *  oldest first), in the shape admin-leads' rules take. */
export function parseLeadCustomers(raw: unknown): Customer[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map<string, AcuityAppointment[]>();
  for (const item of raw) {
    if (!Array.isArray(item)) continue;
    const [id, customerKey, at, canceled, type, typeId, labels] = item;
    if (typeof id !== "number" || typeof customerKey !== "string" || typeof at !== "number") continue;
    if (canceled === true) continue;
    const appt: AcuityAppointment = {
      id,
      datetime: new Date(at).toISOString(),
      type: typeof type === "string" ? type : null,
      appointmentTypeID: typeof typeId === "number" ? typeId : null,
      canceled: false,
      labels: parseLabels(labels),
    };
    const list = byKey.get(customerKey);
    if (list) list.push(appt);
    else byKey.set(customerKey, [appt]);
  }
  return [...byKey].map(([key, appointments]) => ({
    key,
    email: key.startsWith("email:") ? key.slice(6) : null,
    name: null,
    phone: null,
    appointments: appointments.sort((a, b) => Date.parse(a.datetime) - Date.parse(b.datetime) || a.id - b.id),
  }));
}

export interface LeadPeriodTotals {
  /** People with a lead event (missed Let's Talk or a quote) in the period. */
  leads: number;
  missedCalls: number;
  quoted: number;
  /** Of those, booked a session (or were labelled "Booked in") after it, by now. */
  converted: number;
  conversionRate: number | null;
}

/** Hot leads' rules (admin-leads leadCandidates / leadStatus) over a period:
 *  a held Let's Talk call cancels earlier no-shows; each person counts once,
 *  from their latest lead event in the period. */
export function leadPeriodTotals(customers: Customer[], range: DateRange, now: number): LeadPeriodTotals {
  const totals = { leads: 0, missedCalls: 0, quoted: 0, converted: 0 };
  for (const customer of customers) {
    const past = customer.appointments.filter(
      (appt) => isCompleted(appt, now) && inRange(Date.parse(appt.datetime), range)
    );
    const held = past.filter((appt) => isLetsTalk(appt) && !isNoShow(appt));
    const lastHeldAt = held.length > 0 ? Date.parse(held[held.length - 1].datetime) : -Infinity;
    const noShows = past.filter(
      (appt) => isLetsTalk(appt) && isNoShow(appt) && Date.parse(appt.datetime) > lastHeldAt
    );
    const quotes = past.filter(isQuoted);
    if (noShows.length === 0 && quotes.length === 0) continue;

    const leadAt = Math.max(...[...noShows, ...quotes].map((appt) => Date.parse(appt.datetime)));
    totals.leads++;
    if (noShows.length > 0) totals.missedCalls++;
    if (quotes.length > 0) totals.quoted++;
    if (leadStatus(customer, leadAt, now).status === "converted") totals.converted++;
  }
  return { ...totals, conversionRate: rate(totals.converted, totals.leads) };
}

// ---------------------------------------------------------------------------
// Psychiatry and assessments
// ---------------------------------------------------------------------------

export interface ClinicalRow {
  customerKey: string;
  appt: AcuityAppointment;
}

/** admin_analytics_clinical_rows(), non-cancelled. */
export function parseClinicalRows(raw: unknown): ClinicalRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: ClinicalRow[] = [];
  for (const item of raw) {
    if (!Array.isArray(item)) continue;
    const [id, customerKey, at, canceled, type, typeId] = item;
    if (typeof id !== "number" || typeof customerKey !== "string" || typeof at !== "number") continue;
    if (canceled === true) continue;
    rows.push({
      customerKey,
      appt: {
        id,
        datetime: new Date(at).toISOString(),
        type: typeof type === "string" ? type : null,
        appointmentTypeID: typeof typeId === "number" ? typeId : null,
        canceled: false,
      },
    });
  }
  return rows;
}

export interface ClinicalPeriodTotals {
  /** Completed psychiatry appointments in the period, and the clients seen. */
  psychiatryAppointments: number;
  psychiatryClients: number;
  /** Completed assessment steps in the period, and the clients seen. */
  screenings: number;
  fullAssessments: number;
  otherAssessments: number;
  assessmentClients: number;
}

export function clinicalPeriodTotals(rows: ClinicalRow[], range: DateRange, now: number): ClinicalPeriodTotals {
  const psychiatryClients = new Set<string>();
  const assessmentClients = new Set<string>();
  const totals = { psychiatryAppointments: 0, screenings: 0, fullAssessments: 0, otherAssessments: 0 };
  for (const { customerKey, appt } of rows) {
    if (!isCompleted(appt, now) || !inRange(Date.parse(appt.datetime), range)) continue;
    if (isPsychiatry(appt)) {
      totals.psychiatryAppointments++;
      psychiatryClients.add(customerKey);
      continue;
    }
    const step = assessmentStep(appt);
    if (!step) continue;
    if (step === "screening") totals.screenings++;
    else if (step === "full") totals.fullAssessments++;
    else totals.otherAssessments++;
    assessmentClients.add(customerKey);
  }
  return { ...totals, psychiatryClients: psychiatryClients.size, assessmentClients: assessmentClients.size };
}

// ---------------------------------------------------------------------------
// Portal adoption
// ---------------------------------------------------------------------------

export interface AdoptionPeriodTotals {
  /** People who completed a session in the period. */
  activeCustomers: number;
  withAccount: number;
  withoutAccount: number;
  /** No email, so no hub account can be matched. */
  noEmail: number;
  /** withAccount ÷ (withAccount + withoutAccount). */
  adoptionRate: number | null;
}

/** Portal adoption's rule (admin-customer-insights buildAdoptionView) over a
 *  period: a completed session in it, matched to a hub account by email. */
export function adoptionPeriodTotals(
  histories: CustomerHistory[],
  portalEmails: Set<string>,
  range: DateRange,
  now: number
): AdoptionPeriodTotals {
  const totals = { activeCustomers: 0, withAccount: 0, withoutAccount: 0, noEmail: 0 };
  for (const history of histories) {
    if (!history.sessions.some((s) => s.at < now && inRange(s.at, range))) continue;
    totals.activeCustomers++;
    const email = history.key.startsWith("email:") ? history.key.slice(6) : null;
    if (!email) totals.noEmail++;
    else if (portalEmails.has(email)) totals.withAccount++;
    else totals.withoutAccount++;
  }
  return { ...totals, adoptionRate: rate(totals.withAccount, totals.withAccount + totals.withoutAccount) };
}

// ---------------------------------------------------------------------------
// Query string
// ---------------------------------------------------------------------------

export interface PeriodsParams extends Comparison {
  list: Worklist;
  range: DateRange;
}

/** Reads and checks ?action=periods's query string. Returns an error message when invalid. */
export function parsePeriodsParams(search: URLSearchParams): PeriodsParams | string {
  const list = search.get("list");
  if (!(WORKLISTS as readonly string[]).includes(list ?? "")) return `list must be one of ${WORKLISTS.join(", ")}`;
  const from = search.get("from");
  const to = search.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return "from and to must be dates, from first";
  const range = { from, to };
  if (daysInRange(range) > MAX_RANGE_DAYS) return "The date range can be at most three years";
  const comparison = parseComparison(search, range);
  if (typeof comparison === "string") return comparison;
  return { list: list as Worklist, range, ...comparison };
}
