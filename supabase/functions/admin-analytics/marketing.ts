// Pure logic for the admin Overview's "Marketing" tab
// (admin-analytics?action=marketing). Totals the per-day, per-channel rows
// from admin_marketing_daily() (marketing_daily, filled by marketing-sync from
// Google Ads, Meta and TikTok) and sets them against the new customers the
// Customers board counts. No Deno or network imports, so it runs under Vitest
// (marketing.test.ts) and its types are shared with the browser.
//
// Definitions:
//   - Spend, clicks, impressions and conversions are what each platform
//     reports. Conversions are the channel's own count, so channels overlap:
//     their sum can be more than the real number of new customers.
//   - CTR = clicks / impressions. Outbound CTR = outbound clicks /
//     impressions, only where the platform reports outbound clicks (Meta).
//   - Cost per conversion = a channel's spend / its own reported conversions.
//   - Cost per new customer (blended CAC) = spend across every channel / new
//     customers in the hub (first-ever session booked in the range, booking
//     date basis, same count as the Customers board). Customers with no email
//     are left out of that count, as on the board.
//   - Only spend in REPORTING_CURRENCY is added up. Any other currency is
//     kept apart and shown as a warning, never converted.

import { type CompareTo, type DateRange, type GroupBy, type Period, MAX_RANGE_DAYS, daysInRange, defaultGroupBy, isDate, periodStart, periodsInRange } from "./logic.ts";

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const CHANNELS = ["google", "meta", "tiktok"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  google: "Google Ads",
  meta: "Meta",
  tiktok: "TikTok",
};

/** The only currency added up; expected for all of Fettle's ad accounts. */
export const REPORTING_CURRENCY = "EUR";

const CHANNEL_SET: ReadonlySet<string> = new Set(CHANNELS);

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && CHANNEL_SET.has(value);
}

// ---------------------------------------------------------------------------
// Rows from admin_marketing_daily()
// ---------------------------------------------------------------------------

/** One channel's totals for one day in one currency. */
export interface MarketingDay {
  day: string;
  channel: Channel;
  currency: string;
  spend: number;
  impressions: number;
  clicks: number;
  /** Null when the platform doesn't report outbound clicks. */
  outboundClicks: number | null;
  conversions: number;
  conversionValue: number | null;
  campaigns: number;
}

