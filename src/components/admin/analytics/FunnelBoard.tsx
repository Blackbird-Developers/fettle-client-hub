import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { AlertCircle, ChevronDown, Filter, Info, Loader2, RefreshCw, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminFunnel } from "@/hooks/useAdmin";
import { formatFullDay, formatRange } from "@/lib/adminAnalytics";
import {
  type FunnelResponse,
  DEVICE_LABELS,
  FLOW_LABELS,
  NO_FUNNEL_FILTERS,
  PATH_LABELS,
  failReasonLabel,
  formatPct,
  funnelQuery,
  funnelRange,
  readFunnelFilters,
  serviceLabel,
  withFunnelFilters,
} from "@/lib/adminFunnel";
import {
  type FunnelFilters,
  type FunnelPoint,
  FUNNEL_DEVICES,
  FUNNEL_FLOWS,
  FUNNEL_PATHS,
} from "../../../../supabase/functions/admin-analytics/funnel.ts";
import { type DateRange, dublinDate } from "../../../../supabase/functions/admin-analytics/logic.ts";
import { SERIES_COLORS } from "./chartStyle";
import { MetricTile, StaticLegend, TooltipBox } from "./parts";

const ALL = "all";

const chartConfig: ChartConfig = {
  opened: { label: "Opened the booking page", color: SERIES_COLORS[0] },
  booked: { label: "Booked", color: SERIES_COLORS[1] },
};

function pointLabel(key: string, groupBy: "day" | "week"): string {
  const d = new Date(`${key}T00:00:00Z`);
  const short = d.toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
  return groupBy === "week" ? `w/c ${short}` : short;
}

