// Front-end helpers for the admin Overview's "Booking funnel" tab: the tab's
// filters kept in the URL (f-prefixed, so they never clash with the other
// boards' settings), the admin-analytics query, and display labels. The
// numbers themselves come from supabase/functions/admin-analytics/funnel.ts.

import {
  type FunnelFilters,
  type FunnelFlow,
  type FunnelPath,
  type FunnelReport,
  FUNNEL_DEVICES,
  FUNNEL_FLOWS,
  FUNNEL_MAX_RANGE_DAYS,
  FUNNEL_PATHS,
} from "../../supabase/functions/admin-analytics/funnel.ts";
import { type DateRange, daysInRange } from "../../supabase/functions/admin-analytics/logic.ts";

export interface FunnelResponse {
  generatedAt: string;
  /** First live event ever recorded; null until tracking starts. */
  trackingStart: string | null;
  params: { range: DateRange; filters: FunnelFilters };
  funnel: FunnelReport;
}

export const FUNNEL_URL_KEYS = {
  flow: "fflow",
  device: "fdevice",
  path: "fpath",
  service: "fservice",
  therapist: "ftherapist",
} as const satisfies Record<keyof FunnelFilters, string>;

export const NO_FUNNEL_FILTERS: FunnelFilters = { flow: null, device: null, path: null, service: null, therapist: null };

/** Reads the tab's filters from the URL; unknown values are ignored. */
export function readFunnelFilters(search: URLSearchParams): FunnelFilters {
  const flow = search.get(FUNNEL_URL_KEYS.flow);
  const device = search.get(FUNNEL_URL_KEYS.device);
  const path = search.get(FUNNEL_URL_KEYS.path);
  return {
    flow: (FUNNEL_FLOWS as readonly string[]).includes(flow ?? "") ? (flow as FunnelFlow) : null,
    device: (FUNNEL_DEVICES as readonly string[]).includes(device ?? "") ? device : null,
    path: (FUNNEL_PATHS as string[]).includes(path ?? "") ? (path as FunnelPath) : null,
    service: search.get(FUNNEL_URL_KEYS.service)?.trim().toLowerCase() || null,
    therapist: search.get(FUNNEL_URL_KEYS.therapist)?.trim() || null,
  };
}

/** A copy of `search` with the tab's filters replaced. */
export function withFunnelFilters(search: URLSearchParams, filters: FunnelFilters): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const [key, urlKey] of Object.entries(FUNNEL_URL_KEYS) as [keyof FunnelFilters, string][]) {
    const value = filters[key];
    if (value) next.set(urlKey, value);
    else next.delete(urlKey);
  }
  return next;
}

/** The funnel can show at most a year; a longer range keeps its last year. */
export function funnelRange(range: DateRange): { range: DateRange; clipped: boolean } {
  if (daysInRange(range) <= FUNNEL_MAX_RANGE_DAYS) return { range, clipped: false };
  const to = Date.parse(`${range.to}T00:00:00Z`);
  const from = new Date(to - (FUNNEL_MAX_RANGE_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return { range: { from, to: range.to }, clipped: true };
}

/** The admin-analytics query for the tab. */
export function funnelQuery(range: DateRange, filters: FunnelFilters): string {
  const search = new URLSearchParams({ action: "funnel", from: range.from, to: range.to });
  for (const key of Object.keys(FUNNEL_URL_KEYS) as (keyof FunnelFilters)[]) {
    const value = filters[key];
    if (value) search.set(key, value);
  }
  return search.toString();
}

export const FLOW_LABELS: Record<FunnelFlow, string> = { website: "Website (fettle.ie)", hub: "My Fettle (hub)" };

export const PATH_LABELS: Record<FunnelPath, string> = {
  therapist: "Chose a therapist",
  matching: "Matched (Find me a therapist)",
  psychologist: "Psychologist",
};

export const DEVICE_LABELS: Record<string, string> = { mobile: "Mobile", tablet: "Tablet", desktop: "Desktop" };

const SERVICE_LABELS: Record<string, string> = {
  individual: "Individual",
  couples: "Couples",
  youth: "Youth",
  psychologist: "Psychologist",
};

export function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? service.charAt(0).toUpperCase() + service.slice(1);
}

const FAIL_REASON_LABELS: Record<string, string> = {
  slot_check_failed: "Couldn't check the time was still free",
  slot_unavailable: "Time was just taken",
  stripe_form_invalid: "Card details incomplete",
  stripe_confirm_error: "Card declined or payment error",
  unexpected_payment_status: "Payment didn't complete",
  acuity_booking_failed: "Paid, but the booking failed",
};

export function failReasonLabel(reason: string): string {
  return FAIL_REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

/** "42%", or "–" when there's nothing to divide. Takes a percentage. */
export function formatPct(value: number | null): string {
  return value === null ? "–" : `${Math.round(value)}%`;
}
