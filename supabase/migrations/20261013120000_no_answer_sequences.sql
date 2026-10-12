-- No-answer follow-up sequences: logging "No answer" on a customer starts a
-- six-attempt sequence. The hub works out when each attempt is due and
-- shows it on the admin No answer page; staff make the calls.
--
--   attempt  1    2    3    4    5    6
--   day      0   +1   +2   +4   +7   +7   (days after the previous attempt;
--                                          weekends move to Monday)
--
-- Every outcome is still one row in customer_contact_attempts. A trigger on
-- that table moves the customer's sequence on:
--   - No answer with no open sequence starts one at attempt 1 (unless a
--     sequence finished within the last 60 days; staff can restart by hand)
--   - No answer with an open sequence moves it to the next attempt; a second
--     one on the same day counts once; the sixth finishes it ("exhausted")
--   - Booked, Not continuing or Follow up later closes it with that status
--   - Clearing the outcome closes it only if it was the attempt that started it
-- Staff can also close a sequence (with a reason) or restart one, through
-- close_no_answer_sequence() and restart_no_answer_sequence().
--
-- Needs 20261008120000_customer_contact_outcomes.sql first. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.no_answer_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_key TEXT NOT NULL
    CHECK (customer_key ~ '^(email|phone|appointment):.+' AND char_length(customer_key) <= 320),
  customer_name TEXT CHECK (char_length(customer_name) <= 200),
  customer_phone TEXT CHECK (char_length(customer_phone) <= 50),
  -- Where the first No answer was logged.
  source TEXT NOT NULL DEFAULT 'progression'
    CHECK (source IN ('progression', 'hot_lead', 'followups', 'no_answer')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'booked', 'not_continuing', 'follow_up_later', 'exhausted', 'closed')),
  -- Unanswered attempts so far (0 only for a restarted sequence).
  attempts_done SMALLINT NOT NULL DEFAULT 0 CHECK (attempts_done BETWEEN 0 AND 6),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_by_email TEXT,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  last_attempt_by_email TEXT,
  last_method TEXT,
  -- Only set while active.
  next_due_on DATE,
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by_email TEXT,
  closed_reason TEXT CHECK (char_length(closed_reason) <= 500)
);

-- At most one open sequence per customer.
CREATE UNIQUE INDEX IF NOT EXISTS no_answer_sequences_one_active
  ON public.no_answer_sequences (customer_key) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS no_answer_sequences_status_due_idx
  ON public.no_answer_sequences (status, next_due_on);
CREATE INDEX IF NOT EXISTS no_answer_sequences_customer_idx
  ON public.no_answer_sequences (customer_key, closed_at DESC);

