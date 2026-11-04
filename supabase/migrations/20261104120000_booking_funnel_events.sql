-- Booking funnel: one row per step event from the website's booking wizard
-- (fettle.ie/our-therapists + /book-a-session) and the hub's /book wizard.
-- Feeds the "Booking funnel" tab on the admin Overview: how far people get,
-- where they drop off, and which therapists they pick.
--
-- Written only by the track-booking-funnel edge function (service role) and
-- read only by admin-analytics (service role). Browsers have no access.
--
-- No personal data: no names, emails, phones or IPs. session_id is a random
-- id the page makes per visit, so rows can't be tied back to a person.
--
-- event_id is made by the page per event, so a resent beacon is stored once
-- (insert ... on conflict (event_id) do nothing). Events older than 13 months
-- are deleted by track-booking-funnel itself (about 1 request in 100).
--
-- Also creates, for admin-analytics?action=funnel (service role only):
--   admin_funnel_sessions(from, to)  one compact row per session
--   admin_funnel_tracking_start()    first live event, for "Tracking since"
--
-- Run this file on its own (not `db push`). Safe to re-run.
CREATE TABLE IF NOT EXISTS public.booking_funnel_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE CHECK (char_length(event_id) BETWEEN 8 AND 64),
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- The page's clock when the event happened (clamped by the function to
  -- within a day of received_at). Used for ordering inside a session.
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
  session_id TEXT NOT NULL CHECK (char_length(session_id) BETWEEN 8 AND 64),
  flow TEXT NOT NULL CHECK (flow IN ('website', 'hub')),
  -- Which version of the form: the website pushes booking_flow
  -- (quiz_v2_time_first, quiz_v2_details_first on /book-a-session-v1/),
  -- the hub hub_quiz. page_variant is the /our-therapists A/B label.
  booking_flow TEXT CHECK (char_length(booking_flow) <= 64),
  page_variant TEXT CHECK (char_length(page_variant) <= 64),
  -- ?mock=1 and /book-a-session-v1/ runs (simulated payment). The dashboard
  -- leaves these out.
  is_test BOOLEAN NOT NULL DEFAULT false,
  event TEXT NOT NULL CHECK (char_length(event) BETWEEN 1 AND 64),
  step_name TEXT CHECK (char_length(step_name) <= 64),
  step SMALLINT,
  -- therapist_id is the website's ?t= id (e.g. 319); therapist the name.
  therapist_id INTEGER,
  therapist TEXT CHECK (char_length(therapist) <= 120),
  entry_therapist TEXT CHECK (char_length(entry_therapist) <= 120),
  -- individual | couples | youth | psychologist (the website's `who`)
  service TEXT CHECK (char_length(service) <= 32),
  -- therapist (came with ?t=) | matching (Find me a therapist) | psychologist
  path TEXT CHECK (char_length(path) <= 32),
  package_id TEXT CHECK (char_length(package_id) <= 64),
  booking_id TEXT CHECK (char_length(booking_id) <= 64),
  -- What the client pays, in euro (payment_initiated / completed).
  amount NUMERIC(10, 2) CHECK (amount >= 0 AND amount < 100000),
  -- booking_payment_failed reason, e.g. slot_unavailable
  reason TEXT CHECK (char_length(reason) <= 64),
  referral_source TEXT CHECK (char_length(referral_source) <= 64),
  device TEXT CHECK (device IN ('mobile', 'tablet', 'desktop')),
  -- Path only, never the query string.
  page TEXT CHECK (char_length(page) <= 200),
  utm_source TEXT CHECK (char_length(utm_source) <= 100),
  utm_medium TEXT CHECK (char_length(utm_medium) <= 100),
  utm_campaign TEXT CHECK (char_length(utm_campaign) <= 150)
);

CREATE INDEX IF NOT EXISTS booking_funnel_events_occurred_idx
  ON public.booking_funnel_events (occurred_at);
CREATE INDEX IF NOT EXISTS booking_funnel_events_live_idx
  ON public.booking_funnel_events (occurred_at) WHERE NOT is_test;
