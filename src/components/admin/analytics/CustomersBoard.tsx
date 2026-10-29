import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChevronDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type AnalyticsResponse,
  SEGMENT_LABELS,
  describePeriod,
  formatCountChange,
  formatPeriod,
  formatRate,
} from "@/lib/adminAnalytics";
import type {
  Basis,
  CustomerPoint,
  CustomerSegment,
} from "../../../../supabase/functions/admin-analytics/logic.ts";
import { CustomerListDialog, type CustomerListRequest } from "./CustomerListDialog";
import { NEUTRAL_COLOR, SERIES_COLORS, toneOf } from "./chartStyle";
import { MetricTile, StaticLegend, TooltipBox } from "./parts";

// Stacked bars, bottom to top. Keys match CustomerPoint's counts.
const STACK: { key: "newSelf" | "newStaff" | "newUnknown" | "returning"; segment: CustomerSegment; label: string; color: string }[] = [
  { key: "newSelf", segment: "new_self", label: "New, self-booked", color: SERIES_COLORS[0] },
  { key: "newStaff", segment: "new_staff", label: "New, booked by the team", color: SERIES_COLORS[1] },
  { key: "newUnknown", segment: "new_unknown", label: "New, not checked yet", color: NEUTRAL_COLOR },
  { key: "returning", segment: "returning", label: "Returning", color: SERIES_COLORS[2] },
];

const barConfig: ChartConfig = Object.fromEntries(STACK.map((s) => [s.key, { label: s.label, color: s.color }]));
const shareConfig: ChartConfig = { share: { label: "Booked by clients", color: SERIES_COLORS[0] } };

interface BarRow extends CustomerPoint {
  label: string;
  share: number | null;
}

function CustomersTooltip({
  active,
  payload,
  groupBy,
}: {
  active?: boolean;
  payload?: { payload: BarRow }[];
  groupBy: AnalyticsResponse["params"]["groupBy"];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <TooltipBox title={describePeriod(row.period.key, groupBy)}>
      {[...STACK].reverse().map((s) => (
        <div key={s.key} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} aria-hidden />
            {s.label}
          </span>
          <span className="font-medium tabular-nums text-foreground">{row[s.key]}</span>
        </div>
      ))}
      <p className="text-muted-foreground">Click a bar to see the customers</p>
    </TooltipBox>
  );
}

function ShareTooltip({
  active,
  payload,
  groupBy,
}: {
  active?: boolean;
  payload?: { payload: BarRow }[];
  groupBy: AnalyticsResponse["params"]["groupBy"];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <TooltipBox title={describePeriod(row.period.key, groupBy)}>
      <p className="text-foreground">
        {formatRate(row.selfBookingShare)} booked by clients ({row.selfBookings} of {row.checkedBookings})
      </p>
      {row.bookings > row.checkedBookings && (
        <p className="text-muted-foreground">{row.bookings - row.checkedBookings} bookings not checked yet</p>
      )}
    </TooltipBox>
  );
}