-- ---------------------------------------------------------------------------
-- New columns on the contact log
-- ---------------------------------------------------------------------------
ALTER TABLE public.customer_contact_attempts
  ADD COLUMN IF NOT EXISTS method TEXT
    CHECK (method IN ('call', 'email', 'sms', 'whatsapp', 'other')),
  ADD COLUMN IF NOT EXISTS note TEXT CHECK (char_length(note) <= 500),
  ADD COLUMN IF NOT EXISTS source TEXT
    CHECK (source IN ('progression', 'hot_lead', 'followups', 'no_answer')),
  ADD COLUMN IF NOT EXISTS customer_phone TEXT CHECK (char_length(customer_phone) <= 50),
  -- Set by the trigger, never by the browser.
  ADD COLUMN IF NOT EXISTS sequence_id UUID
    REFERENCES public.no_answer_sequences(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attempt_number SMALLINT;

-- ---------------------------------------------------------------------------
-- Cadence
-- ---------------------------------------------------------------------------
-- When the next attempt is due, given the date of the latest one and how many
-- have been made. Null once all six are done. Weekends move to Monday.
CREATE OR REPLACE FUNCTION public.no_answer_next_due(last_attempt_on DATE, attempts_done INTEGER)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE EXTRACT(ISODOW FROM d)
           WHEN 6 THEN d + 2
           WHEN 7 THEN d + 1
           ELSE d
         END
  FROM (
    SELECT last_attempt_on + (ARRAY[0, 1, 2, 4, 7, 7])[attempts_done + 1] AS d
  ) due
  WHERE attempts_done BETWEEN 0 AND 5;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: moves the sequence on for every new contact attempt. Runs BEFORE
-- INSERT so it can stamp sequence_id and attempt_number on the attempt, and
-- after stamp_customer_contact_attempt (triggers fire in name order), so
-- created_at/created_by are already set. SECURITY DEFINER because the
-- browser can't write no_answer_sequences itself; the attempt insert has
-- already passed the admin policy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.stamp_no_answer_sequence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  seq public.no_answer_sequences%ROWTYPE;
  today DATE := (NEW.created_at AT TIME ZONE 'Europe/Dublin')::date;
  done INTEGER;
BEGIN
  NEW.sequence_id := NULL;
  NEW.attempt_number := NULL;
  NEW.note := NULLIF(btrim(NEW.note), '');
  NEW.customer_phone := NULLIF(btrim(NEW.customer_phone), '');

  SELECT * INTO seq
  FROM public.no_answer_sequences
  WHERE customer_key = NEW.customer_key AND status = 'active'
  FOR UPDATE;

  IF NEW.outcome = 'no_answer' THEN
    IF NOT FOUND THEN
      -- Cool-off: no automatic restart within 60 days of finishing six attempts.
      IF EXISTS (
        SELECT 1 FROM public.no_answer_sequences
        WHERE customer_key = NEW.customer_key
          AND status = 'exhausted'
          AND closed_at > NEW.created_at - INTERVAL '60 days'
      ) THEN
        RETURN NEW;
      END IF;

      INSERT INTO public.no_answer_sequences (
        customer_key, customer_name, customer_phone, source, attempts_done,
        started_at, started_by_email, last_attempt_at, last_attempt_by_email,
        last_method, next_due_on
      ) VALUES (
        NEW.customer_key, NEW.customer_name, NEW.customer_phone,
        COALESCE(NEW.source, 'progression'), 1,
        NEW.created_at, NEW.created_by_email, NEW.created_at, NEW.created_by_email,
        NEW.method, public.no_answer_next_due(today, 1)
      )
      RETURNING * INTO seq;

      NEW.sequence_id := seq.id;
      NEW.attempt_number := 1;
      RETURN NEW;
    END IF;

    NEW.sequence_id := seq.id;

    -- A second attempt on the same day (e.g. two staff on one person) is
    -- logged but counts as the same attempt.
    IF seq.last_attempt_at IS NOT NULL
       AND (seq.last_attempt_at AT TIME ZONE 'Europe/Dublin')::date = today THEN
      NEW.attempt_number := seq.attempts_done;
      UPDATE public.no_answer_sequences SET
        last_attempt_at = NEW.created_at,
        last_attempt_by_email = NEW.created_by_email,
        last_method = COALESCE(NEW.method, last_method),
        customer_name = COALESCE(NEW.customer_name, customer_name),
        customer_phone = COALESCE(NEW.customer_phone, customer_phone)
      WHERE id = seq.id;
      RETURN NEW;
    END IF;

    done := seq.attempts_done + 1;
    NEW.attempt_number := done;
    UPDATE public.no_answer_sequences SET
      attempts_done = done,
      last_attempt_at = NEW.created_at,
      last_attempt_by_email = NEW.created_by_email,
      last_method = NEW.method,
      next_due_on = public.no_answer_next_due(today, done),
      status = CASE WHEN done >= 6 THEN 'exhausted' ELSE 'active' END,
      closed_at = CASE WHEN done >= 6 THEN NEW.created_at END,
      closed_reason = CASE WHEN done >= 6 THEN 'No answer after 6 attempts' END,
      customer_name = COALESCE(NEW.customer_name, customer_name),
      customer_phone = COALESCE(NEW.customer_phone, customer_phone)
    WHERE id = seq.id;
    RETURN NEW;
  END IF;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Clearing a mistaken outcome only undoes a sequence that it started.
  IF NEW.outcome = 'cleared' AND seq.attempts_done > 1 THEN
    RETURN NEW;
  END IF;

  NEW.sequence_id := seq.id;
  UPDATE public.no_answer_sequences SET
    status = CASE WHEN NEW.outcome = 'cleared' THEN 'closed' ELSE NEW.outcome END,
    next_due_on = NULL,
    closed_at = NEW.created_at,
    closed_by = NEW.created_by,
    closed_by_email = NEW.created_by_email,
    closed_reason = CASE WHEN NEW.outcome = 'cleared' THEN 'Outcome cleared' END
  WHERE id = seq.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_no_answer_sequence ON public.customer_contact_attempts;
CREATE TRIGGER stamp_no_answer_sequence
  BEFORE INSERT ON public.customer_contact_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_no_answer_sequence();

-- ---------------------------------------------------------------------------
-- Staff actions (admins only; who/when come from the caller's session)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_no_answer_sequence(p_sequence_id UUID, p_reason TEXT)
RETURNS public.no_answer_sequences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.no_answer_sequences%ROWTYPE;
  reason TEXT := NULLIF(btrim(p_reason), '');
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF reason IS NULL THEN
    RAISE EXCEPTION 'Enter why the sequence is being closed' USING ERRCODE = '22023';
  END IF;
  IF char_length(reason) > 500 THEN
    RAISE EXCEPTION 'The reason can be up to 500 characters' USING ERRCODE = '22023';
  END IF;

  UPDATE public.no_answer_sequences SET
    status = 'closed',
    next_due_on = NULL,
    closed_at = now(),
    closed_by = auth.uid(),
    closed_by_email = auth.jwt() ->> 'email',
    closed_reason = reason
  WHERE id = p_sequence_id AND status = 'active'
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This sequence has already ended' USING ERRCODE = 'P0002';
  END IF;
  RETURN result;
END;
$$;

-- Starts a fresh sequence by hand (e.g. inside the 60-day cool-off). Its
-- first attempt is due today; logging No answer then counts as attempt 1.
CREATE OR REPLACE FUNCTION public.restart_no_answer_sequence(
  p_customer_key TEXT,
  p_customer_name TEXT,
  p_customer_phone TEXT
)
RETURNS public.no_answer_sequences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.no_answer_sequences%ROWTYPE;
  today DATE := (now() AT TIME ZONE 'Europe/Dublin')::date;
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.no_answer_sequences
    WHERE customer_key = p_customer_key AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'A sequence is already open for this customer' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.no_answer_sequences (
    customer_key, customer_name, customer_phone, source, attempts_done,
    started_by_email, next_due_on
  ) VALUES (
    p_customer_key,
    NULLIF(btrim(p_customer_name), ''),
    NULLIF(btrim(p_customer_phone), ''),
    'no_answer', 0,
    auth.jwt() ->> 'email',
    public.no_answer_next_due(today, 0)
  )
  RETURNING * INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.close_no_answer_sequence(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.restart_no_answer_sequence(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_no_answer_sequence(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restart_no_answer_sequence(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Customers already marked No answer join with their past no-answers counted
-- (one per day, since their last other outcome).
-- ---------------------------------------------------------------------------
INSERT INTO public.no_answer_sequences (
  customer_key, customer_name, source, attempts_done, started_at,
  last_attempt_at, last_attempt_by_email, next_due_on, status, closed_at, closed_reason
)
SELECT
  f.customer_key,
  f.customer_name,
  'progression',
  LEAST(s.days, 6),
  s.first_at,
  s.last_at,
  s.last_by,
  CASE WHEN s.days < 6
    THEN public.no_answer_next_due((s.last_at AT TIME ZONE 'Europe/Dublin')::date, s.days::INTEGER)
  END,
  CASE WHEN s.days >= 6 THEN 'exhausted' ELSE 'active' END,
  CASE WHEN s.days >= 6 THEN s.last_at END,
  CASE WHEN s.days >= 6 THEN 'No answer after 6 attempts' END
FROM public.customer_followups f
JOIN LATERAL (
  SELECT
    count(DISTINCT (a.created_at AT TIME ZONE 'Europe/Dublin')::date) AS days,
    min(a.created_at) AS first_at,
    max(a.created_at) AS last_at,
    (array_agg(a.created_by_email ORDER BY a.created_at DESC))[1] AS last_by
  FROM public.customer_contact_attempts a
  WHERE a.customer_key = f.customer_key
    AND a.outcome = 'no_answer'
    AND a.created_at > COALESCE((
      SELECT max(b.created_at) FROM public.customer_contact_attempts b
      WHERE b.customer_key = f.customer_key AND b.outcome <> 'no_answer'
    ), '-infinity'::timestamptz)
) s ON s.days > 0
WHERE f.outcome = 'no_answer'
  AND NOT EXISTS (
    SELECT 1 FROM public.no_answer_sequences q WHERE q.customer_key = f.customer_key
  );

-- ---------------------------------------------------------------------------
-- Access: admins read; only the trigger and the functions above write.
-- ---------------------------------------------------------------------------
ALTER TABLE public.no_answer_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view no-answer sequences" ON public.no_answer_sequences;
CREATE POLICY "Admins can view no-answer sequences"
ON public.no_answer_sequences
FOR SELECT
USING (public.has_role('admin'));

REVOKE INSERT, UPDATE, DELETE ON public.no_answer_sequences FROM anon, authenticated;

-- Make the API see the new table, columns and functions straight away.
NOTIFY pgrst, 'reload schema';