CREATE INDEX IF NOT EXISTS booking_funnel_events_session_idx
  ON public.booking_funnel_events (session_id, occurred_at);

ALTER TABLE public.booking_funnel_events ENABLE ROW LEVEL SECURITY;

-- No policies: only the service role reads or writes.
REVOKE ALL ON public.booking_funnel_events FROM anon, authenticated;
GRANT ALL ON public.booking_funnel_events TO service_role;

-- One compact row per funnel session that started in [p_from, p_to), test
-- runs left out, for admin-analytics?action=funnel (counted in
-- admin-analytics/funnel.ts). Each row is a JSON array:
--   [started_ms, flow, booking_flow, device, click_therapist, therapist,
--    service, markers[], fail_reasons[], referral_source, utm_source]
-- markers are the event names, with step views as 'step:<step_name>'.
-- click_therapist is the Book Now card clicked on /our-therapists; therapist
-- the last one named after that (the one chosen when matching).
-- A session's later events (e.g. a bundle bought in the hub) are included
-- up to two days after p_to.
CREATE OR REPLACE FUNCTION public.admin_funnel_sessions(
  p_from TIMESTAMP WITH TIME ZONE,
  p_to TIMESTAMP WITH TIME ZONE
)
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH events AS (
    SELECT *
    FROM public.booking_funnel_events
    WHERE NOT is_test
      AND occurred_at >= p_from - INTERVAL '1 day'
      AND occurred_at < p_to + INTERVAL '2 days'
  ),
  sessions AS (
    SELECT
      session_id,
      min(occurred_at) AS started_at,
      (array_agg(flow ORDER BY occurred_at))[1] AS flow,
      (array_agg(booking_flow ORDER BY occurred_at) FILTER (WHERE booking_flow IS NOT NULL))[1] AS booking_flow,
      (array_agg(device ORDER BY occurred_at) FILTER (WHERE device IS NOT NULL))[1] AS device,
      (array_agg(therapist ORDER BY occurred_at)
        FILTER (WHERE event = 'booking_page_redirect' AND therapist IS NOT NULL))[1] AS click_therapist,
      (array_agg(therapist ORDER BY occurred_at DESC)
        FILTER (WHERE event <> 'booking_page_redirect' AND therapist IS NOT NULL))[1] AS therapist,
      (array_agg(service ORDER BY occurred_at DESC) FILTER (WHERE service IS NOT NULL))[1] AS service,
      array_agg(DISTINCT CASE WHEN event = 'booking_step_view' THEN 'step:' || COALESCE(step_name, '') ELSE event END) AS markers,
      COALESCE(
        array_agg(DISTINCT reason) FILTER (WHERE event = 'booking_payment_failed' AND reason IS NOT NULL),
        ARRAY[]::TEXT[]
      ) AS fail_reasons,
      (array_agg(referral_source ORDER BY occurred_at DESC) FILTER (WHERE referral_source IS NOT NULL))[1] AS referral_source,
      (array_agg(utm_source ORDER BY occurred_at) FILTER (WHERE utm_source IS NOT NULL))[1] AS utm_source
    FROM events
    GROUP BY session_id
    HAVING min(occurred_at) >= p_from AND min(occurred_at) < p_to
  )
  SELECT COALESCE(
    json_agg(
      json_build_array(
        floor(extract(epoch FROM started_at) * 1000)::BIGINT,
        flow,
        booking_flow,
        device,
        click_therapist,
        therapist,
        service,
        markers,
        fail_reasons,
        referral_source,
        utm_source
      )
      ORDER BY started_at
    ),
    '[]'::json
  )
  FROM sessions;
$$;

-- When tracking began (first live event), for the "Tracking since" note.
CREATE OR REPLACE FUNCTION public.admin_funnel_tracking_start()
RETURNS TIMESTAMP WITH TIME ZONE
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT min(occurred_at) FROM public.booking_funnel_events WHERE NOT is_test;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_funnel_sessions(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_funnel_tracking_start() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_funnel_sessions(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_funnel_tracking_start() TO service_role;

NOTIFY pgrst, 'reload schema';