export function CustomersBoard({
  data,
  onBasisChange,
}: {
  data: AnalyticsResponse;
  onBasisChange: (basis: Basis) => void;
}) {
  const { totals, compare, series } = data.customers;
  const { groupBy, basis, range } = data.params;
  const [list, setList] = useState<CustomerListRequest | null>(null);

  const rows: BarRow[] = series.map((point) => ({
    ...point,
    label: formatPeriod(point.period.key, groupBy),
    share: point.selfBookingShare === null ? null : Math.round(point.selfBookingShare * 1000) / 10,
  }));
  const hasCustomers = series.some((p) => p.active > 0);
  const hasBookings = series.some((p) => p.checkedBookings > 0);
  const compareLabel = data.params.compareTo === "year" ? "same period last year" : "previous period";

  const open = (segment: CustomerSegment, from = range.from, to = range.to) =>
    setList({ segment, range: { from, to }, basis, filters: data.params.filters, calendars: data.data.calendars });

  const tile = (label: string, segment: CustomerSegment, current: number, previous: number, detail?: string) => (
    <MetricTile
      label={label}
      value={String(current)}
      change={`${formatCountChange(current, previous)} vs ${compareLabel}`}
      tone={toneOf(current - previous)}
      detail={detail}
      onClick={() => open(segment)}
      actionLabel={`Show the ${SEGMENT_LABELS[segment].toLowerCase()}`}
    />
  );

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-primary" aria-hidden />
            Customers in this time frame
          </CardTitle>
          <CardDescription>
            New customers had their first-ever session {basis === "booking" ? "booked" : ""} in the range; returning
            customers had one before it. Click any number to see the customers.
          </CardDescription>
        </div>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={basis}
          onValueChange={(value) => value && onBasisChange(value as Basis)}
          aria-label="Count by"
        >
          <ToggleGroupItem value="session" className="text-xs">
            By session date
          </ToggleGroupItem>
          <ToggleGroupItem value="booking" className="text-xs">
            By booking date
          </ToggleGroupItem>
        </ToggleGroup>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tile("New customers", "new", totals.new, compare.new)}
          {tile(
            "New self-booked",
            "new_self",
            totals.newSelf,
            compare.newSelf,
            totals.new > 0 ? `${formatRate(totals.newSelf / totals.new)} of new customers` : undefined
          )}
          {tile("Returning customers", "returning", totals.returning, compare.returning)}
          {tile("Total active customers", "active", totals.active, compare.active)}
        </div>
        {totals.newUnknown > 0 && (
          <p className="text-xs text-muted-foreground">
            Who booked isn't known yet for{" "}
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => open("new_unknown")}
            >
              {totals.newUnknown} new customer{totals.newUnknown === 1 ? "" : "s"}
            </button>
            . Acuity is checked a batch at a time, so the self-booked count can still go up.
          </p>
        )}

        <section aria-labelledby="customers-chart-title" className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 id="customers-chart-title" className="text-sm font-medium">
              New and returning customers by {groupBy}
            </h4>
            <StaticLegend items={STACK.map((s) => ({ label: s.label, color: s.color }))} />
          </div>
          {hasCustomers ? (
            <ChartContainer
              config={barConfig}
              className="aspect-auto h-64 w-full"
              role="img"
              aria-label="Stacked bar chart of new and returning customers over time. The same numbers are in the table below."
            >
              <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={44} />
                <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<CustomersTooltip groupBy={groupBy} />} />
                {STACK.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="customers"
                    fill={`var(--color-${s.key})`}
                    stroke="hsl(var(--card))"
                    strokeWidth={1}
                    radius={i === STACK.length - 1 ? [4, 4, 0, 0] : 0}
                    className="cursor-pointer"
                    isAnimationActive={false}
                    onClick={(bar: { payload?: BarRow }) => {
                      const period = bar.payload?.period;
                      if (period) open(s.segment, period.from, period.to);
                    }}
                  />
                ))}
              </BarChart>
            </ChartContainer>
          ) : (
            <p className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              No customers in this range.
            </p>
          )}
        </section>

        <section aria-labelledby="share-chart-title" className="space-y-3">
          <h4 id="share-chart-title" className="text-sm font-medium">
            Share of bookings made by clients themselves
          </h4>
          {hasBookings ? (
            <ChartContainer
              config={shareConfig}
              className="aspect-auto h-48 w-full"
              role="img"
              aria-label="Line chart of the share of bookings made by clients online. The same numbers are in the table below."
            >
              <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 50, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tickLine={false}
                  axisLine={false}
                  width={44}
                />
                <ChartTooltip content={<ShareTooltip groupBy={groupBy} />} />
                <Line
                  dataKey="share"
                  stroke="var(--color-share)"
                  strokeWidth={2}
                  dot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--card))" }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ChartContainer>
          ) : (
            <p className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              No checked bookings in this range yet.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            By the date the booking was made. Website and hub bookings count as the client's own.
          </p>
        </section>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="group -ml-2 text-xs">
              <ChevronDown className="mr-1 h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
              Show the charts as a table
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="overflow-x-auto">
              <Table>
                <caption className="sr-only">New and returning customers by {groupBy}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{groupBy === "week" ? "Week of" : "Month"}</TableHead>
                    <TableHead scope="col">New</TableHead>
                    <TableHead scope="col">Self-booked</TableHead>
                    <TableHead scope="col">By the team</TableHead>
                    <TableHead scope="col">Not checked</TableHead>
                    <TableHead scope="col">Returning</TableHead>
                    <TableHead scope="col">Bookings by clients</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {series.map((point) => (
                    <TableRow key={point.period.key}>
                      <TableCell className="whitespace-nowrap">{describePeriod(point.period.key, groupBy)}</TableCell>
                      <TableCell className="tabular-nums">{point.new}</TableCell>
                      <TableCell className="tabular-nums">{point.newSelf}</TableCell>
                      <TableCell className="tabular-nums">{point.newStaff}</TableCell>
                      <TableCell className="tabular-nums">{point.newUnknown}</TableCell>
                      <TableCell className="tabular-nums">{point.returning}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {formatRate(point.selfBookingShare)} ({point.selfBookings}/{point.checkedBookings})
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
            {totals.excludedCustomers} customer{totals.excludedCustomers === 1 ? "" : "s"} without an email left
            out: their full session history can't be confirmed.
          </p>
        )}
      </CardContent>

      <CustomerListDialog request={list} onClose={() => setList(null)} />
    </Card>
  );
}
