import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChevronDown, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type AnalyticsResponse,
  type ProgressionChartRow,
  describePartialPeriod,
  describePeriod,
  formatFullDay,
  formatPoints,
  formatRate,
  pointsChange,
  progressionChartRows,
  stageLabel,
} from "@/lib/adminAnalytics";
import {
  type StageResult,
  CONVERSION_WINDOWS,
  STAGES,
} from "../../../../supabase/functions/admin-analytics/logic.ts";
import { SERIES_COLORS, toneOf } from "./chartStyle";
import { MetricTile, ToggleLegend, TooltipBox } from "./parts";

const chartConfig: ChartConfig = Object.fromEntries(
  STAGES.flatMap((stage, i) => [
    [`s${stage}`, { label: `Session ${stageLabel(stage)}`, color: SERIES_COLORS[i] }],
    [`s${stage}Maturing`, { label: `Session ${stageLabel(stage)} (maturing)`, color: SERIES_COLORS[i] }],
  ])
);

const stageResult = (stages: StageResult[], stage: number) => stages.find((s) => s.stage === stage)!;

function rateWithCounts(result: StageResult): string {
  return result.rate === null ? "No clients" : `${formatRate(result.rate)} (${result.progressed} of ${result.cohort})`;
}

function ProgressionTooltip({
  active,
  payload,
  groupBy,
  hidden,
}: {
  active?: boolean;
  payload?: { payload: ProgressionChartRow }[];
  groupBy: AnalyticsResponse["params"]["groupBy"];
  hidden: Set<string>;
}) {
  if (!active || !payload?.length) return null;
  const { point, partial } = payload[0].payload;
  return (
    <TooltipBox title={describePeriod(point.period.key, groupBy)}>
      {point.stages
        .filter((s) => !hidden.has(`s${s.stage}`))
        .map((s) => (
          <div key={s.stage} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: SERIES_COLORS[s.stage - 1] }}
                aria-hidden
              />
              {stageLabel(s.stage)}
            </span>
            <span className="font-medium tabular-nums text-foreground">
              {s.rate === null ? "–" : `${formatRate(s.rate)} · ${s.progressed} of ${s.cohort} clients`}
            </span>
          </div>
        ))}
      {partial && <p className="text-muted-foreground">{describePartialPeriod(point.period)}</p>}
      {!point.final && (
        <p className="text-muted-foreground">Still maturing: final figure on {formatFullDay(point.finalOn)}</p>
      )}
    </TooltipBox>
  );
}

