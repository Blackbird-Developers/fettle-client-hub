// marketing-sync — copies daily ad spend and results from Meta, Google Ads
// and TikTok into marketing_daily, for the admin Overview's Marketing tab
// (read by admin-analytics?action=marketing).
//
// Called by .github/workflows/marketing-sync.yml
// (.github/scripts/sync-marketing.mjs), POST with x-cron-secret, one channel
// per call so no call runs past the edge-function time limit:
//   { channel: "meta" | "google" | "tiktok" }
//     → { channel, status: "skipped" | "ok" | "error", … counts }
// A channel can have several accounts (comma-separated IDs in its secret);
// they're pulled in turn and shown together as one channel.
//
// Each run, per channel:
//   1. re-pull the last REFRESH_DAYS days (platforms keep revising recent
//      conversions) and replace those rows;
//   2. copy one chunk of older history, until HISTORY_START.
// A channel whose secrets aren't all set is skipped, not an error, so this can
// be deployed before every ad account is connected. Secrets: see
// docs/MARKETING_TAB.md.
//
// PRIVACY / SECRETS: ad platforms send campaign totals only, no personal
// data. Tokens are never logged or stored; error messages are scrubbed of
// them before they're saved to marketing_sync_state or returned.
//
// DEPLOY: imports ../admin-analytics and ../admin-customer-insights, so
// deploy with the Supabase CLI (`supabase functions deploy marketing-sync`).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dublinDate, type DateRange } from "../admin-analytics/logic.ts";
import {
  type ChannelConfig,
  type GoogleConfig,
  type MarketingRow,
  type MetaConfig,
  type TikTokConfig,
  GOOGLE_TOKEN_URL,
  TIKTOK_MAX_DAYS,
  accountIdsOf,
  channelConfig,
  currenciesOf,
  googleError,
  googleHeaders,
  googleQuery,
  googleSearchUrl,
  googleTokenBody,
  googleTokenError,
  isKnownChannel,
  mergeRows,
  metaError,
  metaInsightsUrl,
  parseGoogleStream,
  parseMetaPage,
  parseTikTokCurrency,
  parseTikTokPage,
  rowsInRange,
  safeError,
  secretsOf,
  splitRange,
  syncPlan,
  tiktokAdvertiserUrl,
  tiktokError,
  tiktokReportUrl,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Per platform request. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Guards against a paging loop. */
const MAX_PAGES = 50;
/** Rows per upsert. */
const UPSERT_BATCH = 500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Fetches JSON; a body that isn't JSON comes back as null. */
async function getJson(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // e.g. a gateway error page
  }
  return { ok: response.ok, status: response.status, body };
}

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------

async function fetchMeta(config: MetaConfig, accountId: string, range: DateRange): Promise<MarketingRow[]> {
  const rows: MarketingRow[] = [];
  let url: string | null = metaInsightsUrl(config, accountId, range);
  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES) throw new Error("Meta: too many pages");
    const { ok, status, body } = await getJson(url);
    const error = metaError(body);
    if (!ok || error) throw new Error(error ?? `Meta: HTTP ${status}`);
    const parsed = parseMetaPage(body, accountId);
    rows.push(...parsed.rows);
    url = parsed.next;
  }
  return rows;
}

async function googleAccessToken(config: GoogleConfig): Promise<string> {
  const { ok, body } = await getJson(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: googleTokenBody(config),
  });
  const token = (body as { access_token?: unknown })?.access_token;
  if (!ok || typeof token !== "string") throw new Error(googleTokenError(body));
  return token;
}

async function fetchGoogle(
  config: GoogleConfig,
  customerId: string,
  range: DateRange,
  accessToken: string
): Promise<MarketingRow[]> {
  const { ok, status, body } = await getJson(googleSearchUrl(config, customerId), {
    method: "POST",
    headers: googleHeaders(config, accessToken),
    body: JSON.stringify({ query: googleQuery(range) }),
  });
  const error = googleError(body);
  if (!ok || error) throw new Error(error ?? `Google Ads: HTTP ${status}`);
  return parseGoogleStream(body, customerId);
}

