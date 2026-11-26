import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { AlertCircle, Info, Loader2, PhoneCall, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAdminConsultations } from "@/hooks/useAdmin";
import {
  type BoardComparison,
  comparisonLabel,
  formatCountChange,
  formatFullDay,
  formatPoints,
  formatRange,
  formatRate,
  pointsChange,
} from "@/lib/adminAnalytics";
import {
  type ConsultationsResponse,
  CONSULTATION_GROUP_PARAM,
  FREE_CALL_LABELS,
  canGroupByDay,
  consultationAxisLabel,
  consultationGroupBy,
  consultationsQuery,
  describeConsultationPeriod,
  isConsultationsResponse,
} from "@/lib/adminConsultations";
import type {
  CallCounts,
  ConsultationGroupBy,
  ConsultationPoint,
} from "../../../../supabase/functions/admin-analytics/consultations.ts";
import { CONVERSION_WINDOWS, type DateRange } from "../../../../supabase/functions/admin-analytics/logic.ts";
import { NEUTRAL_COLOR, SERIES_COLORS, toneOf } from "./chartStyle";
import { MetricTile, StaticLegend, TooltipBox } from "./parts";

// Stacked bars, bottom to top. Keys match ConsultationPoint's counts.
const STACK: { key: "attended" | "noShows" | "upcoming"; label: string; color: string }[] = [
  { key: "attended", label: "Attended", color: SERIES_COLORS[0] },
  { key: "noShows", label: "No-show", color: SERIES_COLORS[1] },
  { key: "upcoming", label: "Still to come", color: NEUTRAL_COLOR },
];

const barConfig: ChartConfig = Object.fromEntries(STACK.map((s) => [s.key, { label: s.label, color: s.color }]));

const GROUP_LABELS: Record<ConsultationGroupBy, string> = { day: "Day", week: "Week", month: "Month" };

function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleString("en-IE", {
    timeZone: "Europe/Dublin",
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}

type ChartRow = ConsultationPoint & { label: string };

function CallsTooltip({
  active,
  payload,
  groupBy,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  groupBy: ConsultationGroupBy;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <TooltipBox title={describeConsultationPeriod(row.key, groupBy)}>
      {[...STACK].reverse().map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </span>
          <span className="font-medium tabular-nums text-foreground">{row[s.key]}</span>
        </div>
      ))}
      <p className="text-muted-foreground">
        {row.newCalls} new · {row.existingCalls} existing · {row.converted} converted
      </p>
    </TooltipBox>
  );
}

/** "50% (3 of 6)", or "–" with nothing attended. */
function conversionCell(counts: CallCounts): string {
  return counts.conversionRate === null ? "–" : `${formatRate(counts.conversionRate)} (${counts.converted}/${counts.attended})`;
}

function ConsultationsSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading free consultations">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function ConsultationsContent({
  data,
  compareLabel,
}: {
  data: ConsultationsResponse;
  compareLabel: string | null;
}) {
  const { totals, compare, series, byCalendar } = data;
  const { groupBy, windowDays } = data.params;
  const rows: ChartRow[] = series.map((point) => ({ ...point, label: consultationAxisLabel(point.key, groupBy) }));
  const hasCalls = totals.booked > 0;
  const vs = (change: string | null) => (change && compareLabel ? `${change} vs ${compareLabel}` : null);
  const conversionChange = pointsChange(totals.conversionRate, compare.conversionRate);
  const segments = [
    { label: "New customers", counts: totals.segments.new },
    { label: "Existing customers", counts: totals.segments.existing },
    { label: "All", counts: totals },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Calls booked"
          value={String(totals.booked)}
          change={vs(formatCountChange(totals.booked, compare.booked))}
          tone={toneOf(totals.booked - compare.booked)}
          detail={`${totals.people} ${totals.people === 1 ? "person" : "people"} · ${totals.upcoming} still to come`}
        />
        <MetricTile
          label="No-shows"
          value={String(totals.noShows)}
          change={vs(formatCountChange(totals.noShows, compare.noShows))}
          // Fewer no-shows is the good direction.
          tone={toneOf(compare.noShows - totals.noShows)}
          detail={`${formatRate(totals.noShowRate)} of past calls`}
        />
        <MetricTile
          label="New vs existing"
          value={`${totals.newCalls} / ${totals.existingCalls}`}
          change={vs(formatCountChange(totals.newCalls, compare.newCalls))}
          tone={toneOf(totals.newCalls - compare.newCalls)}
          detail="New customers / existing customers"
        />
        <MetricTile
          label="Conversion rate"
          value={formatRate(totals.conversionRate)}
          change={conversionChange === null ? null : vs(formatPoints(conversionChange))}
          tone={toneOf(conversionChange)}
          detail={`${totals.converted} of ${totals.attended} attended booked a paid session within ${windowDays} days`}
        />
      </div>
      {totals.maturing > 0 && (
        <p className="text-xs text-muted-foreground">
          {totals.maturing} attended call{totals.maturing === 1 ? " is" : "s are"} less than {windowDays} days ago, so
          the conversion rate can still rise.
        </p>
      )}

      <section aria-labelledby="consultations-segments-title" className="space-y-3">
        <h4 id="consultations-segments-title" className="text-sm font-medium">
          New and existing customers
        </h4>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Who</TableHead>
                <TableHead scope="col">Booked</TableHead>
                <TableHead scope="col">Attended</TableHead>
                <TableHead scope="col">No-shows</TableHead>
                <TableHead scope="col">Converted</TableHead>
                <TableHead scope="col">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {segments.map(({ label, counts }) => (
                <TableRow key={label} className={label === "All" ? "font-medium" : undefined}>
                  <TableCell>{label}</TableCell>
                  <TableCell className="tabular-nums">{counts.booked}</TableCell>
                  <TableCell className="tabular-nums">{counts.attended}</TableCell>
                  <TableCell className="tabular-nums">{counts.noShows}</TableCell>
                  <TableCell className="tabular-nums">{counts.converted}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{conversionCell(counts)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="consultations-chart-title" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h4 id="consultations-chart-title" className="text-sm font-medium">
            Calls by {groupBy}
          </h4>
          <StaticLegend items={STACK.map((s) => ({ label: s.label, color: s.color }))} />
        </div>
        {hasCalls ? (
          <ChartContainer
            config={barConfig}
            className="aspect-auto h-64 w-full"
            role="img"
            aria-label="Stacked bar chart of free calls attended, missed and still to come. The same numbers are in the table below."
          >
            <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
              <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<CallsTooltip groupBy={groupBy} />} />
              {STACK.map((s, i) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  stackId="calls"
                  fill={`var(--color-${s.key})`}
                  stroke="hsl(var(--card))"
                  strokeWidth={1}
                  radius={i === STACK.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartContainer>
        ) : (
          <p className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            No free calls in this range.
          </p>
        )}
      </section>

      <section aria-labelledby="consultations-table-title" className="space-y-3">
        <h4 id="consultations-table-title" className="text-sm font-medium">
          {GROUP_LABELS[groupBy]} by {groupBy}
        </h4>
        <div className="max-h-96 overflow-auto rounded-md border border-border/50">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{groupBy === "day" ? "Day" : groupBy === "week" ? "Week of" : "Month"}</TableHead>
                <TableHead scope="col">Booked</TableHead>
                <TableHead scope="col">Attended</TableHead>
                <TableHead scope="col">No-shows</TableHead>
                <TableHead scope="col">New</TableHead>
                <TableHead scope="col">Existing</TableHead>
                <TableHead scope="col">Converted</TableHead>
                <TableHead scope="col">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...series].reverse().map((point) => (
                <TableRow key={point.key}>
                  <TableCell className="whitespace-nowrap">{describeConsultationPeriod(point.key, groupBy)}</TableCell>
                  <TableCell className="tabular-nums">{point.booked}</TableCell>
                  <TableCell className="tabular-nums">{point.attended}</TableCell>
                  <TableCell className="tabular-nums">{point.noShows}</TableCell>
                  <TableCell className="tabular-nums">{point.newCalls}</TableCell>
                  <TableCell className="tabular-nums">{point.existingCalls}</TableCell>
                  <TableCell className="tabular-nums">{point.converted}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{conversionCell(point)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">Newest first. Calls still to come count as booked only.</p>
      </section>

      {byCalendar.length > 0 && (
        <section aria-labelledby="consultations-calendar-title" className="space-y-3">
          <h4 id="consultations-calendar-title" className="text-sm font-medium">
            By calendar
          </h4>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Calendar</TableHead>
                  <TableHead scope="col">Booked</TableHead>
                  <TableHead scope="col">Attended</TableHead>
                  <TableHead scope="col">No-shows</TableHead>
                  <TableHead scope="col">Converted</TableHead>
                  <TableHead scope="col">Conversion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byCalendar.map((row) => (
                  <TableRow key={`${row.calendarId}-${row.calendar}`}>
                    <TableCell>{row.calendar}</TableCell>
                    <TableCell className="tabular-nums">{row.booked}</TableCell>
                    <TableCell className="tabular-nums">{row.attended}</TableCell>
                    <TableCell className="tabular-nums">{row.noShows}</TableCell>
                    <TableCell className="tabular-nums">{row.converted}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{conversionCell(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          {totals.byType.map((t) => `${FREE_CALL_LABELS[t.type]}: ${t.booked}`).join(" · ")}. Cancelled calls are left
          out.
        </p>
        <p>
          A no-show is a past call labelled "No Show" in Acuity; every other past call counts as attended. Existing
          customers had a paid session before the call. A call converts when the person books a paid session after it,
          within {windowDays} days. People are matched by email, so someone who books with a different email looks new.
          Labels added more than 60 days after a call aren't picked up.
        </p>
      </div>
    </div>
  );
}

/** The Overview's Free consultations tab: Let's Talk and Introduction Chat calls. */
export function ConsultationsBoard({
  range,
  compare,
  windowDays,
  onWindowChange,
}: {
  range: DateRange;
  /** The comparison period; null when compare is off. */
  compare: BoardComparison;
  windowDays: number;
  onWindowChange: (days: number) => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const groupBy = consultationGroupBy(searchParams, range);
  const dayAllowed = canGroupByDay(range);
  const query = useAdminConsultations(consultationsQuery(range, groupBy, windowDays, compare));
  const { error, isPending, isFetching, refetch } = query;
  const outdated = query.data !== undefined && !isConsultationsResponse(query.data);
  const data = outdated ? undefined : query.data;
  const compareLabel = comparisonLabel(compare);

  const chooseGroup = (value: string) => {
    if (!value) return;
    const search = new URLSearchParams(searchParams);
    search.set(CONSULTATION_GROUP_PARAM, value);
    setSearchParams(search, { replace: true });
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-col gap-3 pb-2 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <PhoneCall className="h-4 w-4 text-primary" aria-hidden />
            Free consultations
          </CardTitle>
          <CardDescription>
            Let's Talk and Introduction Chat calls: how many were booked, who didn't show, new vs existing customers,
            and how many went on to book a paid session.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" id="consultations-group-label">
              Show by
            </span>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={groupBy}
              onValueChange={chooseGroup}
              aria-labelledby="consultations-group-label"
            >
              {(["day", "week", "month"] as const).map((g) => (
                <ToggleGroupItem
                  key={g}
                  value={g}
                  className="text-xs"
                  disabled={g === "day" && !dayAllowed}
                  title={g === "day" && !dayAllowed ? "Pick 93 days or fewer to see each day" : undefined}
                >
                  {GROUP_LABELS[g]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground" id="consultations-window-label">
              Converted within
            </span>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={String(windowDays)}
              onValueChange={(value) => value && onWindowChange(Number(value))}
              aria-labelledby="consultations-window-label"
            >
              {CONVERSION_WINDOWS.map((days) => (
                <ToggleGroupItem key={days} value={String(days)} className="text-xs">
                  {days} days
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          {data && <span>Data last updated: {formatUpdated(data.data.lastRefreshedAt)}</span>}
          {data && compare && <span>Compared with {formatRange(data.params.compareRange)}</span>}
          {isFetching && !isPending && (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Updating…
            </span>
          )}
        </div>
        {outdated ? (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>The Free consultations tab isn't switched on yet</AlertTitle>
            <AlertDescription>
              The server side of this tab hasn't been deployed. It will show figures once the latest admin-analytics
              function is live.
            </AlertDescription>
          </Alert>
        ) : isPending ? (
          <ConsultationsSkeleton />
        ) : error && !data ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load the free consultations</AlertTitle>
            <AlertDescription className="mt-2 space-y-3">
              <p>{error.message}</p>
              {error.retryable && (
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="mr-2 h-3 w-3" />
                  Try again
                </Button>
              )}
            </AlertDescription>
          </Alert>
        ) : data ? (
          <>
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Couldn't load the new settings, so these are the previous numbers. {error.message}
                </AlertDescription>
              </Alert>
            )}
            {!data.data.historyComplete && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Still copying older appointments from Acuity</AlertTitle>
                <AlertDescription>
                  History is in from {data.data.historyFrom ? formatFullDay(data.data.historyFrom) : "the last 60 days"}{" "}
                  onwards. Until the rest arrives, some existing customers look new.
                </AlertDescription>
              </Alert>
            )}
            <ConsultationsContent data={data} compareLabel={compareLabel} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
