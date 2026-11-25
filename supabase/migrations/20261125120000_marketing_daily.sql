-- Marketing tab: daily ad spend and results from Google Ads, Meta and TikTok.
-- Feeds the "Marketing" tab on the admin Overview: spend, conversions as each
-- channel reports them, CTR / outbound CTR, and cost per new customer.
--
--   marketing_daily        one row per channel + ad account + campaign + day
--   marketing_sync_state   per channel: last sync, last error ("Not connected
--                          yet" / "Last synced …" on the tab)
--   admin_marketing_daily(from, to)   compact per-day, per-channel totals for
--                                     admin-analytics?action=marketing
--
-- Written only by the marketing-sync edge function (service role) and read
-- only by admin-analytics (service role). Browsers have no access.
--
-- No personal data: only campaign names and totals from the ad platforms.
--
-- Platforms keep revising recent days (late conversions), so marketing-sync
-- re-pulls a recent window on every run and replaces those rows; the primary
-- key makes a re-synced day overwrite instead of adding a duplicate.
--
-- Run this file on its own (not `db push`). Safe to re-run.

-- ---------------------------------------------------------------------------
-- Daily figures
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_daily (
  channel TEXT NOT NULL CHECK (channel IN ('google', 'meta', 'tiktok')),
  -- The platform's ad account id (Google customer id, Meta act_…, TikTok
  -- advertiser id), so more than one account per channel can be added later.
  account_id TEXT NOT NULL CHECK (char_length(account_id) BETWEEN 1 AND 64),
  campaign_id TEXT NOT NULL CHECK (char_length(campaign_id) BETWEEN 1 AND 64),
  campaign_name TEXT CHECK (char_length(campaign_name) <= 300),
  -- The day in the ad account's own time zone, as the platform reports it.
  day DATE NOT NULL,
  -- ISO 4217, as the account bills (expected EUR; the tab warns otherwise).
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  spend NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (spend >= 0),
  impressions BIGINT NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  -- All clicks the platform counts (Meta: clicks (all); Google: clicks;
  -- TikTok: clicks).
  clicks BIGINT NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  -- Clicks that leave the platform for the website. Only Meta reports this
  -- (outbound_clicks); NULL where the platform has no such figure.
  outbound_clicks BIGINT CHECK (outbound_clicks >= 0),
  -- Conversions as the channel itself reports them (which event counts is
  -- set per channel in marketing-sync). Google reports fractions.
  conversions NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  -- What the channel says those conversions were worth, where it reports it.
  conversion_value NUMERIC(12, 2) CHECK (conversion_value >= 0),
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, account_id, campaign_id, day)
);

CREATE INDEX IF NOT EXISTS marketing_daily_day_idx ON public.marketing_daily (day);

ALTER TABLE public.marketing_daily ENABLE ROW LEVEL SECURITY;

-- No policies: only the service role reads or writes.
REVOKE ALL ON public.marketing_daily FROM anon, authenticated;
GRANT ALL ON public.marketing_daily TO service_role;

-- ---------------------------------------------------------------------------
-- Sync state, one row per channel
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketing_sync_state (
  channel TEXT PRIMARY KEY CHECK (channel IN ('google', 'meta', 'tiktok')),
  -- Last run that tried this channel, successful or not.
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  -- Last run that stored figures (shown as "Last synced" on the tab).
  last_success_at TIMESTAMP WITH TIME ZONE,
  -- Days covered by the last successful run.
  synced_from DATE,
  synced_to DATE,
  -- Earliest day copied so far (the first run goes further back). Before
  -- this the tab says the channel's spend isn't in, instead of showing 0.
  history_from DATE,
  -- Counts only (rows, campaigns, currencies), never tokens.
  last_run_summary JSONB,
  -- Cleared on success. Never holds tokens or full API responses.
  last_error TEXT CHECK (char_length(last_error) <= 500),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_sync_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.marketing_sync_state FROM anon, authenticated;
GRANT ALL ON public.marketing_sync_state TO service_role;

-- ---------------------------------------------------------------------------
-- For admin-analytics (service role only)
-- ---------------------------------------------------------------------------

-- Per-day, per-channel totals for days in [p_from, p_to] (both inclusive),
-- counted in admin-analytics/marketing.ts. Each row is a JSON array:
--   [day, channel, currency, spend, impressions, clicks, outbound_clicks,
--    conversions, conversion_value, campaigns]
-- outbound_clicks / conversion_value are NULL when no campaign that day
-- reported them. Split by currency so a stray non-EUR account is never
-- silently added to EUR spend.
CREATE OR REPLACE FUNCTION public.admin_marketing_daily(p_from DATE, p_to DATE)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_array(
        day,
        channel,
        currency,
        spend,
        impressions,
        clicks,
        outbound_clicks,
        conversions,
        conversion_value,
        campaigns
      )
      ORDER BY day, channel, currency
    ),
    '[]'::json
  )
  FROM (
    SELECT
      day,
      channel,
      currency,
      sum(spend) AS spend,
      sum(impressions) AS impressions,
      sum(clicks) AS clicks,
      sum(outbound_clicks) AS outbound_clicks,
      sum(conversions) AS conversions,
      sum(conversion_value) AS conversion_value,
      count(*) FILTER (WHERE spend > 0 OR impressions > 0) AS campaigns
    FROM public.marketing_daily
    WHERE day BETWEEN p_from AND p_to
    GROUP BY day, channel, currency
  ) totals;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_marketing_daily(DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_marketing_daily(DATE, DATE) TO service_role;

NOTIFY pgrst, 'reload schema';
