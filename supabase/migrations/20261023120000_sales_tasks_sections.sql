-- Sales tasks revamp: more task types, and "No answer" as a way to complete.
--
-- The page now works through seven sections, in this order:
--   progression  customers between sessions 1→2 … 4→5 with nothing booked
--   bundle       session bundles that are stalled or nearly done
--   followup     "Continue later" customers whose follow-up date has come
--   no_answer    no-answer sequences with an attempt due
--   hot_lead (Courtney's only, as before), psychiatry, assessment (switched
--   back on: tasks closed as out of scope on 19 Oct are reopened below)
--
-- Completing a task now records how it went:
--   completed  as before
--   no_answer  the call wasn't answered, and the customer was emailed and/or
--              WhatsApped instead (at least one). The no-answer is also logged
--              as a contact attempt (source 'sales_tasks'), so it moves the
--              customer's no-answer sequence on like a log from any other page.
-- Who and when are stamped from the caller's session, as before.
--
-- Needs 20261016120000_sales_tasks.sql and 20261013120000_no_answer_sequences.sql
-- first. The old one-argument complete_sales_task call keeps working (the new
-- arguments have defaults), so the page and this migration can ship in either
-- order. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Task types and completion details
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_tasks DROP CONSTRAINT IF EXISTS sales_tasks_kind_check;
ALTER TABLE public.sales_tasks ADD CONSTRAINT sales_tasks_kind_check CHECK (kind IN (
  'progression', 'bundle', 'followup', 'no_answer', 'hot_lead', 'psychiatry', 'assessment'
));

ALTER TABLE public.sales_tasks
  -- How staff completed it; null while pending and for auto-closed tasks.
  ADD COLUMN IF NOT EXISTS completion_outcome TEXT
    CHECK (completion_outcome IN ('completed', 'no_answer')),
  -- For "No answer": the other ways the customer was contacted.
  ADD COLUMN IF NOT EXISTS contacted_by_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contacted_by_whatsapp BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.sales_tasks DROP CONSTRAINT IF EXISTS sales_task_no_answer_channels;
ALTER TABLE public.sales_tasks ADD CONSTRAINT sales_task_no_answer_channels CHECK (
  CASE WHEN completion_outcome = 'no_answer'
    THEN contacted_by_email OR contacted_by_whatsapp
    ELSE NOT contacted_by_email AND NOT contacted_by_whatsapp
  END
);

-- Contact attempts and sequences started from this page.
ALTER TABLE public.customer_contact_attempts DROP CONSTRAINT IF EXISTS customer_contact_attempts_source_check;
ALTER TABLE public.customer_contact_attempts ADD CONSTRAINT customer_contact_attempts_source_check
  CHECK (source IN ('progression', 'hot_lead', 'followups', 'no_answer', 'sales_tasks'));
ALTER TABLE public.no_answer_sequences DROP CONSTRAINT IF EXISTS no_answer_sequences_source_check;
ALTER TABLE public.no_answer_sequences ADD CONSTRAINT no_answer_sequences_source_check
  CHECK (source IN ('progression', 'hot_lead', 'followups', 'no_answer', 'sales_tasks'));

-- ---------------------------------------------------------------------------
-- Psychiatry and assessment tasks are back on the list. On 19 Oct
-- (20261019120000_sales_tasks_courtney_scope.sql) the ones staff had worked
-- on were closed as "Not on Courtney's list", which would keep those clients
-- off it for the same appointment; reopen them (the untouched ones were
-- deleted and come back with the next run). The next run refreshes them, or
-- closes them if the client has booked since. Hot leads stay Courtney's only.
-- ---------------------------------------------------------------------------
WITH reopened AS (
  UPDATE public.sales_tasks t SET
    status = 'pending',
    completed_at = NULL,
    completed_by = NULL,
    completed_by_email = NULL,
    priority_at_completion = NULL,
    score_at_completion = NULL,
    closed_reason = NULL,
    updated_at = now()
  WHERE t.status = 'auto_closed'
    AND t.closed_reason = 'Not on Courtney''s list'
    AND t.kind IN ('psychiatry', 'assessment')
    AND NOT EXISTS (
      SELECT 1 FROM public.sales_tasks p
      WHERE p.customer_key = t.customer_key AND p.kind = t.kind AND p.status = 'pending'
    )
  RETURNING t.id
)
INSERT INTO public.sales_task_events (task_id, event, details)
SELECT id, 'reopened', jsonb_build_object('reason', 'Psychiatry and assessments back on the list')
FROM reopened;

