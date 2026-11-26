-- Period figures for the admin work-list pages (Hot leads, Psychiatry,
-- Assessments), from the Acuity copy, so the date picker's period and its
-- comparison can reach back past the pages' live Acuity window (90 days).
--
--   admin_analytics_lead_rows()       every appointment of anyone who has an
--                                     Acuity label (No Show, Quoted, Booked in…)
--   admin_analytics_clinical_rows()   every assessment-kind appointment
--                                     (assessments, screenings, psychiatry)
--
-- Both feed admin-analytics?action=periods, which applies the same rules as
-- the pages (admin-leads/logic.ts, admin-clinical/logic.ts). Portal adoption
-- uses admin_analytics_sessions() and profiles, so it needs nothing new.
--
-- No new tables. Labels are re-pulled for the last 60 days on every sync, so
-- a label added more than 60 days after an appointment isn't picked up.
-- Read only by admin-analytics (service role). No names or contact details.
--
-- Run this file on its own (not `db push`). Safe to re-run.

-- [id, customer_key, datetime ms, canceled, type, appointment_type_id,
--  labels [{id, name}]], for customers with any labelled appointment, so a
-- lead's later sessions (did they book?) come with it. One JSON value, so
-- PostgREST's row cap doesn't apply.
CREATE OR REPLACE FUNCTION public.admin_analytics_lead_rows()
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
        a.canceled,
        a.type,
        a.appointment_type_id,
        a.labels
      )
      ORDER BY a.customer_key, a.datetime, a.id
    ),
    '[]'::json
  )
  FROM public.acuity_appointments a
  WHERE a.customer_key IN (
    SELECT DISTINCT customer_key
    FROM public.acuity_appointments
    WHERE jsonb_array_length(labels) > 0
  );
$$;

-- [id, customer_key, datetime ms, canceled, type, appointment_type_id] for
-- every assessment-kind appointment (psychiatry types are in this kind too).
CREATE OR REPLACE FUNCTION public.admin_analytics_clinical_rows()
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
        a.canceled,
        a.type,
        a.appointment_type_id
      )
      ORDER BY a.datetime, a.id
    ),
    '[]'::json
  )
  FROM public.acuity_appointments a
  WHERE a.kind = 'assessment';
$$;

REVOKE EXECUTE ON FUNCTION public.admin_analytics_lead_rows() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_clinical_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_analytics_lead_rows() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_analytics_clinical_rows() TO service_role;
