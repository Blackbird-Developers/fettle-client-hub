import { Skeleton } from "@/components/ui/skeleton";
import { useWorklistPeriods } from "@/hooks/useAdmin";
import {
  type BoardComparison,
  comparisonLabel,
  countChangeHint,
  formatPoints,
  formatRate,
  pointsChange,
} from "@/lib/adminAnalytics";
import { type PeriodTotalsByList, isPeriodsResponse, periodsQuery } from "@/lib/adminWorklists";
import { type DayRange, formatDayRange } from "@/lib/datePresets";
import type { Worklist } from "../../../supabase/functions/admin-analytics/worklists.ts";
import { StatTile } from "./CustomerInsightsShared";

export interface PeriodFigure {
  label: string;
  /** A count, or a 0–1 rate. */
  current: number | null;
  previous: number | null;
  kind: "count" | "rate";
  /** Shown under the number when there's no comparison. */
  detail?: string;
}

/**
 * The "in this period" figures on a work-list page, from the Acuity copy
 * (admin-analytics?action=periods), with their change against the
 * comparison period. The page's own list stays live from Acuity.
 */
export function PeriodFigures<L extends Worklist>({
  list,
  range,
  compare,
  figures,
}: {
  list: L;
  range: DayRange;
  compare: BoardComparison;
  /** The tiles, from the period's totals and the comparison's (null when compare is off). */
  figures: (totals: PeriodTotalsByList[L], previous: PeriodTotalsByList[L] | null) => PeriodFigure[];
}) {
  const query = useWorklistPeriods(periodsQuery(list, range, compare));
  const label = comparisonLabel(compare);
  const outdated = query.data !== undefined && !isPeriodsResponse(query.data);

  const hint = (figure: PeriodFigure): string | undefined => {
    if (label && figure.current !== null) {
      if (figure.kind === "count") return countChangeHint(figure.current, figure.previous, label) ?? undefined;
      const points = pointsChange(figure.current, figure.previous);
      return points === null ? undefined : `${formatPoints(points)} vs ${label}`;
    }
    return figure.detail;
  };

  return (
    <section aria-labelledby={`${list}-period-title`} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={`${list}-period-title`} className="text-sm font-medium">
          In this period ({formatDayRange(range)})
        </h3>
        <p className="text-xs text-muted-foreground">From the hourly copy of Acuity, so it can reach further back</p>
      </div>
      {outdated ? (
        <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
          Figures for the chosen period appear once the latest admin-analytics function is deployed.
        </p>
      ) : query.isPending ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4" aria-label="Loading the period's figures">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : query.error && !query.data ? (
        <p className="rounded-lg bg-muted/40 p-4 text-sm text-muted-foreground">
          Couldn't load the period's figures. {query.error.message}
        </p>
      ) : query.data ? (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {figures(
            query.data.totals as PeriodTotalsByList[L],
            compare ? (query.data.compare as PeriodTotalsByList[L]) : null
          ).map((figure) => (
            <StatTile
              key={figure.label}
              label={figure.label}
              value={figure.current === null ? "–" : figure.kind === "rate" ? formatRate(figure.current) : String(figure.current)}
              hint={hint(figure)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
