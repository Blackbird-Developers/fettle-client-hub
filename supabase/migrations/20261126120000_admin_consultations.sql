-- Free consultations tab: the free 20-minute calls ("Let's Talk" and "Fettle
-- Introduction Chat") from the Acuity copy, for the "Free consultations" tab
-- on the admin Overview (booked, no-shows, new vs existing, conversion).
--
--   admin_analytics_consultations()   every free call, compact, for
--                                     admin-analytics?action=consultations
--
-- No new tables: the calls are already in acuity_appointments (kind
-- 'excluded'), with their Acuity labels, re-pulled every run for the last 60
-- days, so a "No Show" label added after the call is picked up.
--
-- Read only by admin-analytics (service role). No names or contact details.
--
-- Run this file on its own (not `db push`). Safe to re-run.

-- [id, customer_key, datetime ms, datetime_created ms, canceled,
--  type, calendar_id, calendar, [label names]]. Cancelled calls are included
-- so the rule that they never count lives in the tested logic
-- (supabase/functions/admin-analytics/consultations.ts), which also checks
-- the type and label names. One JSON value, so PostgREST's row cap doesn't
-- apply.
CREATE OR REPLACE FUNCTION public.admin_analytics_consultations()
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    json_agg(
      json_build_array(
        a.id,
        a.customer_key,
        floor(extract(epoch FROM a.datetime) * 1000)::BIGINT,
        floor(extract(epoch FROM a.datetime_created) * 1000)::BIGINT,
        a.canceled,
        a.type,
        a.calendar_id,
        a.calendar,
        (
          SELECT COALESCE(json_agg(label ->> 'name'), '[]'::json)
          FROM jsonb_array_elements(a.labels) AS label
        )
      )
      ORDER BY a.datetime, a.id
    ),
    '[]'::json
  )
  FROM public.acuity_appointments a
  WHERE a.type ~* 'let.?s talk|introduction chat';
$$;

REVOKE EXECUTE ON FUNCTION public.admin_analytics_consultations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_analytics_consultations() TO service_role;
