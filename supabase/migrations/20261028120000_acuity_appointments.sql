-- A copy of every Acuity appointment, so the admin Overview analytics can use
-- each client's full booking history without asking Acuity on page load.
-- Acuity caps each request at 500 appointments and only returns scheduledBy
-- (who made the booking) one appointment at a time, so both are done here
-- ahead of time by a scheduled sync (the acuity-appointments-mirror edge
-- function, run from GitHub Actions like the Bundles snapshot).
--
--   acuity_appointments   one row per Acuity appointment, cancelled included
--   acuity_sync_state     how far the one-off history copy has got, and when
--                         the data was last refreshed ("Data last updated")
--   acuity_details_queue()       which sessions to look scheduledBy up for next
--   admin_analytics_sessions()   every session, compact, for admin-analytics
--   admin_analytics_calendars()  the calendars, for the boards' filter
--
-- PRIVACY: holds client names, emails and phones. Admins can read (enforced
-- here, not just in the UI); only the service role writes.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Appointments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.acuity_appointments (
  -- Acuity's appointment id.
  id BIGINT PRIMARY KEY,

  -- Same key as the rest of the admin area (admin-customer-insights/logic.ts
  -- customerKey): "email:…", then "phone:…", then "appointment:<id>".
  customer_key TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,

  appointment_type_id INTEGER,
  type TEXT,
  -- classifyAppointmentType() at sync time. Kept next to `type` so rows can
  -- be reclassified if the classifier changes.
  kind TEXT NOT NULL
    CHECK (kind IN ('therapy', 'intro', 'assessment', 'excluded', 'unknown')),
  -- The boards' session type filter (admin-analytics/logic.ts
  -- sessionCategory), also at sync time. Null for non-sessions.
  category TEXT
    CHECK (category IN ('individual', 'couples', 'youth', 'assessment')),

  calendar_id INTEGER,
  calendar TEXT,

  -- When the session takes place, and when the booking was made.
  datetime TIMESTAMP WITH TIME ZONE NOT NULL,
  datetime_created TIMESTAMP WITH TIME ZONE,
  canceled BOOLEAN NOT NULL DEFAULT false,

  -- Who made the booking, from /appointments/{id} (the bulk listing leaves
  -- it out). Empty = the client on Acuity's own page; the API account =
  -- website checkout or hub; anything else = a staff member.
  scheduled_by TEXT,
  -- Null until the detail lookup has been done.
  booked_by_client BOOLEAN,
  -- When the detail lookup was done; null = still to do. Separate from
  -- scheduled_by because an empty scheduled_by is a real answer.
  details_fetched_at TIMESTAMP WITH TIME ZONE,

  certificate TEXT,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,

  first_synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Last time Acuity returned this appointment. A row inside the refresh
  -- window that stops being returned was deleted in Acuity.
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- A customer's full history in order (session numbers, first session).
CREATE INDEX IF NOT EXISTS acuity_appointments_customer_idx
  ON public.acuity_appointments (customer_key, datetime);

-- Date-range queries by session date and by booking date.
CREATE INDEX IF NOT EXISTS acuity_appointments_datetime_idx
  ON public.acuity_appointments (datetime);
CREATE INDEX IF NOT EXISTS acuity_appointments_created_idx
  ON public.acuity_appointments (datetime_created);

-- The queue of appointments still waiting for their scheduledBy lookup.
CREATE INDEX IF NOT EXISTS acuity_appointments_details_pending_idx
  ON public.acuity_appointments (datetime)
  WHERE details_fetched_at IS NULL;

-- ---------------------------------------------------------------------------
-- Sync state: a single row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.acuity_sync_state (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  -- The one-off history copy works backwards from today in date chunks.
  -- Everything from this date onwards has been copied.
  backfilled_from DATE,
  backfill_complete BOOLEAN NOT NULL DEFAULT false,
  -- Last successful refresh of the rolling window (shown on the boards).
  last_refreshed_at TIMESTAMP WITH TIME ZONE,
  -- Counts only, never client data.
  last_run_summary JSONB,
  last_error TEXT CHECK (char_length(last_error) <= 500),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

INSERT INTO public.acuity_sync_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Functions for the edge functions (service role only).
-- ---------------------------------------------------------------------------

-- The next sessions still waiting for their scheduledBy lookup. Each
-- customer's first session comes first (the "new self-booked" tile needs
-- those), then the most recent. Cancelled and non-session appointments are
-- never looked up.
CREATE OR REPLACE FUNCTION public.acuity_details_queue(p_limit INTEGER)
RETURNS SETOF BIGINT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT a.id
  FROM public.acuity_appointments a
  WHERE a.details_fetched_at IS NULL
    AND NOT a.canceled
    AND a.kind IN ('therapy', 'intro', 'assessment')
  ORDER BY
    NOT EXISTS (
      SELECT 1
      FROM public.acuity_appointments b
      WHERE b.customer_key = a.customer_key
        AND NOT b.canceled
        AND b.kind IN ('therapy', 'intro', 'assessment')
        AND (b.datetime, b.id) < (a.datetime, a.id)
    ) DESC,
    a.datetime DESC
  LIMIT p_limit;
$$;

-- Every session, compact, for admin-analytics to count from:
-- [id, customer_key, datetime ms, datetime_created ms, kind,
--  booked_by_client, calendar_id, canceled, category]. Cancelled ones are included so
-- the rule that they never count lives in the tested logic. One JSON value,
-- so PostgREST's row cap doesn't apply. No names or contact details.
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
        category
      )
      ORDER BY customer_key, datetime, id
    ),
    '[]'::json
  )
  FROM public.acuity_appointments
  WHERE kind IN ('therapy', 'intro', 'assessment');
$$;

-- The calendars (therapists) sessions were booked in, for the calendar
-- filter: [[calendar_id, latest name], …].
CREATE OR REPLACE FUNCTION public.admin_analytics_calendars()
RETURNS JSON
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(json_agg(json_build_array(calendar_id, calendar)), '[]'::json)
  FROM (
    SELECT DISTINCT ON (calendar_id) calendar_id, calendar
    FROM public.acuity_appointments
    WHERE calendar_id IS NOT NULL
      AND calendar IS NOT NULL
      AND kind IN ('therapy', 'intro', 'assessment')
    ORDER BY calendar_id, datetime DESC
  ) latest;
$$;

REVOKE EXECUTE ON FUNCTION public.acuity_details_queue(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_sessions() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_analytics_calendars() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acuity_details_queue(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_analytics_sessions() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_analytics_calendars() TO service_role;

-- ---------------------------------------------------------------------------
-- Access: admins read; the browser never writes these tables.
-- ---------------------------------------------------------------------------
ALTER TABLE public.acuity_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.acuity_sync_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view Acuity appointments" ON public.acuity_appointments;
CREATE POLICY "Admins can view Acuity appointments"
ON public.acuity_appointments
FOR SELECT
USING (public.has_role('admin'));

DROP POLICY IF EXISTS "Admins can view Acuity sync state" ON public.acuity_sync_state;
CREATE POLICY "Admins can view Acuity sync state"
ON public.acuity_sync_state
FOR SELECT
USING (public.has_role('admin'));

REVOKE INSERT, UPDATE, DELETE ON public.acuity_appointments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.acuity_sync_state FROM anon, authenticated;

-- Make the API see the new tables straight away.
NOTIFY pgrst, 'reload schema';
