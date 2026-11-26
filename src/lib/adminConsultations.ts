// Front-end helpers for the admin Overview's "Free consultations" tab: the
// admin-analytics query, the tab's own grouping in the URL, and labels. The
// numbers come from supabase/functions/admin-analytics/consultations.ts.

import {
  type ConsultationGroupBy,
  type ConsultationParams,
  type ConsultationReport,
  type FreeCallType,
  CONSULTATION_DAY_LIMIT_DAYS,
  defaultConsultationGroupBy,
} from "../../supabase/functions/admin-analytics/consultations.ts";
import { type DateRange, daysInRange } from "../../supabase/functions/admin-analytics/logic.ts";
import { type BoardComparison, comparisonQuery, describePeriod, formatDay, formatFullDay, formatPeriod } from "./adminAnalytics";

export type ConsultationsResponse = ConsultationReport & {
  generatedAt: string;
  data: { lastRefreshedAt: string; historyComplete: boolean; historyFrom: string | null };
  params: ConsultationParams;
};

/** An admin-analytics deployed before this tab answers action=consultations
 *  with the other boards' numbers; this tells the two apart. */
export function isConsultationsResponse(value: unknown): value is ConsultationsResponse {
  const v = value as Partial<ConsultationsResponse> | null;
  return !!v && Array.isArray(v.series) && Array.isArray(v.byCalendar) && !!v.totals?.segments;
}

export const FREE_CALL_LABELS: Record<FreeCallType, string> = {
  lets_talk: "Let's Talk",
  intro_chat: "Introduction Chat",
};

// The tab's own Day / Week / Month choice, kept in the URL as cgroup.
// Missing = worked out from the range.
export const CONSULTATION_GROUP_PARAM = "cgroup";

/** Day can only be picked for ranges up to CONSULTATION_DAY_LIMIT_DAYS. */
export function canGroupByDay(range: DateRange): boolean {
  return daysInRange(range) <= CONSULTATION_DAY_LIMIT_DAYS;
}

/** The grouping to show: the one in the URL if it suits the range, else the default. */
export function consultationGroupBy(search: URLSearchParams, range: DateRange): ConsultationGroupBy {
  const chosen = search.get(CONSULTATION_GROUP_PARAM);
  if (chosen === "week" || chosen === "month") return chosen;
  if (chosen === "day" && canGroupByDay(range)) return "day";
  return defaultConsultationGroupBy(range);
}

/** The admin-analytics query for the tab. */
export function consultationsQuery(
  range: DateRange,
  groupBy: ConsultationGroupBy,
  windowDays: number,
  compare: BoardComparison
): string {
  return new URLSearchParams({
    action: "consultations",
    from: range.from,
    to: range.to,
    group: groupBy,
    window: String(windowDays),
    ...comparisonQuery(compare),
  }).toString();
}

/** Axis label: "6 Oct" for a day or week, "Oct 26" for a month. */
export function consultationAxisLabel(key: string, groupBy: ConsultationGroupBy): string {
  return groupBy === "day" ? formatDay(key) : formatPeriod(key, groupBy);
}

/** Table / tooltip label: "Tue 6 Oct 2026", "Week of 6 Oct 2026", "October 2026". */
export function describeConsultationPeriod(key: string, groupBy: ConsultationGroupBy): string {
  if (groupBy !== "day") return describePeriod(key, groupBy);
  const weekday = new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", timeZone: "UTC" });
  return `${weekday} ${formatFullDay(key)}`;
}
