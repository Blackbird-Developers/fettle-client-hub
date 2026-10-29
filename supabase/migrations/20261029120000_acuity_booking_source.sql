-- Where each booking was made, for the admin Overview's Customers board.
-- scheduledBy tells the client on Acuity's own page (empty) from a team
-- member (their email), but website checkout, the hub and Art booking by
-- hand in Acuity all use the main (API) account. Those are told apart by
-- matching Stripe payments: the hub's carry "[MyFettleHub]" and the Acuity
-- appointment id, the website's "[WEBSITE]" (Art, 29 Oct 2026).
--
--   booking_source       acuity_page | website | hub | main_account | team;
--                        null = not worked out yet
--   source_checked_at    when it was worked out
--   acuity_sources_queue()      main-account bookings still to match to Stripe
--   admin_analytics_sessions()  now also returns booking_source
--
-- Needs 20261028120000_acuity_appointments.sql first. Safe to re-run.

ALTER TABLE public.acuity_appointments
  ADD COLUMN IF NOT EXISTS booking_source TEXT
    CHECK (booking_source IN ('acuity_page', 'website', 'hub', 'main_account', 'team')),
  ADD COLUMN IF NOT EXISTS source_checked_at TIMESTAMP WITH TIME ZONE;

-- Bookings already looked up whose source scheduledBy settles on its own.
-- The main account's email is API_BOOKED_BY in
-- functions/acuity-appointments-mirror/logic.ts.
UPDATE public.acuity_appointments
SET
  booking_source = CASE WHEN scheduled_by IS NULL THEN 'acuity_page' ELSE 'team' END,
  source_checked_at = now()
WHERE details_fetched_at IS NOT NULL
  AND booking_source IS NULL
  AND (scheduled_by IS NULL OR lower(trim(scheduled_by)) <> 'art@blackbird.marketing');

-- Main-account sessions still to match to Stripe, oldest booking first, from
-- p_since (by session or booking date) and booked before p_settled_before, so
-- the hub has had time to stamp its payment with the appointment id.
CREATE OR REPLACE FUNCTION public.acuity_sources_queue(
  p_since TIMESTAMP WITH TIME ZONE,
  p_settled_before TIMESTAMP WITH TIME ZONE,
  p_limit INTEGER
)
RETURNS TABLE (id BIGINT, email TEXT, datetime_created TIMESTAMP WITH TIME ZONE)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT a.id, a.email, a.datetime_created
  FROM public.acuity_appointments a
  WHERE a.details_fetched_at IS NOT NULL
    AND a.source_checked_at IS NULL
    AND lower(trim(a.scheduled_by)) = 'art@blackbird.marketing'
    AND NOT a.canceled
    AND a.kind IN ('therapy', 'intro', 'assessment')
    AND (a.datetime >= p_since OR a.datetime_created >= p_since)
    AND (a.datetime_created IS NULL OR a.datetime_created < p_settled_before)
  ORDER BY a.datetime_created NULLS FIRST, a.id
  LIMIT p_limit;
$$;

-- As in 20261028120000, with booking_source added at the end:
-- [id, customer_key, datetime ms, datetime_created ms, kind,
--  booked_by_client, calendar_id, canceled, category, booking_source].
CREATE OR REPLACE FUNCTION public.admin_analytics_sessions()
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_array(
        id,
        customer_key,
        floor(extract(epoch FROM datetime) * 1000)::BIGINT,
        floor(extract(epoch FROM datetime_created) * 1000)::BIGINT,
        kind,
        booked_by_client,
        calendar_id,
        canceled,
        category,
        booking_source
      )
      ORDER BY customer_key, datetime, id
    ),
    '[]'::json
  )
  FROM public.acuity_appointments
  WHERE kind IN ('therapy', 'intro', 'assessment');
$$;

REVOKE EXECUTE ON FUNCTION public.acuity_sources_queue(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_sessions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acuity_sources_queue(TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_analytics_sessions() TO service_role;

NOTIFY pgrst, 'reload schema';