export function ProgressionBoard({
  data,
  onWindowChange,
}: {
  data: AnalyticsResponse;
  onWindowChange: (days: number) => void;
}) {
  const { totals, compare, series } = data.progression;
  const { groupBy, windowDays } = data.params;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const rows = useMemo(() => progressionChartRows(series, groupBy), [series, groupBy]);
  const hasData = series.some((point) => point.stages.some((s) => s.cohort > 0));
  const hasPartial = rows.some((row) => row.partial);

  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const overallChange = pointsChange(totals.overall.rate, compare.overall.rate);
  const firstStage = stageResult(totals.stages, 1);
  const firstChange = pointsChange(firstStage.rate, stageResult(compare.stages, 1).rate);
  const best = totals.best ? stageResult(totals.stages, totals.best) : null;
  const worst = totals.worst ? stageResult(totals.stages, totals.worst) : null;
  const compareLabel = data.params.compareTo === "year" ? "same period last year" : "previous period";
  const funnelMax = Math.max(...totals.funnel.map((f) => f.customers), 1);

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Repeat className="h-4 w-4 text-primary" aria-hidden />
            Progression over time
          </CardTitle>
          <CardDescription>
            Of the clients who completed session N, the share who completed or booked session N+1 within{" "}
            {windowDays} days.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" id="window-label">
            Within
          </span>
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={String(windowDays)}
            onValueChange={(value) => value && onWindowChange(Number(value))}
            aria-labelledby="window-label"
          >
            {CONVERSION_WINDOWS.map((days) => (
              <ToggleGroupItem key={days} value={String(days)} className="text-xs">
                {days} days
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricTile
            label="Overall progression"
            value={formatRate(totals.overall.rate)}
            change={overallChange === null ? null : `${formatPoints(overallChange)} vs ${compareLabel}`}
            tone={toneOf(overallChange)}
            detail={`${totals.overall.progressed} of ${totals.overall.cohort} across all stages`}
          />
          <MetricTile
            label="Session 1→2"
            value={formatRate(firstStage.rate)}
            change={firstChange === null ? null : `${formatPoints(firstChange)} vs ${compareLabel}`}
            tone={toneOf(firstChange)}
            detail={`${firstStage.progressed} of ${firstStage.cohort} clients`}
          />
          <MetricTile
            label="Best stage"
            value={best ? stageLabel(best.stage) : "–"}
            detail={best ? rateWithCounts(best) : "No clients in this range"}
          />
          <MetricTile
            label="Worst stage"
            value={worst ? stageLabel(worst.stage) : "–"}
            detail={worst ? rateWithCounts(worst) : "No clients in this range"}
          />
        </div>
        {!totals.final && (
          <p className="text-xs text-muted-foreground">
            Clients near the end of this range haven't had {windowDays} days to rebook yet, so these rates will
            still rise. Final figures on {formatFullDay(totals.finalOn)}.
          </p>
        )}

        <section aria-labelledby="progression-chart-title" className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 id="progression-chart-title" className="text-sm font-medium">
              Stage conversion by {groupBy}
            </h4>
            <ToggleLegend
              items={STAGES.map((stage, i) => ({ key: `s${stage}`, label: stageLabel(stage), color: SERIES_COLORS[i] }))}
              hidden={hidden}
              onToggle={toggle}
            />
          </div>
          {hasData ? (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-64 w-full"
              role="img"
              aria-label="Line chart of stage conversion rates over time. The same numbers are in the table below."
            >
              <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tickLine={false}
                  axisLine={false}
                  width={52}
                />
                <ChartTooltip content={<ProgressionTooltip groupBy={groupBy} hidden={hidden} />} />
                {STAGES.filter((stage) => !hidden.has(`s${stage}`)).flatMap((stage) => [
                  <Line
                    key={`s${stage}`}
                    dataKey={`s${stage}`}
                    stroke={`var(--color-s${stage})`}
                    strokeWidth={2}
                    dot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--card))" }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />,
                  <Line
                    key={`s${stage}Maturing`}
                    dataKey={`s${stage}Maturing`}
                    stroke={`var(--color-s${stage})`}
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    strokeOpacity={0.7}
                    dot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--card))", strokeOpacity: 0.5 }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />,
                ])}
              </LineChart>
            </ChartContainer>
          ) : (
            <p className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              No completed sessions in this range.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Dashed lines and faded points are still maturing: clients there haven't had {windowDays} days to rebook
            yet.
            {hasPartial && ` A ${groupBy} only partly inside the range is faded too, as it covers fewer days.`}
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-labelledby="funnel-title" className="space-y-3">
            <h4 id="funnel-title" className="text-sm font-medium">
              Clients completing each session in this range
            </h4>
            <ol className="space-y-2">
              {totals.funnel.map((step, i) => {
                const stage = totals.stages[i];
                return (
                  <li key={step.label} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">Session {step.label}</span>
                      <span className="tabular-nums">
                        {step.customers}
                        {stage && stage.rate !== null && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {formatRate(stage.rate)} went on to session {stage.stage + 1}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${(step.customers / funnelMax) * 100}%`, backgroundColor: SERIES_COLORS[0] }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby="gap-title" className="space-y-3">
            <h4 id="gap-title" className="text-sm font-medium">
              Median days between sessions
            </h4>
            <dl className="grid grid-cols-2 gap-3">
              {totals.stages.map((stage) => (
                <div key={stage.stage} className="rounded-lg bg-muted/40 p-3">
                  <dt className="text-xs text-muted-foreground">Session {stageLabel(stage.stage)}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {stage.medianDays === null ? "–" : `${Math.round(stage.medianDays)} days`}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">Among clients who went on within {windowDays} days.</p>
          </section>
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2 text-xs">
              <ChevronDown className="mr-1 h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
              Show the chart as a table
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="overflow-x-auto">
              <Table>
                <caption className="sr-only">Stage conversion by {groupBy}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{groupBy === "week" ? "Week of" : "Month"}</TableHead>
                    {STAGES.map((stage) => (
                      <TableHead key={stage} scope="col">
                        {stageLabel(stage)}
                      </TableHead>
                    ))}
                    <TableHead scope="col">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ point, partial }) => (
                    <TableRow key={point.period.key}>
                      <TableCell className="whitespace-nowrap">{describePeriod(point.period.key, groupBy)}</TableCell>
                      {point.stages.map((s) => (
                        <TableCell key={s.stage} className="whitespace-nowrap tabular-nums">
                          {s.rate === null ? "–" : `${formatRate(s.rate)} (${s.progressed}/${s.cohort})`}
                        </TableCell>
                      ))}
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {point.final ? "Final" : `Maturing, final ${formatFullDay(point.finalOn)}`}
                        {partial && ` · part ${groupBy}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {totals.excludedCustomers > 0 && (
          <p className="text-xs text-muted-foreground">
            {totals.excludedCustomers} client{totals.excludedCustomers === 1 ? "" : "s"} without an email left out:
            their full session history can't be confirmed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
