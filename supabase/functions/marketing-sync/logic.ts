// Pure logic for the marketing-sync edge function: which channels are set
// up, which days to pull, the platform requests, and turning each platform's
// report into marketing_daily rows. No Deno or network imports, so it runs
// under Vitest (logic.test.ts).
//
// Platforms (versions checked 25 Nov 2026; each can be overridden by a secret):
//   Meta      Marketing API v25.0, GET act_<id>/insights, level=campaign,
//             time_increment=1. outbound_clicks and actions come back as
//             [{action_type, value}] lists; a missing list means 0.
//             Conversions = purchases + leads (META_CONVERSION_GROUPS).
//   Google    Google Ads API v26, googleAds:searchStream with GAQL. Money is
//             in micros; int64s come back as strings; zero metrics are left
//             out of the JSON.
//   TikTok    Business API v1.3, GET report/integrated/get/, report_type
//             BASIC, data_level AUCTION_CAMPAIGN. With stat_time_day the range
//             can be at most 30 days, so longer ranges are split.

import { addDays } from "../admin-customer-insights/logic.ts";
import { type Channel, CHANNELS } from "../admin-analytics/marketing.ts";
import { type DateRange, isDate } from "../admin-analytics/logic.ts";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DEFAULT_META_API_VERSION = "v25.0";
export const DEFAULT_GOOGLE_ADS_API_VERSION = "v26";
export const TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

/**
 * What counts as a Meta conversion (Fettle, 25 Nov 2026): purchases plus
 * leads. Each group is counted once, from the first action type Meta reports
 * for it: `purchase` already includes the pixel's
 * offsite_conversion.fb_pixel_purchase (and `lead` the pixel lead), so
 * adding them together would count most conversions twice.
 */
export const META_CONVERSION_GROUPS: readonly (readonly string[])[] = [
  ["purchase", "offsite_conversion.fb_pixel_purchase"],
  ["lead", "offsite_conversion.fb_pixel_lead"],
];
/** Conversion value: purchases only (leads carry no money). */
export const META_VALUE_GROUP = META_CONVERSION_GROUPS[0];
/** TikTok's Complete Payment + Complete Registration web events, added together. */
export const DEFAULT_TIKTOK_CONVERSION_METRICS = ["complete_payment", "user_registration"];

/** Days re-pulled on every run: platforms keep revising recent conversions. */
export const REFRESH_DAYS = 28;
/** Days of older history copied per run until HISTORY_START is reached. */
export const BACKFILL_CHUNK_DAYS = 90;
/** How far back history goes: a year before the boards' TRACKING_START
 *  (29 Jul 2026), so "same period last year" has figures to compare with. */
export const HISTORY_START = "2025-07-01";
/** TikTok's limit for daily reports. */
export const TIKTOK_MAX_DAYS = 30;

export interface MetaConfig {
  channel: "meta";
  accessToken: string;
  /** With the act_ prefix; one or more ad accounts. */
  accountIds: string[];
  apiVersion: string;
}

export interface GoogleConfig {
  channel: "google";
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Digits only; one or more Ads accounts. */
  customerIds: string[];
  /** The manager (MCC) account the access comes through, digits only. */
  loginCustomerId: string | null;
  apiVersion: string;
}

export interface TikTokConfig {
  channel: "tiktok";
  accessToken: string;
  advertiserId: string;
  /** Report metrics added together as conversions. */
  conversionMetrics: string[];
  /** Set to skip looking the account's currency up. */
  currency: string | null;
}

export type ChannelConfig = MetaConfig | GoogleConfig | TikTokConfig;

type Env = (name: string) => string | undefined;

const read = (env: Env, name: string) => env(name)?.trim() || null;
const digits = (value: string) => value.replace(/\D/g, "");

/** A comma-separated list of account IDs: digits only, no blanks or repeats. */
function idList(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map(digits).filter(Boolean))];
}

/** A comma-separated list of names, trimmed, no blanks or repeats. */
function nameList(value: string | null): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((v) => v.trim()).filter(Boolean))];
}

/**
 * The channel's settings from the function's secrets, or null when any
 * required one is missing (the channel is skipped, not an error).
 */
