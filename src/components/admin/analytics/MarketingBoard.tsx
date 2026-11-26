import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { AlertCircle, ChevronDown, Info, Loader2, Megaphone, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAdminMarketing } from "@/hooks/useAdmin";
import {
  type BoardComparison,
  comparisonLabel,
  describePeriod,
  formatCountChange,
  formatFullDay,
  formatPeriod,
  formatRange,
  isPartialPeriod,
} from "@/lib/adminAnalytics";
import {
  type MarketingResponse,
  costTone,
  formatConversions,
  formatCtr,
  formatForeignMoney,
  formatMoney,
  formatMoneyChange,
  formatSynced,
  marketingQuery,
} from "@/lib/adminMarketing";
import {
  type Channel,
  type ChannelStatus,
  type MarketingPoint,
  CHANNELS,
  CHANNEL_LABELS,
  VAT_RATE,
} from "../../../../supabase/functions/admin-analytics/marketing.ts";
import type { DateRange, GroupBy } from "../../../../supabase/functions/admin-analytics/logic.ts";

const VAT_PERCENT = Math.round(VAT_RATE * 100);

/** Spend inc. VAT; worked out here too while admin-analytics predates the field. */
function spendIncVat(figures: { spend: number; spendIncVat?: number }): number {
  return figures.spendIncVat ?? Math.round(figures.spend * (1 + VAT_RATE) * 100) / 100;
}
import { SERIES_COLORS, toneOf } from "./chartStyle";
import { MetricTile, StaticLegend, TooltipBox } from "./parts";

const PARTIAL_OPACITY = 0.4;

const CHANNEL_COLORS: Record<Channel, string> = {
  google: SERIES_COLORS[0],
  meta: SERIES_COLORS[1],
  tiktok: SERIES_COLORS[2],
};

const chartConfig: ChartConfig = Object.fromEntries(
  CHANNELS.map((c) => [c, { label: CHANNEL_LABELS[c], color: CHANNEL_COLORS[c] }])
);

function listChannels(channels: Channel[]): string {
  const names = channels.map((c) => CHANNEL_LABELS[c]);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function SpendTooltip({
  active,
  payload,
  groupBy,
  channels,
}: {
  active?: boolean;
  payload?: { payload: MarketingPoint }[];
  groupBy: GroupBy;
  channels: Channel[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <TooltipBox title={describePeriod(p.period.key, groupBy)}>
      {channels.map((c) => (
        <div key={c} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[c] }} aria-hidden />
            {CHANNEL_LABELS[c]}
          </span>
          <span className="font-medium tabular-nums text-foreground">{formatMoney(p.spendByChannel[c])}</span>
        </div>
      ))}
      <p className="text-muted-foreground">
        {p.newCustomers} new customer{p.newCustomers === 1 ? "" : "s"} · {formatMoney(p.costPerNewCustomer)} each
      </p>
    </TooltipBox>
  );
}

function MarketingSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading the marketing figures">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function StatusCell({ status }: { status: ChannelStatus }) {
  if (!status.connected) {
    return (
      <span className="text-muted-foreground">
        Not connected yet
        {status.lastError && <span className="block text-xs text-destructive">Last try failed: {status.lastError}</span>}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      Synced {formatSynced(status.lastSuccessAt!)}
      {status.lastError && <span className="block text-xs text-destructive">Latest sync failed: {status.lastError}</span>}
    </span>
  );
}

/**
 * With `allChannels` false (once something is connected), channels that were
 * never set up are left out of the table and named in one line below it, so
 * a channel on hold (TikTok) doesn't add an empty row. A channel whose first
 * sync failed stays in, so its error shows.
 */