async function tiktokCurrency(config: TikTokConfig): Promise<string> {
  if (config.currency) return config.currency;
  const { ok, status, body } = await getJson(tiktokAdvertiserUrl(config), { headers: { "Access-Token": config.accessToken } });
  const error = tiktokError(body);
  if (!ok || error) throw new Error(error ?? `TikTok: HTTP ${status}`);
  const currency = parseTikTokCurrency(body);
  if (!currency) throw new Error("TikTok: the account's currency wasn't returned; set TIKTOK_CURRENCY");
  return currency;
}

async function fetchTikTok(config: TikTokConfig, range: DateRange, currency: string): Promise<MarketingRow[]> {
  const rows: MarketingRow[] = [];
  for (const part of splitRange(range, TIKTOK_MAX_DAYS)) {
    for (let page = 1, totalPages = 1; page <= totalPages; page++) {
      if (page > MAX_PAGES) throw new Error("TikTok: too many pages");
      const { ok, status, body } = await getJson(tiktokReportUrl(config, part, page), {
        headers: { "Access-Token": config.accessToken },
      });
      const error = tiktokError(body);
      if (!ok || error) throw new Error(error ?? `TikTok: HTTP ${status}`);
      const parsed = parseTikTokPage(body, config, currency);
      rows.push(...parsed.rows);
      totalPages = parsed.totalPages;
    }
  }
  return rows;
}

/**
 * Runs one account's request; a failure names the account (IDs aren't
 * secret), so an error on one of several accounts says which.
 */
async function forAccount(
  accountId: string,
  several: boolean,
  run: () => Promise<MarketingRow[]>
): Promise<MarketingRow[]> {
  try {
    return await run();
  } catch (error) {
    if (!several || !(error instanceof Error)) throw error;
    throw new Error(`${error.message} [account ${accountId}]`);
  }
}

/**
 * Fetches one range for a channel, every account in turn. Any account failing
 * fails the whole range, so a channel's figures never cover only some of its
 * accounts. Set-up work (tokens, currency) is shared across ranges.
 */
function fetcher(config: ChannelConfig): (range: DateRange) => Promise<MarketingRow[]> {
  if (config.channel === "meta") {
    const several = config.accountIds.length > 1;
    return async (range) => {
      const rows: MarketingRow[] = [];
      for (const id of config.accountIds) rows.push(...(await forAccount(id, several, () => fetchMeta(config, id, range))));
      return rows;
    };
  }
  if (config.channel === "google") {
    const several = config.customerIds.length > 1;
    let token: Promise<string> | null = null;
    return async (range) => {
      const accessToken = await (token ??= googleAccessToken(config));
      const rows: MarketingRow[] = [];
      for (const id of config.customerIds) {
        rows.push(...(await forAccount(id, several, () => fetchGoogle(config, id, range, accessToken))));
      }
      return rows;
    };
  }
  let currency: Promise<string> | null = null;
  return async (range) => fetchTikTok(config, range, await (currency ??= tiktokCurrency(config)));
}

// ---------------------------------------------------------------------------
// Storing
// ---------------------------------------------------------------------------

/**
 * Replaces one channel's rows for a range, across all its accounts: upserts
 * what the platform returned, then deletes rows in the range it no longer
 * returns (a campaign removed, or a day revised to nothing). Only deletes
 * after every upsert succeeded. An account taken out of the secret keeps its
 * old rows; delete them in SQL if they shouldn't count any more.
 */