function TrendTooltip({
  active,
  payload,
  groupBy,
}: {
  active?: boolean;
  payload?: { payload: FunnelPoint }[];
  groupBy: "day" | "week";
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox title={groupBy === "week" ? `Week of ${formatFullDay(p.key)}` : formatFullDay(p.key)}>
      {(["opened", "booked"] as const).map((key) => (
        <div key={key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartConfig[key].color }} aria-hidden />
            {chartConfig[key].label}
          </span>
          <span className="font-medium tabular-nums text-foreground">{p[key]}</span>
        </div>
      ))}
      <p className="text-muted-foreground">Conversion {formatPct(p.conversion)}</p>
    </TooltipBox>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  allLabel,
  onChange,
  width = "w-40",
}: {
  id: string;
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  allLabel: string;
  onChange: (value: string | null) => void;
  width?: string;
}) {
  // A value from a shared link that isn't in the list still shows.
  const all = value && !options.some((o) => o.value === value) ? [...options, { value, label: value }] : options;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        <SelectTrigger id={id} className={`h-9 ${width}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {all.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SmallTable({
  title,
  head,
  rows,
  empty,
}: {
  title: string;
  head: string[];
  rows: (string | number)[][];
  empty: string;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h4 className="text-sm font-medium">{title}</h4>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-muted/40 p-4 text-center text-xs text-muted-foreground">{empty}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {head.map((h, i) => (
                <TableHead key={h} className={i > 0 ? "text-right" : undefined}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={String(row[0])}>
                {row.map((cell, i) => (
                  <TableCell key={i} className={i > 0 ? "text-right tabular-nums" : undefined}>
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function FunnelSkeleton() {
  return (
    <Card className="border-border/50" aria-label="Loading the booking funnel">
      <CardContent className="space-y-4 p-6">
        <Skeleton className="h-5 w-48" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </Card>
  );
}

function FunnelContent({
  data,
  onFilter,
}: {
  data: FunnelResponse;
  onFilter: (patch: Partial<FunnelFilters>) => void;
}) {
  const f = data.funnel;
  const [showTable, setShowTable] = useState(false);
  const opened = f.stages[0]?.sessions ?? 0;
  const booked = f.stages[f.stages.length - 1]?.sessions ?? 0;
  const conversion = opened > 0 ? (booked / opened) * 100 : null;
  const max = Math.max(opened, 1);
  const rows = useMemo(() => f.series.map((p) => ({ ...p, label: pointLabel(p.key, f.groupBy) })), [f.series, f.groupBy]);

  if (f.sessions === 0) {
    return (
      <p className="rounded-lg bg-muted/40 p-8 text-center text-sm text-muted-foreground">
        {data.trackingStart
          ? "No visits to the booking forms match these settings."
          : "No booking-form visits recorded yet. Numbers appear here once the website starts sending them."}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile
          label="Book Now clicks"
          value={String(f.bookNowClicks)}
          detail="On a therapist's card on /our-therapists"
        />
        <MetricTile label="Opened a booking form" value={String(opened)} detail="Visits, website and hub" />
        <MetricTile
          label="Booked"
          value={String(booked)}
          detail={`${f.outcomes.sessionsBooked} sessions · ${f.outcomes.bundlesBought} bundles`}
        />
        <MetricTile label="Conversion" value={formatPct(conversion)} detail="Booked ÷ opened" />
      </div>

      {f.biggestDrop && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Biggest drop: {f.biggestDrop.label}</AlertTitle>
          <AlertDescription>
            {f.biggestDrop.lost} visitors ({formatPct(f.biggestDrop.lostPct)}) stopped before reaching this step.
          </AlertDescription>
        </Alert>
      )}

      <section aria-labelledby="funnel-steps-title" className="space-y-3">
        <h4 id="funnel-steps-title" className="text-sm font-medium">
          How far visitors get
        </h4>
        <ol className="space-y-2" aria-labelledby="funnel-steps-title">
          {f.stages.map((s, i) => {
            const isDrop = f.biggestDrop?.stage === s.stage;
            return (
              <li key={s.stage} className="space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
                  <span className={isDrop ? "font-semibold" : "font-medium"}>
                    {i + 1}. {s.label}
                    {isDrop && <span className="ml-2 text-xs font-normal text-muted-foreground">biggest drop</span>}
                  </span>
                  <span className="tabular-nums">
                    {s.sessions}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {formatPct(s.fromStart)} of opened
                      {s.fromPrevious !== null && ` · ${formatPct(s.fromPrevious)} of previous step`}
                    </span>
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(s.sessions / max) * 100}%`, backgroundColor: SERIES_COLORS[0] }}
                  />
                </div>
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-muted-foreground">
          Each visit counts up to the furthest step it reached. Steps a visitor never sees still count as passed:
          "Who it's for" when the therapist offers one service, the plan for psychologists, and Review and Pay for
          website bundle buyers, who pay in My Fettle. {f.outcomes.bundleHandoffs} visitors were sent to My Fettle for
          a bundle; {f.outcomes.bundlesBought} bought it.
        </p>
      </section>

      <section aria-labelledby="funnel-trend-title" className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h4 id="funnel-trend-title" className="text-sm font-medium">
            Visits and bookings by {f.groupBy}
          </h4>
          <StaticLegend items={[chartConfig.opened, chartConfig.booked].map((c) => ({ label: String(c.label), color: c.color! }))} />
        </div>
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-56 w-full"
          role="img"
          aria-label="Line chart of booking-form visits and bookings over time. The same numbers are in the table below."
        >
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
            <ChartTooltip content={<TrendTooltip groupBy={f.groupBy} />} />
            {(["opened", "booked"] as const).map((key) => (
              <Line
                key={key}
                dataKey={key}
                stroke={`var(--color-${key})`}
                strokeWidth={2}
                dot={rows.length <= 31 ? { r: 4, strokeWidth: 2, fill: "hsl(var(--card))" } : false}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ChartContainer>
        <Collapsible open={showTable} onOpenChange={setShowTable}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
              <ChevronDown className={`mr-1 h-3 w-3 transition-transform ${showTable ? "rotate-180" : ""}`} aria-hidden />
              {showTable ? "Hide" : "Show"} the numbers as a table
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{f.groupBy === "week" ? "Week of" : "Day"}</TableHead>
                  <TableHead className="text-right">Opened</TableHead>
                  <TableHead className="text-right">Booked</TableHead>
                  <TableHead className="text-right">Conversion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {f.series.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell>{formatFullDay(p.key)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.opened}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.booked}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPct(p.conversion)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>
      </section>

      <section aria-labelledby="funnel-therapists-title" className="space-y-2">
        <h4 id="funnel-therapists-title" className="text-sm font-medium">
          By therapist
        </h4>
        <p className="text-xs text-muted-foreground">
          Book Now clicks count the card clicked. The other columns count the therapist the visitor ended up with, so
          matched visitors count for the therapist they picked. Select a name to filter the whole tab.
        </p>
        {f.therapists.length === 0 ? (
          <p className="rounded-lg bg-muted/40 p-4 text-center text-xs text-muted-foreground">No therapists yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Therapist</TableHead>
                <TableHead className="text-right">Book Now clicks</TableHead>
                <TableHead className="text-right">Opened</TableHead>
                <TableHead className="text-right">Reached payment</TableHead>
                <TableHead className="text-right">Booked</TableHead>
                <TableHead className="text-right">Conversion</TableHead>
                <TableHead className="text-right">Via matching</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {f.therapists.map((t) => (
                <TableRow key={t.therapist}>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left font-medium text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onFilter({ therapist: t.therapist })}
                    >
                      {t.therapist}
                    </button>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.clicks}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.opened}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.reachedPayment}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.booked}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(t.conversion)}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.matched}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <SmallTable
          title="By path"
          head={["Path", "Opened", "Booked", "Conversion"]}
          rows={f.byPath.filter((p) => p.opened > 0).map((p) => [PATH_LABELS[p.path], p.opened, p.booked, formatPct(p.conversion)])}
          empty="No visits."
        />
        <SmallTable
          title="By device"
          head={["Device", "Opened", "Booked", "Conversion"]}
          rows={f.byDevice
            .filter((d) => d.opened > 0)
            .map((d) => [DEVICE_LABELS[d.device] ?? d.device, d.opened, d.booked, formatPct(d.conversion)])}
          empty="No visits."
        />
        <SmallTable
          title="Why payments failed"
          head={["Reason", "Visits"]}
          rows={f.failReasons.map((r) => [failReasonLabel(r.reason), r.sessions])}
          empty="No failed payments."
        />
        <SmallTable
          title="How did you hear about Fettle?"
          head={["Answer", "Visits"]}
          rows={f.referralSources.map((r) => [r.source, r.sessions])}
          empty="No answers yet. The question is optional, on the Done screen."
        />
      </div>
    </div>
  );
}