export function channelConfig(channel: Channel, env: Env): ChannelConfig | null {
  if (channel === "meta") {
    const accessToken = read(env, "META_ACCESS_TOKEN");
    const accounts = idList(read(env, "META_AD_ACCOUNT_ID"));
    if (!accessToken || accounts.length === 0) return null;
    return {
      channel,
      accessToken,
      accountIds: accounts.map((id) => `act_${id}`),
      apiVersion: read(env, "META_API_VERSION") ?? DEFAULT_META_API_VERSION,
    };
  }
  if (channel === "google") {
    const developerToken = read(env, "GOOGLE_ADS_DEVELOPER_TOKEN");
    const clientId = read(env, "GOOGLE_ADS_CLIENT_ID");
    const clientSecret = read(env, "GOOGLE_ADS_CLIENT_SECRET");
    const refreshToken = read(env, "GOOGLE_ADS_REFRESH_TOKEN");
    const customers = idList(read(env, "GOOGLE_ADS_CUSTOMER_ID"));
    if (!developerToken || !clientId || !clientSecret || !refreshToken || customers.length === 0) return null;
    const login = read(env, "GOOGLE_ADS_LOGIN_CUSTOMER_ID");
    return {
      channel,
      developerToken,
      clientId,
      clientSecret,
      refreshToken,
      customerIds: customers,
      loginCustomerId: login && digits(login) ? digits(login) : null,
      apiVersion: read(env, "GOOGLE_ADS_API_VERSION") ?? DEFAULT_GOOGLE_ADS_API_VERSION,
    };
  }
  const accessToken = read(env, "TIKTOK_ACCESS_TOKEN");
  const advertiserId = read(env, "TIKTOK_ADVERTISER_ID");
  if (!accessToken || !advertiserId || !digits(advertiserId)) return null;
  const currency = read(env, "TIKTOK_CURRENCY")?.toUpperCase() ?? null;
  return {
    channel,
    accessToken,
    advertiserId: digits(advertiserId),
    conversionMetrics: (() => {
      const metrics = nameList(read(env, "TIKTOK_CONVERSION_METRIC"));
      return metrics.length > 0 ? metrics : [...DEFAULT_TIKTOK_CONVERSION_METRICS];
    })(),
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}

/** Every secret value in a config, so error messages can be scrubbed of them. */
export function secretsOf(config: ChannelConfig): string[] {
  if (config.channel === "meta") return [config.accessToken];
  if (config.channel === "google") return [config.developerToken, config.clientSecret, config.refreshToken];
  return [config.accessToken];
}

/** A short error message safe to store and log: no secrets, at most 300 characters. */
export function safeError(message: string, secrets: string[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret.length >= 6) out = out.split(secret).join("[hidden]");
  }
  // Tokens passed in URLs (Meta's paging links) never reach the message.
  out = out.replace(/access_token=[^&\s"]+/gi, "access_token=[hidden]");
  return out.length > 300 ? `${out.slice(0, 297)}...` : out;
}

/** The accounts a channel pulls, as stored in marketing_daily.account_id. */
export function accountIdsOf(config: ChannelConfig): string[] {
  if (config.channel === "meta") return config.accountIds;
  if (config.channel === "google") return config.customerIds;
  return [config.advertiserId];
}

export function isKnownChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Which days to pull
// ---------------------------------------------------------------------------

export interface SyncPlan {
  /** The recent days re-pulled every run. */
  refresh: DateRange;
  /** One chunk of older history, newest first, until HISTORY_START. */
  backfill: DateRange | null;
  /** history_from after this run, if it succeeds. */
  historyFrom: string;
}

/**
 * `today` is the Dublin date; `historyFrom` the earliest day copied so far
 * (null before the first successful run).
 */
export function syncPlan(today: string, historyFrom: string | null): SyncPlan {
  const refresh = { from: addDays(today, -(REFRESH_DAYS - 1)), to: today };
  const copiedFrom = historyFrom !== null && historyFrom < refresh.from ? historyFrom : refresh.from;
  if (copiedFrom <= HISTORY_START) return { refresh, backfill: null, historyFrom: copiedFrom };
  const to = addDays(copiedFrom, -1);
  const chunkFrom = addDays(copiedFrom, -BACKFILL_CHUNK_DAYS);
  const from = chunkFrom < HISTORY_START ? HISTORY_START : chunkFrom;
  return { refresh, backfill: { from, to }, historyFrom: from };
}

/** Splits a range into pieces of at most `maxDays`, oldest first. */
export function splitRange(range: DateRange, maxDays: number): DateRange[] {
  const parts: DateRange[] = [];
  for (let from = range.from; from <= range.to; from = addDays(from, maxDays)) {
    const end = addDays(from, maxDays - 1);
    parts.push({ from, to: end < range.to ? end : range.to });
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Rows for marketing_daily
// ---------------------------------------------------------------------------

export interface MarketingRow {
  channel: Channel;
  account_id: string;
  campaign_id: string;
  campaign_name: string | null;
  day: string;
  currency: string;
  spend: number;
  impressions: number;
  clicks: number;
  outbound_clicks: number | null;
  conversions: number;
  conversion_value: number | null;
}

/** A number from a platform (numbers or numeric strings); missing = 0. */
function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}


const round2 = (n: number) => Math.round(n * 100) / 100;

function str(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function currencyOf(value: unknown): string | null {
  const c = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(c) ? c : null;
}

function name(value: unknown): string | null {
  const s = str(value);
  return s === null ? null : s.slice(0, 300);
}

/** Rows for the same campaign and day (e.g. split across pages) added together. */
export function mergeRows(rows: MarketingRow[]): MarketingRow[] {
  const byKey = new Map<string, MarketingRow>();
  for (const row of rows) {
    const key = `${row.channel}|${row.account_id}|${row.campaign_id}|${row.day}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...row });
      continue;
    }
    existing.spend = round2(existing.spend + row.spend);
    existing.impressions += row.impressions;
    existing.clicks += row.clicks;
    existing.conversions = round2(existing.conversions + row.conversions);
    if (row.outbound_clicks !== null) existing.outbound_clicks = (existing.outbound_clicks ?? 0) + row.outbound_clicks;
    if (row.conversion_value !== null) existing.conversion_value = round2((existing.conversion_value ?? 0) + row.conversion_value);
    existing.campaign_name ??= row.campaign_name;
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const META_FIELDS = [
  "campaign_id",
  "campaign_name",
  "account_currency",
  "spend",
  "impressions",
  "clicks",
  "outbound_clicks",
  "actions",
  "action_values",
];

/** The first page's URL. Later pages come from the response's paging.next. */
export function metaInsightsUrl(config: MetaConfig, accountId: string, range: DateRange): string {
  const params = new URLSearchParams({
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since: range.from, until: range.to }),
    fields: META_FIELDS.join(","),
    // Conversions counted the way each campaign's own setting says, as in Ads Manager.
    use_unified_attribution_setting: "true",
    limit: "500",
    access_token: config.accessToken,
  });
  return `https://graph.facebook.com/${config.apiVersion}/${accountId}/insights?${params}`;
}

/** The value of one action_type in a Meta [{action_type, value}] list. */
function actionValue(list: unknown, actionType: string): number | null {
  if (!Array.isArray(list)) return null;
  let total: number | null = null;
  for (const item of list) {
    if (item && typeof item === "object" && (item as { action_type?: unknown }).action_type === actionType) {
      total = (total ?? 0) + num((item as { value?: unknown }).value);
    }
  }
  return total;
}

/**
 * A group's count: the first of its action types Meta reported, or null when
 * none of them was (Meta leaves out action types with nothing to report).
 */
function groupValue(list: unknown, group: readonly string[]): number | null {
  for (const actionType of group) {
    const value = actionValue(list, actionType);
    if (value !== null) return value;
  }
  return null;
}

/** Purchases + leads, each counted once (META_CONVERSION_GROUPS). */
export function metaConversions(actions: unknown): number {
  return META_CONVERSION_GROUPS.reduce((total, group) => total + (groupValue(actions, group) ?? 0), 0);
}

export interface MetaPage {
  rows: MarketingRow[];
  /** paging.next, or null on the last page. */
  next: string | null;
}

export function parseMetaPage(body: unknown, accountId: string): MetaPage {
  const data = (body as { data?: unknown })?.data;
  const next = str((body as { paging?: { next?: unknown } })?.paging?.next);
  const rows: MarketingRow[] = [];
  if (Array.isArray(data)) {
    for (const item of data as Record<string, unknown>[]) {
      const day = item?.date_start;
      const campaignId = str(item?.campaign_id);
      const currency = currencyOf(item?.account_currency);
      if (!isDate(day) || !campaignId || !currency) continue;
      rows.push({
        channel: "meta",
        account_id: accountId,
        campaign_id: campaignId,
        campaign_name: name(item.campaign_name),
        day,
        currency,
        spend: round2(num(item.spend)),
        impressions: Math.round(num(item.impressions)),
        clicks: Math.round(num(item.clicks)),
        // Meta leaves the list out when there were none.
        outbound_clicks: Math.round(actionValue(item.outbound_clicks, "outbound_click") ?? 0),
        conversions: round2(metaConversions(item.actions)),
        conversion_value: (() => {
          const v = groupValue(item.action_values, META_VALUE_GROUP);
          return v === null ? null : round2(v);
        })(),
      });
    }
  }
  return { rows, next };
}

/** Meta's error body: {error: {message, code}}. */
export function metaError(body: unknown): string | null {
  const error = (body as { error?: { message?: unknown; code?: unknown } })?.error;
  if (!error) return null;
  return `Meta: ${str(error.message) ?? "unknown error"}${error.code !== undefined ? ` (code ${String(error.code)})` : ""}`;
}

// ---------------------------------------------------------------------------
// Google Ads
// ---------------------------------------------------------------------------

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Form body for swapping the refresh token for an access token. */
export function googleTokenBody(config: GoogleConfig): URLSearchParams {
  return new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
  });
}

export function googleSearchUrl(config: GoogleConfig, customerId: string): string {
  return `https://googleads.googleapis.com/${config.apiVersion}/customers/${customerId}/googleAds:searchStream`;
}

export function googleHeaders(config: GoogleConfig, accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": config.developerToken,
    "Content-Type": "application/json",
  };
  if (config.loginCustomerId) headers["login-customer-id"] = config.loginCustomerId;
  return headers;
}

/** GAQL for daily campaign figures. metrics.conversions = the account's primary conversion actions. */
export function googleQuery(range: DateRange): string {
  return [
    "SELECT campaign.id, campaign.name, customer.currency_code, segments.date,",
    "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value",
    "FROM campaign",
    `WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'`,
  ].join(" ");
}

/** searchStream's body: an array of batches, each with results. */
export function parseGoogleStream(body: unknown, customerId: string): MarketingRow[] {
  const batches = Array.isArray(body) ? body : [body];
  const rows: MarketingRow[] = [];
  for (const batch of batches) {
    const results = (batch as { results?: unknown })?.results;
    if (!Array.isArray(results)) continue;
    for (const result of results as Record<string, Record<string, unknown> | undefined>[]) {
      const day = result?.segments?.date;
      const campaignId = str(result?.campaign?.id);
      const currency = currencyOf(result?.customer?.currencyCode);
      if (!isDate(day) || !campaignId || !currency) continue;
      const metrics = result.metrics ?? {};
      rows.push({
        channel: "google",
        account_id: customerId,
        campaign_id: campaignId,
        campaign_name: name(result.campaign?.name),
        day,
        currency,
        spend: round2(num(metrics.costMicros) / 1_000_000),
        impressions: Math.round(num(metrics.impressions)),
        clicks: Math.round(num(metrics.clicks)),
        outbound_clicks: null,
        conversions: round2(num(metrics.conversions)),
        conversion_value: round2(num(metrics.conversionsValue)),
      });
    }
  }
  return rows;
}

/** Google's error body: {error: {message, status}} or [{error: …}] from searchStream. */
export function googleError(body: unknown): string | null {
  const first = Array.isArray(body) ? body[0] : body;
  const error = (first as { error?: { message?: unknown; status?: unknown; details?: unknown } })?.error;
  if (!error) return null;
  // The useful reason is often deeper: details[].errors[].message.
  let detail: string | null = null;
  if (Array.isArray(error.details)) {
    for (const d of error.details as { errors?: { message?: unknown }[] }[]) {
      const message = Array.isArray(d?.errors) ? str(d.errors[0]?.message) : null;
      if (message) {
        detail = message;
        break;
      }
    }
  }
  const status = str(error.status);
  return `Google Ads: ${detail ?? str(error.message) ?? "unknown error"}${status ? ` (${status})` : ""}`;
}

/** The OAuth error body: {error, error_description}. */
export function googleTokenError(body: unknown): string {
  const b = body as { error?: unknown; error_description?: unknown };
  return `Google sign-in: ${str(b?.error_description) ?? str(b?.error) ?? "couldn't get an access token"}`;
}

// ---------------------------------------------------------------------------
// TikTok
// ---------------------------------------------------------------------------

export function tiktokReportUrl(config: TikTokConfig, range: DateRange, page: number): string {
  const params = new URLSearchParams({
    advertiser_id: config.advertiserId,
    report_type: "BASIC",
    data_level: "AUCTION_CAMPAIGN",
    dimensions: JSON.stringify(["campaign_id", "stat_time_day"]),
    metrics: JSON.stringify(["campaign_name", "spend", "impressions", "clicks", ...config.conversionMetrics]),
    start_date: range.from,
    end_date: range.to,
    page: String(page),
    page_size: "1000",
  });
  return `${TIKTOK_API_BASE}/report/integrated/get/?${params}`;
}

export function tiktokAdvertiserUrl(config: TikTokConfig): string {
  const params = new URLSearchParams({
    advertiser_ids: JSON.stringify([config.advertiserId]),
    fields: JSON.stringify(["currency"]),
  });
  return `${TIKTOK_API_BASE}/advertiser/info/?${params}`;
}

/** TikTok answers 200 with code ≠ 0 on errors. */
export function tiktokError(body: unknown): string | null {
  const b = body as { code?: unknown; message?: unknown };
  if (b?.code === 0) return null;
  return `TikTok: ${str(b?.message) ?? "unknown error"}${b?.code !== undefined ? ` (code ${String(b.code)})` : ""}`;
}

export function parseTikTokCurrency(body: unknown): string | null {
  const list = (body as { data?: { list?: unknown } })?.data?.list;
  return Array.isArray(list) ? currencyOf((list[0] as { currency?: unknown })?.currency) : null;
}

export interface TikTokPage {
  rows: MarketingRow[];
  totalPages: number;
}

export function parseTikTokPage(body: unknown, config: TikTokConfig, currency: string): TikTokPage {
  const data = (body as { data?: { list?: unknown; page_info?: { total_page?: unknown } } })?.data;
  const rows: MarketingRow[] = [];
  if (Array.isArray(data?.list)) {
    for (const item of data.list as { dimensions?: Record<string, unknown>; metrics?: Record<string, unknown> }[]) {
      const day = str(item?.dimensions?.stat_time_day)?.slice(0, 10);
      const campaignId = str(item?.dimensions?.campaign_id);
      if (!isDate(day) || !campaignId) continue;
      const m = item.metrics ?? {};
      rows.push({
        channel: "tiktok",
        account_id: config.advertiserId,
        campaign_id: campaignId,
        campaign_name: name(m.campaign_name),
        day,
        currency,
        spend: round2(num(m.spend)),
        impressions: Math.round(num(m.impressions)),
        clicks: Math.round(num(m.clicks)),
        outbound_clicks: null,
        conversions: round2(config.conversionMetrics.reduce((total, metric) => total + num(m[metric]), 0)),
        conversion_value: null,
      });
    }
  }
  return { rows, totalPages: Math.max(1, Math.round(num(data?.page_info?.total_page))) };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Rows outside the requested range are dropped (platforms sometimes pad). */
export function rowsInRange(rows: MarketingRow[], range: DateRange): MarketingRow[] {
  return rows.filter((r) => r.day >= range.from && r.day <= range.to);
}

/** Distinct currencies in a run, for the counts-only summary. */
export function currenciesOf(rows: MarketingRow[]): string[] {
  return [...new Set(rows.map((r) => r.currency))].sort();
}