/** Postgres numerics can arrive as numbers or numeric strings. */
function toNumber(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Reads the SQL's JSON arrays, skipping malformed rows. */
export function parseMarketingRows(raw: unknown): MarketingDay[] {
  if (!Array.isArray(raw)) return [];
  const rows: MarketingDay[] = [];
  for (const row of raw) {
    if (!Array.isArray(row)) continue;
    const [day, channel, currency, spend, impressions, clicks, outbound, conversions, value, campaigns] = row;
    if (!isDate(day) || !isChannel(channel) || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) continue;
    const numbers = [spend, impressions, clicks, conversions].map(toNumber);
    if (numbers.some((n) => n === null)) continue;
    rows.push({
      day,
      channel,
      currency,
      spend: numbers[0]!,
      impressions: numbers[1]!,
      clicks: numbers[2]!,
      outboundClicks: outbound === null ? null : toNumber(outbound),
      conversions: numbers[3]!,
      conversionValue: value === null ? null : toNumber(value),
      campaigns: toNumber(campaigns) ?? 0,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Sums and rates
// ---------------------------------------------------------------------------

interface Sums {
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  /** Null until a row reports it. */
  outboundClicks: number | null;
  /** Impressions on the rows that reported outbound clicks (oCTR's base). */
  outboundImpressions: number;
  conversionValue: number | null;
}

function emptySums(): Sums {
  return { spend: 0, impressions: 0, clicks: 0, conversions: 0, outboundClicks: null, outboundImpressions: 0, conversionValue: null };
}

function addDay(sums: Sums, day: MarketingDay) {
  sums.spend += day.spend;
  sums.impressions += day.impressions;
  sums.clicks += day.clicks;
  sums.conversions += day.conversions;
  if (day.outboundClicks !== null) {
    sums.outboundClicks = (sums.outboundClicks ?? 0) + day.outboundClicks;
    sums.outboundImpressions += day.impressions;
  }
  if (day.conversionValue !== null) sums.conversionValue = (sums.conversionValue ?? 0) + day.conversionValue;
}

/** a / b, or null when b is 0. */
export function ratio(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

/** Money to the cent, so float sums don't show as 1234.5600000001. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface ChannelTotals {
  channel: Channel;
  spend: number;
  impressions: number;
  clicks: number;
  outboundClicks: number | null;
  conversions: number;
  conversionValue: number | null;
  /** clicks / impressions. */
  ctr: number | null;
  /** outbound clicks / impressions; null where the platform has no such figure. */
  outboundCtr: number | null;
  /** spend / the channel's own conversions. */
  costPerConversion: number | null;
}

function channelTotals(channel: Channel, sums: Sums): ChannelTotals {
  return {
    channel,
    spend: cents(sums.spend),
    impressions: sums.impressions,
    clicks: sums.clicks,
    outboundClicks: sums.outboundClicks,
    conversions: cents(sums.conversions),
    conversionValue: sums.conversionValue === null ? null : cents(sums.conversionValue),
    ctr: ratio(sums.clicks, sums.impressions),
    outboundCtr: sums.outboundClicks === null ? null : ratio(sums.outboundClicks, sums.outboundImpressions),
    costPerConversion: ratio(sums.spend, sums.conversions),
  };
}

/** Spend in a currency other than REPORTING_CURRENCY, left out of every total. */
export interface OtherCurrencySpend {
  channel: Channel;
  currency: string;
  spend: number;
}

function inRange(day: string, range: DateRange): boolean {
  return day >= range.from && day <= range.to;
}

// ---------------------------------------------------------------------------
// Totals for a range
// ---------------------------------------------------------------------------

export interface MarketingTotals {
  spend: number;
  impressions: number;
  clicks: number;
  /** Sum of each channel's own count (channels overlap, see above). */
  conversions: number;
  /** New customers in the hub over the range (Customers board count). */
  newCustomers: number;
  /** spend / newCustomers. */
  costPerNewCustomer: number | null;
  /** spend / conversions. */
  costPerConversion: number | null;
  /** Every channel, in CHANNELS order, zeros where there's no data. */
  channels: ChannelTotals[];
  otherCurrencies: OtherCurrencySpend[];
}

export function marketingTotals(days: MarketingDay[], range: DateRange, newCustomers: number): MarketingTotals {
  const total = emptySums();
  const byChannel = new Map<Channel, Sums>(CHANNELS.map((c) => [c, emptySums()]));
  const other = new Map<string, OtherCurrencySpend>();

  for (const day of days) {
    if (!inRange(day.day, range)) continue;
    if (day.currency !== REPORTING_CURRENCY) {
      const key = `${day.channel}:${day.currency}`;
      const entry = other.get(key) ?? { channel: day.channel, currency: day.currency, spend: 0 };
      entry.spend += day.spend;
      other.set(key, entry);
      continue;
    }
    addDay(total, day);
    addDay(byChannel.get(day.channel)!, day);
  }

  return {
    spend: cents(total.spend),
    impressions: total.impressions,
    clicks: total.clicks,
    conversions: cents(total.conversions),
    newCustomers,
    costPerNewCustomer: ratio(total.spend, newCustomers),
    costPerConversion: ratio(total.spend, total.conversions),
    channels: CHANNELS.map((c) => channelTotals(c, byChannel.get(c)!)),
    otherCurrencies: [...other.values()]
      .filter((o) => o.spend > 0)
      .map((o) => ({ ...o, spend: cents(o.spend) }))
      .sort((a, b) => CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel) || a.currency.localeCompare(b.currency)),
  };
}

// ---------------------------------------------------------------------------
// Per week or month
// ---------------------------------------------------------------------------

export interface MarketingPoint {
  period: Period;
  spendByChannel: Record<Channel, number>;
  conversionsByChannel: Record<Channel, number>;
  spend: number;
  newCustomers: number;
  costPerNewCustomer: number | null;
}

function zeroByChannel(): Record<Channel, number> {
  return { google: 0, meta: 0, tiktok: 0 };
}

/**
 * Spend and conversions per channel for each week or month, with that
 * period's cost per new customer. `newCustomersByPeriod` is keyed by period
 * key (customerSeries' period.key); a missing key counts as 0.
 */
export function marketingSeries(
  days: MarketingDay[],
  range: DateRange,
  groupBy: GroupBy,
  newCustomersByPeriod: ReadonlyMap<string, number>
): MarketingPoint[] {
  const points = new Map<string, MarketingPoint>(
    periodsInRange(range, groupBy).map((period) => [
      period.key,
      {
        period,
        spendByChannel: zeroByChannel(),
        conversionsByChannel: zeroByChannel(),
        spend: 0,
        newCustomers: newCustomersByPeriod.get(period.key) ?? 0,
        costPerNewCustomer: null,
      },
    ])
  );

  for (const day of days) {
    if (day.currency !== REPORTING_CURRENCY || !inRange(day.day, range)) continue;
    const point = points.get(periodStart(day.day, groupBy));
    if (!point) continue;
    point.spendByChannel[day.channel] += day.spend;
    point.conversionsByChannel[day.channel] += day.conversions;
    point.spend += day.spend;
  }

  return [...points.values()].map((point) => {
    const spendByChannel = zeroByChannel();
    const conversionsByChannel = zeroByChannel();
    for (const c of CHANNELS) {
      spendByChannel[c] = cents(point.spendByChannel[c]);
      conversionsByChannel[c] = cents(point.conversionsByChannel[c]);
    }
    return {
      ...point,
      spendByChannel,
      conversionsByChannel,
      spend: cents(point.spend),
      costPerNewCustomer: ratio(point.spend, point.newCustomers),
    };
  });
}

// ---------------------------------------------------------------------------
// Connection state (marketing_sync_state)
// ---------------------------------------------------------------------------

export interface ChannelStatus {
  channel: Channel;
  /** At least one successful sync; otherwise the tab says "Not connected yet". */
  connected: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  /** Last run's error, if that run failed (cleared on success). */
  lastError: string | null;
  /** Earliest day copied so far. */
  historyFrom: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** One status per channel, in CHANNELS order, from marketing_sync_state rows. */
export function parseSyncState(raw: unknown): ChannelStatus[] {
  const rows = new Map<Channel, Record<string, unknown>>();
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (row && typeof row === "object" && isChannel((row as Record<string, unknown>).channel)) {
        rows.set((row as { channel: Channel }).channel, row as Record<string, unknown>);
      }
    }
  }
  return CHANNELS.map((channel) => {
    const row = rows.get(channel);
    const lastSuccessAt = text(row?.last_success_at);
    const historyFrom = row?.history_from;
    return {
      channel,
      connected: lastSuccessAt !== null,
      lastSuccessAt,
      lastAttemptAt: text(row?.last_attempt_at),
      lastError: text(row?.last_error),
      historyFrom: isDate(historyFrom) ? historyFrom : null,
    };
  });
}

/**
 * Connected channels whose copied history starts after the range does, so
 * their spend for the start of the range is missing (and cost per new
 * customer reads too low).
 */
export function channelsMissingStart(statuses: ChannelStatus[], range: DateRange): Channel[] {
  return statuses.filter((s) => s.connected && s.historyFrom !== null && s.historyFrom > range.from).map((s) => s.channel);
}

// ---------------------------------------------------------------------------
// The whole response
// ---------------------------------------------------------------------------

export interface MarketingReportInput {
  params: MarketingParams;
  compareRange: DateRange;
  /** Rows covering both the range and the comparison range. */
  days: MarketingDay[];
  statuses: ChannelStatus[];
  newCustomers: number;
  compareNewCustomers: number;
  newCustomersByPeriod: ReadonlyMap<string, number>;
}

export interface MarketingReport {
  params: MarketingParams & { compareRange: DateRange };
  channels: ChannelStatus[];
  /** Connected channels whose history starts after the range does. */
  missingStart: Channel[];
  /** Same for the comparison range. */
  compareMissingStart: Channel[];
  totals: MarketingTotals;
  compare: MarketingTotals;
  series: MarketingPoint[];
}

export function marketingReport(input: MarketingReportInput): MarketingReport {
  const { params, compareRange, days, statuses } = input;
  return {
    params: { ...params, compareRange },
    channels: statuses,
    missingStart: channelsMissingStart(statuses, params.range),
    compareMissingStart: channelsMissingStart(statuses, compareRange),
    totals: marketingTotals(days, params.range, input.newCustomers),
    compare: marketingTotals(days, compareRange, input.compareNewCustomers),
    series: marketingSeries(days, params.range, params.groupBy, input.newCustomersByPeriod),
  };
}

/** One SQL call covers both ranges: from the earlier start to the later end. */
export function spanningRange(a: DateRange, b: DateRange): DateRange {
  return { from: a.from < b.from ? a.from : b.from, to: a.to > b.to ? a.to : b.to };
}

// ---------------------------------------------------------------------------
// Query string
// ---------------------------------------------------------------------------

export interface MarketingParams {
  range: DateRange;
  groupBy: GroupBy;
  compareTo: CompareTo;
}

/** Reads and checks ?action=marketing's query string. Returns an error message when invalid. */
export function parseMarketingParams(search: URLSearchParams): MarketingParams | string {
  const from = search.get("from");
  const to = search.get("to");
  if (!isDate(from) || !isDate(to) || from > to) return "from and to must be dates, from first";
  const range = { from, to };
  if (daysInRange(range) > MAX_RANGE_DAYS) return "The date range can be at most three years";
  const groupBy = search.get("group") ?? defaultGroupBy(range);
  if (groupBy !== "week" && groupBy !== "month") return "group must be week or month";
  const compareTo = search.get("compare") ?? "previous";
  if (compareTo !== "previous" && compareTo !== "year") return "compare must be previous or year";
  return { range, groupBy, compareTo };
}
