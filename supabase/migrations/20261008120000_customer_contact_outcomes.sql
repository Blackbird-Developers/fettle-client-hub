-- Contact outcomes on the admin Progression pages: No answer, Not continuing
-- (with reasons), Continue later (follow up after 30 days) and Booked.
--
-- Every outcome staff record is a row in customer_contact_attempts, a history
-- log that can't be edited or deleted from the browser. A trigger keeps the
-- per-customer summary on customer_followups (current outcome, attempts, last
-- attempt, follow-up due date) in step, so pages only read one row each.
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Summary columns on customer_followups
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_followups
  ADD COLUMN IF NOT EXISTS outcome TEXT
    CHECK (outcome IN ('no_answer', 'not_continuing', 'follow_up_later', 'booked')),
  ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS outcome_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS outcome_by_email TEXT,
  ADD COLUMN IF NOT EXISTS not_continuing_reasons TEXT[],
  ADD COLUMN IF NOT EXISTS not_continuing_other TEXT,
  -- Only set while the outcome is "Continue later".
  ADD COLUMN IF NOT EXISTS follow_up_due DATE,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMP WITH TIME ZONE,
  -- Last time staff actually spoke to them (any outcome except No answer).
  ADD COLUMN IF NOT EXISTS last_reached_at TIMESTAMP WITH TIME ZONE,
  -- Name as shown when the outcome was recorded. The follow-ups report needs
  -- it for customers who have since dropped out of the Progression window.
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- ---------------------------------------------------------------------------
-- History log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_contact_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_key TEXT NOT NULL
    CHECK (customer_key ~ '^(email|phone|appointment):.+' AND char_length(customer_key) <= 320),
  -- "cleared" undoes a mistaken outcome; it isn't counted as an attempt.
  outcome TEXT NOT NULL
    CHECK (outcome IN ('no_answer', 'not_continuing', 'follow_up_later', 'booked', 'cleared')),
  reasons TEXT[],
  reason_other TEXT CHECK (char_length(reason_other) <= 500),
  customer_name TEXT CHECK (char_length(customer_name) <= 200),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email TEXT,
  -- Reasons only for "Not continuing", at least one, from the known list;
  -- the free text is required with "other" and only allowed with it.
  CONSTRAINT contact_attempt_reasons_valid CHECK (
    CASE
      WHEN outcome = 'not_continuing' THEN
        COALESCE(cardinality(reasons), 0) >= 1
        AND reasons <@ ARRAY['price', 'timing', 'not_interested', 'other']
        AND (('other' = ANY (reasons)) = (NULLIF(btrim(reason_other), '') IS NOT NULL))
      ELSE reasons IS NULL AND reason_other IS NULL
    END
  )
);

CREATE INDEX IF NOT EXISTS customer_contact_attempts_customer_idx
  ON public.customer_contact_attempts (customer_key, created_at DESC);

-- Who/when come from the caller's session, never from the request.
CREATE OR REPLACE FUNCTION public.stamp_customer_contact_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.created_at := now();
  NEW.created_by := auth.uid();
  NEW.created_by_email := auth.jwt() ->> 'email';
  NEW.reason_other := NULLIF(btrim(NEW.reason_other), '');
  NEW.customer_name := NULLIF(btrim(NEW.customer_name), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_customer_contact_attempt ON public.customer_contact_attempts;
CREATE TRIGGER stamp_customer_contact_attempt
  BEFORE INSERT ON public.customer_contact_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_customer_contact_attempt();

-- Keeps the customer's summary row in step with the new attempt. SECURITY
-- DEFINER because the browser can't write the summary columns itself (see the
-- grants below); the attempt insert has already passed the admin policy. The
-- upsert makes concurrent attempts on the same customer count correctly.
CREATE OR REPLACE FUNCTION public.apply_customer_contact_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cleared BOOLEAN := NEW.outcome = 'cleared';
  reached BOOLEAN := NEW.outcome NOT IN ('no_answer', 'cleared');
  due DATE := CASE
    WHEN NEW.outcome = 'follow_up_later'
      -- 30 days from the day it was recorded, in Irish time.
      THEN (NEW.created_at AT TIME ZONE 'Europe/Dublin')::date + 30
  END;
BEGIN
  INSERT INTO public.customer_followups AS f (
    customer_key, contacted, outcome, outcome_at, outcome_by, outcome_by_email,
    not_continuing_reasons, not_continuing_other, follow_up_due,
    attempt_count, last_attempt_at, last_reached_at, customer_name
  ) VALUES (
    NEW.customer_key,
    reached,
    CASE WHEN NOT cleared THEN NEW.outcome END,
    CASE WHEN NOT cleared THEN NEW.created_at END,
    CASE WHEN NOT cleared THEN NEW.created_by END,
    CASE WHEN NOT cleared THEN NEW.created_by_email END,
    NEW.reasons,
    NEW.reason_other,
    due,
    CASE WHEN cleared THEN 0 ELSE 1 END,
    CASE WHEN NOT cleared THEN NEW.created_at END,
    CASE WHEN reached THEN NEW.created_at END,
    NEW.customer_name
  )
  ON CONFLICT (customer_key) DO UPDATE SET
    -- Reaching someone marks them contacted; No answer leaves it as it was.
    contacted = f.contacted OR EXCLUDED.contacted,
    outcome = EXCLUDED.outcome,
    outcome_at = EXCLUDED.outcome_at,
    outcome_by = EXCLUDED.outcome_by,
    outcome_by_email = EXCLUDED.outcome_by_email,
    not_continuing_reasons = EXCLUDED.not_continuing_reasons,
    not_continuing_other = EXCLUDED.not_continuing_other,
    follow_up_due = EXCLUDED.follow_up_due,
    attempt_count = f.attempt_count + EXCLUDED.attempt_count,
    last_attempt_at = COALESCE(EXCLUDED.last_attempt_at, f.last_attempt_at),
    last_reached_at = COALESCE(EXCLUDED.last_reached_at, f.last_reached_at),
    customer_name = COALESCE(EXCLUDED.customer_name, f.customer_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_customer_contact_attempt ON public.customer_contact_attempts;
CREATE TRIGGER apply_customer_contact_attempt
  AFTER INSERT ON public.customer_contact_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_customer_contact_attempt();

-- The browser may only write the contacted flag and the note directly (the
-- trigger stamps who/when). Outcomes go through customer_contact_attempts.
-- customer_key is in the UPDATE list because an upsert sets it again.
REVOKE INSERT, UPDATE ON public.customer_followups FROM anon, authenticated;
GRANT INSERT (customer_key, contacted, note) ON public.customer_followups TO authenticated;
GRANT UPDATE (customer_key, contacted, note) ON public.customer_followups TO authenticated;

-- Enable Row Level Security
ALTER TABLE public.customer_contact_attempts ENABLE ROW LEVEL SECURITY;

-- Admins only. No update or delete policy: the history is append-only.
DROP POLICY IF EXISTS "Admins can view contact attempts" ON public.customer_contact_attempts;
CREATE POLICY "Admins can view contact attempts"
ON public.customer_contact_attempts
FOR SELECT
USING (public.has_role('admin'));

DROP POLICY IF EXISTS "Admins can add contact attempts" ON public.customer_contact_attempts;
CREATE POLICY "Admins can add contact attempts"
ON public.customer_contact_attempts
FOR INSERT
WITH CHECK (public.has_role('admin'));

-- Make the API see the new columns and table straight away.
NOTIFY pgrst, 'reload schema';
