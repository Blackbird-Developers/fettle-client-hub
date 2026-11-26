// Front-end helpers for the date picker on the admin work-list pages that
// read live from Acuity (Hot leads, Psychiatry, Assessments, Portal adoption):
// the admin-analytics?action=periods query for their "in this period"
// figures, and the live window their lists cover. The figures themselves come
// from supabase/functions/admin-analytics/worklists.ts.

import type {
  AdoptionPeriodTotals,
  ClinicalPeriodTotals,
  LeadPeriodTotals,
  PeriodsParams,
  Worklist,
} from "../../supabase/functions/admin-analytics/worklists.ts";
import { type BoardComparison, comparisonQuery } from "./adminAnalytics";
import { type DayRange, addDays } from "./datePresets";

export interface PeriodTotalsByList {
  leads: LeadPeriodTotals;
  clinical: ClinicalPeriodTotals;
  adoption: AdoptionPeriodTotals;
}

export interface PeriodsResponse<L extends Worklist = Worklist> {
  generatedAt: string;
  data: { lastRefreshedAt: string };
  params: PeriodsParams;
  totals: PeriodTotalsByList[L];
  compare: PeriodTotalsByList[L];
}

/** The admin-analytics query for a page's period figures. */
export function periodsQuery(list: Worklist, range: DayRange, compare: BoardComparison): string {
  return new URLSearchParams({ action: "periods", list, from: range.from, to: range.to, ...comparisonQuery(compare) }).toString();
}

/** An admin-analytics deployed before these figures answers with the
 *  Overview's numbers instead; this tells the two apart. */
export function isPeriodsResponse(value: unknown): value is PeriodsResponse {
  const v = value as Partial<PeriodsResponse> | null;
  return !!v && !!v.params && typeof (v.params as Partial<PeriodsParams>).list === "string" && !!v.totals && !!v.compare;
}

/** The first day a page's live list covers: today minus its look-back. */
export function liveWindowStart(today: string, lookbackDays: number): string {
  return addDays(today, -lookbackDays);
}