-- ---------------------------------------------------------------------------
-- Staff actions
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.complete_sales_task(UUID);

CREATE OR REPLACE FUNCTION public.complete_sales_task(
  p_task_id UUID,
  p_outcome TEXT DEFAULT 'completed',
  p_emailed BOOLEAN DEFAULT false,
  p_whatsapped BOOLEAN DEFAULT false
)
RETURNS public.sales_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.sales_tasks%ROWTYPE;
  no_answer BOOLEAN := p_outcome = 'no_answer';
  emailed BOOLEAN := no_answer AND COALESCE(p_emailed, false);
  whatsapped BOOLEAN := no_answer AND COALESCE(p_whatsapped, false);
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('completed', 'no_answer') THEN
    RAISE EXCEPTION 'Unknown outcome' USING ERRCODE = '22023';
  END IF;
  IF no_answer AND NOT (emailed OR whatsapped) THEN
    RAISE EXCEPTION 'Choose Email, WhatsApp or both' USING ERRCODE = '22023';
  END IF;

  UPDATE public.sales_tasks SET
    status = 'completed',
    completed_at = now(),
    completed_by = auth.uid(),
    completed_by_email = auth.jwt() ->> 'email',
    priority_at_completion = priority,
    score_at_completion = score,
    completion_outcome = p_outcome,
    contacted_by_email = emailed,
    contacted_by_whatsapp = whatsapped,
    updated_at = now()
  WHERE id = p_task_id AND status = 'pending'
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This task is no longer open' USING ERRCODE = 'P0002';
  END IF;

  IF no_answer THEN
    -- Stamped and summarised by the contact-attempt triggers, like any other log.
    INSERT INTO public.customer_contact_attempts (
      customer_key, customer_name, customer_phone, outcome, method, note, source
    ) VALUES (
      result.customer_key, result.customer_name, result.customer_phone, 'no_answer', 'call',
      CASE
        WHEN emailed AND whatsapped THEN 'No answer from Sales Tasks; also emailed and sent a WhatsApp'
        WHEN emailed THEN 'No answer from Sales Tasks; also emailed'
        ELSE 'No answer from Sales Tasks; also sent a WhatsApp'
      END,
      'sales_tasks'
    );
  END IF;

  INSERT INTO public.sales_task_events (task_id, event, details, created_by, created_by_email)
  VALUES (
    result.id, 'completed',
    jsonb_build_object(
      'outcome', p_outcome,
      'emailed', emailed,
      'whatsapped', whatsapped,
      'kind', result.kind,
      'priority', result.priority,
      'score', result.score,
      'carried_over_count', result.carried_over_count,
      'days_overdue', GREATEST((now() AT TIME ZONE 'Europe/Dublin')::date - result.due_on, 0)
    ),
    auth.uid(), auth.jwt() ->> 'email'
  );
  RETURN result;
END;
$$;

-- As before, and clears the completion details. A no-answer already logged
-- as a contact attempt stays in the contact history.
CREATE OR REPLACE FUNCTION public.reopen_sales_task(p_task_id UUID)
RETURNS public.sales_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.sales_tasks%ROWTYPE;
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  BEGIN
    UPDATE public.sales_tasks SET
      status = 'pending',
      completed_at = NULL,
      completed_by = NULL,
      completed_by_email = NULL,
      priority_at_completion = NULL,
      score_at_completion = NULL,
      completion_outcome = NULL,
      contacted_by_email = false,
      contacted_by_whatsapp = false,
      updated_at = now()
    WHERE id = p_task_id AND status = 'completed'
    RETURNING * INTO result;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'There is already an open task for this customer' USING ERRCODE = '23505';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only completed tasks can be reopened' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.sales_task_events (task_id, event, created_by, created_by_email)
  VALUES (result.id, 'reopened', auth.uid(), auth.jwt() ->> 'email');
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_sales_task(UUID, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_sales_task(UUID, TEXT, BOOLEAN, BOOLEAN) TO authenticated;

-- Make the API see the new columns and function straight away.
NOTIFY pgrst, 'reload schema';