function ChannelTable({ data, allChannels }: { data: MarketingResponse; allChannels: boolean }) {
  const { totals } = data;
  const status = new Map(data.channels.map((s) => [s.channel, s]));
  const shown = (c: Channel) => allChannels || status.get(c)!.connected || status.get(c)!.lastError !== null;
  const hidden = totals.channels.map((c) => c.channel).filter((c) => !shown(c));
  return (
    <section aria-labelledby="marketing-channels-title" className="space-y-2">
      <h4 id="marketing-channels-title" className="text-sm font-medium">
        By channel
      </h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Channel</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Conversions</TableHead>
            <TableHead className="text-right">Cost per conversion</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">Outbound CTR</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals.channels.filter((c) => shown(c.channel)).map((c) => {
            const s = status.get(c.channel)!;
            const off = !s.connected;
            return (
              <TableRow key={c.channel}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHANNEL_COLORS[c.channel] }} aria-hidden />
                    {CHANNEL_LABELS[c.channel]}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{off ? "–" : formatMoney(c.spend)}</TableCell>
                <TableCell className="text-right tabular-nums">{off ? "–" : formatConversions(c.conversions)}</TableCell>
                <TableCell className="text-right tabular-nums">{off ? "–" : formatMoney(c.costPerConversion)}</TableCell>
                <TableCell className="text-right tabular-nums">{off ? "–" : formatCtr(c.ctr)}</TableCell>
                <TableCell className="text-right tabular-nums">{off ? "–" : formatCtr(c.outboundCtr)}</TableCell>
                <TableCell>
                  <StatusCell status={s} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>All channels</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(totals.spend)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatConversions(totals.conversions)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(totals.costPerConversion)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCtr(totals.impressions > 0 ? totals.clicks / totals.impressions : null)}
            </TableCell>
            <TableCell />
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
      {hidden.length > 0 && <p className="text-xs text-muted-foreground">Not connected: {listChannels(hidden)}.</p>}
      <p className="text-xs text-muted-foreground">
        Conversions are each channel's own count, so the same customer can be counted by more than one channel and
        the total can be higher than the real number of new customers. Outbound CTR is clicks that leave the platform
        for the website; only Meta reports it, so other channels show n/a.
      </p>
    </section>
  );
}