async function replaceRange(
  db: SupabaseClient,
  config: ChannelConfig,
  range: DateRange,
  rows: MarketingRow[],
  syncedAt: string
): Promise<number> {
  const stamped = rows.map((row) => ({ ...row, synced_at: syncedAt }));
  for (let i = 0; i < stamped.length; i += UPSERT_BATCH) {
    const { error } = await db
      .from("marketing_daily")
      .upsert(stamped.slice(i, i + UPSERT_BATCH), { onConflict: "channel,account_id,campaign_id,day" });
    if (error) throw new Error(`Failed to save figures: ${error.code}`);
  }
  const { error } = await db
    .from("marketing_daily")
    .delete()
    .eq("channel", config.channel)
    .in("account_id", accountIdsOf(config))
    .gte("day", range.from)
    .lte("day", range.to)
    .lt("synced_at", syncedAt);
  if (error) throw new Error(`Failed to remove old figures: ${error.code}`);
  return stamped.length;
}

async function saveState(db: SupabaseClient, channel: string, patch: Record<string, unknown>) {
  const { error } = await db
    .from("marketing_sync_state")
    .upsert({ channel, ...patch, updated_at: new Date().toISOString() }, { onConflict: "channel" });
  if (error) throw new Error(`Failed to save sync state: ${error.code}`);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
  const isCron = req.method === "POST" && Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;
  if (!isCron) return json({ error: "Unauthorized" }, 401);

  let channel: unknown;
  try {
    channel = (await req.json())?.channel;
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }
  if (!isKnownChannel(channel)) return json({ error: "channel must be meta, google or tiktok" }, 400);

  const config = channelConfig(channel, (name) => Deno.env.get(name));
  if (!config) {
    console.log("marketing-sync skipped", { channel });
    return json({ channel, status: "skipped" });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const startedAt = Date.now();
  const syncedAt = new Date(startedAt).toISOString();
  const secrets = secretsOf(config);

  try {
    const { data: state, error: stateError } = await db
      .from("marketing_sync_state")
      .select("history_from")
      .eq("channel", channel)
      .maybeSingle();
    if (stateError) throw new Error(`Failed to read sync state: ${stateError.code}`);

    const plan = syncPlan(dublinDate(startedAt), state?.history_from ?? null);
    await saveState(db, channel, { last_attempt_at: syncedAt });
    const fetchRange = fetcher(config);

    // 1. Recent days.
    const recent = rowsInRange(mergeRows(await fetchRange(plan.refresh)), plan.refresh);
    const refreshed = await replaceRange(db, config, plan.refresh, recent, syncedAt);
    const historyAfterRefresh =
      state?.history_from && state.history_from < plan.refresh.from ? state.history_from : plan.refresh.from;
    await saveState(db, channel, {
      last_success_at: syncedAt,
      synced_from: plan.refresh.from,
      synced_to: plan.refresh.to,
      history_from: historyAfterRefresh,
      last_error: null,
      last_run_summary: {
        refreshed,
        accounts: accountIdsOf(config).length,
        campaigns: new Set(recent.map((r) => `${r.account_id}|${r.campaign_id}`)).size,
        currencies: currenciesOf(recent),
      },
    });

    // 2. One chunk of history.
    let backfilled = 0;
    if (plan.backfill) {
      const older = rowsInRange(mergeRows(await fetchRange(plan.backfill)), plan.backfill);
      backfilled = await replaceRange(db, config, plan.backfill, older, syncedAt);
      await saveState(db, channel, { history_from: plan.historyFrom });
    }

    const result = {
      channel,
      status: "ok",
      refresh: plan.refresh,
      backfill: plan.backfill,
      accounts: accountIdsOf(config).length,
      refreshed,
      backfilled,
      historyFrom: plan.backfill ? plan.historyFrom : historyAfterRefresh,
      durationMs: Date.now() - startedAt,
    };
    console.log("marketing-sync ok", result);
    return json(result);
  } catch (error) {
    const message = safeError(error instanceof Error ? error.message : "Unknown error", secrets);
    console.error("marketing-sync failed", { channel, message });
    try {
      await saveState(db, channel, { last_error: message });
    } catch {
      // The run already failed; the response carries the message.
    }
    // 200 so the workflow script reads the message; it fails the run itself.
    return json({ channel, status: "error", error: message, durationMs: Date.now() - startedAt });
  }
});