/** The Overview's Booking funnel tab: website + hub booking forms, step by step. */
export function FunnelBoard({ range: requestedRange }: { range: DateRange }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFunnelFilters(searchParams), [searchParams]);
  const { range, clipped } = funnelRange(requestedRange);
  const { data, error, isPending, isFetching, refetch } = useAdminFunnel(funnelQuery(range, filters));
  const setFilters = (patch: Partial<FunnelFilters>) =>
    setSearchParams(withFunnelFilters(searchParams, { ...filters, ...patch }), { replace: true });
  const anyFilter = Object.values(filters).some(Boolean);

  const therapistOptions = (data?.funnel.options.therapists ?? []).map((t) => ({ value: t, label: t }));
  const serviceOptions = (data?.funnel.options.services ?? []).map((s) => ({ value: s, label: serviceLabel(s) }));

  return (
    <Card className="border-border/50">
      <CardHeader className="space-y-3 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-primary" aria-hidden />
            Booking funnel
          </CardTitle>
          <CardDescription>
            How far visitors get through the booking forms on fettle.ie/book-a-session and in My Fettle, where they
            drop off, and which therapists they choose. Anonymous visits; test bookings left out.
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            id="funnel-flow"
            label="Where"
            value={filters.flow}
            allLabel="Website and hub"
            options={FUNNEL_FLOWS.map((v) => ({ value: v, label: FLOW_LABELS[v] }))}
            onChange={(v) => setFilters({ flow: v as FunnelFilters["flow"] })}
            width="w-44"
          />
          <FilterSelect
            id="funnel-path"
            label="Path"
            value={filters.path}
            allLabel="All paths"
            options={FUNNEL_PATHS.map((v) => ({ value: v, label: PATH_LABELS[v] }))}
            onChange={(v) => setFilters({ path: v as FunnelFilters["path"] })}
            width="w-56"
          />
          <FilterSelect
            id="funnel-service"
            label="Service"
            value={filters.service}
            allLabel="All services"
            options={serviceOptions}
            onChange={(v) => setFilters({ service: v })}
            width="w-36"
          />
          <FilterSelect
            id="funnel-therapist"
            label="Therapist"
            value={filters.therapist}
            allLabel="All therapists"
            options={therapistOptions}
            onChange={(v) => setFilters({ therapist: v })}
            width="w-48"
          />
          <FilterSelect
            id="funnel-device"
            label="Device"
            value={filters.device}
            allLabel="All devices"
            options={FUNNEL_DEVICES.map((v) => ({ value: v, label: DEVICE_LABELS[v] }))}
            onChange={(v) => setFilters({ device: v })}
            width="w-32"
          />
          {anyFilter && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setFilters(NO_FUNNEL_FILTERS)}>
              <X className="mr-1 h-3 w-3" aria-hidden />
              Clear filters
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          {clipped && <span>The funnel shows at most a year: {formatRange(range)}.</span>}
          {data?.trackingStart && <span>Tracking since {formatFullDay(dublinDate(Date.parse(data.trackingStart)))}</span>}
          {isFetching && !isPending && (
            <span className="flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Updating…
            </span>
          )}
        </div>
        {isPending ? (
          <FunnelSkeleton />
        ) : error && !data ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load the booking funnel</AlertTitle>
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
            <FunnelContent data={data} onFilter={setFilters} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
