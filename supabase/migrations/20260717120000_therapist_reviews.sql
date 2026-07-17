-- ============================================================================
-- Therapist reviews  —  clients rate therapists they have actually engaged with
-- ============================================================================
-- Eligibility is enforced server-side: the `submit-therapist-review` edge
-- function authenticates the caller, fetches the appointment from Acuity, and
-- confirms it belongs to that user AND is a past, non-cancelled session before
-- writing. Therapist identity (calendar_id, therapist_name) is derived from the
-- real Acuity appointment — never trusted from the client.
--
-- Because appointment ownership lives in Acuity (not in a Postgres table), RLS
-- cannot verify it. So all WRITES go through the edge function (service role,
-- bypasses RLS); RLS here only governs READS. Direct client inserts/updates are
-- intentionally NOT permitted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.therapist_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL,                 -- Acuity appointment id (stored as text)
  calendar_id    BIGINT NOT NULL,               -- Acuity calendar id (therapist)
  therapist_name TEXT NOT NULL,
  rating         INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  public_consent BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ,
  -- One review per client per appointment. Re-submitting edits the existing row.
  CONSTRAINT therapist_reviews_user_appointment_unique UNIQUE (user_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS therapist_reviews_user_idx     ON public.therapist_reviews (user_id);
CREATE INDEX IF NOT EXISTS therapist_reviews_calendar_idx ON public.therapist_reviews (calendar_id);
CREATE INDEX IF NOT EXISTS therapist_reviews_created_idx  ON public.therapist_reviews (created_at DESC);

-- ----------------------------------------------------------------------------
-- RLS — reads only. Writes are performed by the edge function via the service
-- role key, which bypasses these policies. No INSERT/UPDATE/DELETE policy is
-- defined for clients, so the anon/authenticated roles cannot write directly.
-- ----------------------------------------------------------------------------
ALTER TABLE public.therapist_reviews ENABLE ROW LEVEL SECURITY;

-- Clients can read their own reviews (used to render the "reviewed" state).
DROP POLICY IF EXISTS "own therapist reviews" ON public.therapist_reviews;
CREATE POLICY "own therapist reviews" ON public.therapist_reviews
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Admins can read all reviews for moderation / export.
DROP POLICY IF EXISTS "admins read all therapist reviews" ON public.therapist_reviews;
CREATE POLICY "admins read all therapist reviews" ON public.therapist_reviews
  FOR SELECT
  TO authenticated
  USING (public.has_role('admin'));

-- Keep updated_at fresh on edits performed through the service role.
CREATE OR REPLACE FUNCTION public.touch_therapist_review_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS therapist_reviews_set_updated_at ON public.therapist_reviews;
CREATE TRIGGER therapist_reviews_set_updated_at
  BEFORE UPDATE ON public.therapist_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_therapist_review_updated_at();