function SpendChart({ data }: { data: MarketingResponse }) {
  const [showTable, setShowTable] = useState(false);
  const groupBy = data.params.groupBy;
  const connected = data.channels.filter((s) => s.connected).map((s) => s.channel);
  const rows = data.series.map((p) => ({
    ...p,
    ...p.spendByChannel,
    label: formatPeriod(p.period.key, groupBy),
    partial: isPartialPeriod(p.period, groupBy),
  }));
  const hasSpend = data.series.some((p) => p.spend > 0);
  const hasPartial = rows.some((r) => r.partial);

  return (
    <section aria-labelledby="marketing-chart-title" className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h4 id="marketing-chart-title" className="text-sm font-medium">
          Spend by {groupBy}
        </h4>
        <StaticLegend items={connected.map((c) => ({ label: CHANNEL_LABELS[c], color: CHANNEL_COLORS[c] }))} />
      </div>
      {hasSpend ? (
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-64 w-full"
          role="img"
          aria-label="Stacked bar chart of ad spend per channel over time. The same numbers are in the table below."
        >
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatMoney(v)} />
            <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<SpendTooltip groupBy={groupBy} channels={connected} />} />
            {connected.map((c, i) => (
              <Bar
                key={c}
                dataKey={c}
                stackId="spend"
                fill={`var(--color-${c})`}
                stroke="hsl(var(--card))"
                strokeWidth={1}
                radius={i === connected.length - 1 ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
              >
                {rows.map((row) => (
                  <Cell key={row.period.key} fillOpacity={row.partial ? PARTIAL_OPACITY : 1} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ChartContainer>
      ) : (
        <p className="rounded-lg bg-muted/40 p-6 text-center text-sm text-muted-foreground">No ad spend in this range.</p>
      )}
      {hasPartial && hasSpend && (
        <p className="text-xs text-muted-foreground">
          Faded bars cover a {groupBy} only partly inside the range, so they count fewer days.
        </p>
      )}
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
                <TableHead>{groupBy === "week" ? "Week of" : "Month"}</TableHead>
                {connected.map((c) => (
                  <TableHead key={c} className="text-right">
                    {CHANNEL_LABELS[c]}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total spend</TableHead>
                <TableHead className="text-right">Spend inc. VAT</TableHead>
                <TableHead className="text-right">New customers</TableHead>
                <TableHead className="text-right">Cost per new customer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.series.map((p) => (
                <TableRow key={p.period.key}>
                  <TableCell>{groupBy === "week" ? formatFullDay(p.period.key) : describePeriod(p.period.key, groupBy)}</TableCell>
                  {connected.map((c) => (
                    <TableCell key={c} className="text-right tabular-nums">
                      {formatMoney(p.spendByChannel[c])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{formatMoney(p.spend)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(spendIncVat(p))}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.newCustomers}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(p.costPerNewCustomer)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

function MarketingContent({ data, compareLabel }: { data: MarketingResponse; compareLabel: string | null }) {
  const { totals, compare } = data;
  const vs = (change: string | null) => (change && compareLabel ? `${change} vs ${compareLabel}` : null);
  const connected = data.channels.filter((s) => s.connected);

  if (connected.length === 0) {
    return (
      <div className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>No ad accounts connected yet</AlertTitle>
          <AlertDescription>
            Spend, conversions and cost per new customer appear here once Google Ads, Meta or TikTok is linked. Each
            channel shows up as soon as its first sync finishes.
          </AlertDescription>
        </Alert>
        <ChannelTable data={data} allChannels />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.missingStart.length > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Some spend before this range is missing</AlertTitle>
          <AlertDescription>
            {data.missingStart.map((c) => {
              const from = data.channels.find((s) => s.channel === c)?.historyFrom;
              return (
                <span key={c} className="block">
                  {CHANNEL_LABELS[c]} figures start on {from ? formatFullDay(from) : "a later date"}.
                </span>
              );
            })}
            Until then the spend is too low, and so is the cost per new customer.
          </AlertDescription>
        </Alert>
      )}
      {totals.otherCurrencies.length > 0 && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Spend in another currency left out</AlertTitle>
          <AlertDescription>
            {totals.otherCurrencies.map((o) => `${CHANNEL_LABELS[o.channel]}: ${formatForeignMoney(o.spend, o.currency)}`).join(" · ")}.
            Only euro spend is added up; nothing is converted.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <MetricTile
          label="Ad spend"
          value={formatMoney(totals.spend)}
          change={vs(formatMoneyChange(totals.spend, compare.spend))}
          detail={`Across ${listChannels(connected.map((s) => s.channel))}, before VAT`}
        />
        <MetricTile
          label="Ad spend (inc. VAT)"
          value={formatMoney(spendIncVat(totals))}
          change={vs(formatMoneyChange(spendIncVat(totals), spendIncVat(compare)))}
          detail={`Ad spend + ${VAT_PERCENT}% VAT`}
        />
        <MetricTile
          label="Cost per new customer"
          value={formatMoney(totals.costPerNewCustomer)}
          change={vs(formatMoneyChange(totals.costPerNewCustomer, compare.costPerNewCustomer))}
          tone={costTone(totals.costPerNewCustomer, compare.costPerNewCustomer)}
          detail="Ad spend inc. VAT ÷ new customers"
        />
        <MetricTile
          label="New customers"
          value={String(totals.newCustomers)}
          change={vs(formatCountChange(totals.newCustomers, compare.newCustomers))}
          tone={toneOf(totals.newCustomers - compare.newCustomers)}
          detail="First-ever session booked in the range, from any source"
        />
        <MetricTile
          label="Conversions (reported by channels)"
          value={formatConversions(totals.conversions)}
          change={vs(formatCountChange(Math.round(totals.conversions), Math.round(compare.conversions)))}
          tone={toneOf(totals.conversions - compare.conversions)}
          detail={`${formatMoney(totals.costPerConversion)} per conversion`}
        />
      </div>
      {compareLabel && data.compareMissingStart.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {listChannels(data.compareMissingStart)} figures don't go back to the whole comparison period, so the changes
          above are bigger than they really are.
        </p>
      )}

      <ChannelTable data={data} allChannels={false} />
      <SpendChart data={data} />

      <p className="text-xs text-muted-foreground">
        Spend, clicks and conversions are what each platform reports, updated every few hours; the platforms keep
        adjusting the last few weeks, so recent days can still change. Cost per new customer sets all ad spend, plus
        {VAT_PERCENT}% VAT, against every new customer in the hub, including those who came through word of mouth or
        search. Cost per conversion uses spend before VAT, as the platforms show it.
      </p>
    </div>
  );
}

/** The Overview's Marketing tab: ad spend and results from Google Ads, Meta and TikTok. */
export function MarketingBoard({
  range,
  groupBy,
  compare,
}: {
  range: DateRange;
  groupBy: GroupBy;
  /** The comparison period; null when compare is off. */
  compare: BoardComparison;
}) {
  const query = useAdminMarketing(marketingQuery(range, groupBy, compare));
  const compareLabel = comparisonLabel(compare);
  const { error, isPending, isFetching, refetch } = query;
  // An admin-analytics deployed before this tab ignores action=marketing and
  // answers with the other boards' numbers; show that instead of crashing.
  const outdated = query.data !== undefined && !Array.isArray((query.data as Partial<MarketingResponse>).channels);
  const data = outdated ? undefined : query.data;

  return (
    <Card className="border-border/50">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-4 w-4 text-primary" aria-hidden />
          Marketing
        </CardTitle>
        <CardDescription>
          Ad spend and results from Google Ads, Meta and TikTok, and what each new customer costs in ads.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
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
            <AlertTitle>The Marketing tab isn't switched on yet</AlertTitle>
            <AlertDescription>
              The server side of this tab hasn't been deployed. It will show figures once the latest admin-analytics
              function is live.
            </AlertDescription>
          </Alert>
        ) : isPending ? (
          <MarketingSkeleton />
        ) : error && !data ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Couldn't load the marketing figures</AlertTitle>
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
            <MarketingContent data={data} compareLabel={compareLabel} />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
