-- Sales tasks: the admin "Sales Tasks" page, a daily prioritised call list
-- for Courtney built from hot leads, assessment clients who need their next
-- step booked, and psychiatry clients due a follow-up call.
--
-- The sales-tasks edge function prepares the list every morning (GitHub
-- Action) or when staff press "Prepare today's list":
--   - a new task for each qualifying customer who doesn't already have one
--     for the same event (dedupe_key), so re-running never duplicates
--   - unfinished tasks from earlier days stay pending and are marked carried over
--   - priorities are re-scored; tasks whose lead has since booked are closed
--     automatically (status auto_closed, with the reason)
-- Completed and auto-closed tasks never return: their dedupe_key stays taken.
--
-- sales_task_events is an append-only log of everything that happens to a
-- task, for reporting later. It isn't shown on the page.
--
-- Admins read; only the edge function (service role) and the staff actions
-- below write. Safe to re-run.

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- kind + customer + the Acuity event that triggered the task. Unique across
  -- every status, so a finished task can't come back for the same event.
  dedupe_key TEXT NOT NULL UNIQUE CHECK (char_length(dedupe_key) <= 400),
  customer_key TEXT NOT NULL
    CHECK (customer_key ~ '^(email|phone|appointment):.+' AND char_length(customer_key) <= 320),
  kind TEXT NOT NULL CHECK (kind IN ('hot_lead', 'assessment', 'psychiatry')),

  -- Snapshot of what the platform knew, refreshed by each daily run while
  -- the task is pending.
  customer_name TEXT CHECK (char_length(customer_name) <= 200),
  customer_email TEXT CHECK (char_length(customer_email) <= 320),
  customer_phone TEXT CHECK (char_length(customer_phone) <= 50),
  -- The Acuity event behind the task (lead event / last assessment step /
  -- last psychiatry appointment) and its appointment type.
  trigger_at TIMESTAMP WITH TIME ZONE NOT NULL,
  service_type TEXT CHECK (char_length(service_type) <= 200),
  -- Whose calendar the event was on.
  owner TEXT CHECK (char_length(owner) <= 200),
  -- Status on its source page, e.g. "open", "needs_booking", "overdue".
  lead_status TEXT CHECK (char_length(lead_status) <= 50),
  -- Why the task exists, in a sentence, plus the scored reasons behind its
  -- priority ([{label, points}]).
  reason TEXT NOT NULL CHECK (char_length(reason) <= 500),
  priority_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_action TEXT CHECK (char_length(next_action) <= 300),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'auto_closed')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  score INTEGER NOT NULL,

  -- Analytics: when, why and with what priority it started.
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_on DATE NOT NULL,
  priority_at_creation TEXT NOT NULL CHECK (priority_at_creation IN ('high', 'medium', 'low')),
  score_at_creation INTEGER NOT NULL,
  original_due_on DATE NOT NULL,
  -- Current due date; staff move it with "Follow up on".
  due_on DATE NOT NULL,
  -- Days the task was still open at a morning run after its due date.
  carried_over_count INTEGER NOT NULL DEFAULT 0 CHECK (carried_over_count >= 0),
  last_carried_on DATE,

  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_by_email TEXT,
  priority_at_completion TEXT CHECK (priority_at_completion IN ('high', 'medium', 'low')),
  score_at_completion INTEGER,
  -- Seconds from creation to completion (or auto-close).
  seconds_to_complete INTEGER
    GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (completed_at - created_at))::INTEGER) STORED,
  closed_reason TEXT CHECK (char_length(closed_reason) <= 500),

  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),

  CONSTRAINT sales_task_completion_valid CHECK (
    (status = 'pending') = (completed_at IS NULL)
  )
);

-- At most one pending task per customer and kind: a newer event updates the
-- open task instead of adding a second one.
CREATE UNIQUE INDEX IF NOT EXISTS sales_tasks_one_pending
  ON public.sales_tasks (customer_key, kind) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS sales_tasks_status_due_idx
  ON public.sales_tasks (status, due_on);
CREATE INDEX IF NOT EXISTS sales_tasks_completed_idx
  ON public.sales_tasks (completed_at DESC) WHERE status <> 'pending';

-- ---------------------------------------------------------------------------
-- Event log (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_task_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.sales_tasks(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN (
    'created', 'carried_over', 'priority_changed', 'context_updated',
    'note_updated', 'follow_up_set', 'completed', 'reopened', 'auto_closed'
  )),
  -- Details for reporting, e.g. {"from": "medium", "to": "high"}.
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Null for the daily run.
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email TEXT
);

CREATE INDEX IF NOT EXISTS sales_task_events_task_idx
  ON public.sales_task_events (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Daily runs: one row per day (Irish date), updated by every run that day.
-- Lets the page show when the list was last prepared, and stops two runs
-- overlapping.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_task_runs (
  run_on DATE PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  finished_at TIMESTAMP WITH TIME ZONE,
  -- "cron" or the admin's email.
  triggered_by TEXT,
  runs_today INTEGER NOT NULL DEFAULT 1,
  -- Counts only (created, carried over, closed…), never client data.
  summary JSONB,
  error TEXT CHECK (char_length(error) <= 500)
);

-- ---------------------------------------------------------------------------
-- Staff actions (admins only; who/when come from the caller's session).
-- Each one logs an event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_sales_task(p_task_id UUID)
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

  UPDATE public.sales_tasks SET
    status = 'completed',
    completed_at = now(),
    completed_by = auth.uid(),
    completed_by_email = auth.jwt() ->> 'email',
    priority_at_completion = priority,
    score_at_completion = score,
    updated_at = now()
  WHERE id = p_task_id AND status = 'pending'
  RETURNING * INTO result;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This task is no longer open' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.sales_task_events (task_id, event, details, created_by, created_by_email)
  VALUES (
    result.id, 'completed',
    jsonb_build_object(
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

-- Undo for a task completed by mistake. Only a task completed by staff, and
-- only while no newer pending task exists for the same customer and kind.
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

-- Moves the task to a later day ("Follow up on"). It leaves today's list and
-- comes back on that date. Today is allowed too (brings a task forward).
CREATE OR REPLACE FUNCTION public.set_sales_task_due(p_task_id UUID, p_due_on DATE)
RETURNS public.sales_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result public.sales_tasks%ROWTYPE;
  previous DATE;
  today DATE := (now() AT TIME ZONE 'Europe/Dublin')::date;
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_due_on IS NULL OR p_due_on < today THEN
    RAISE EXCEPTION 'Choose today or a later date' USING ERRCODE = '22023';
  END IF;
  IF p_due_on > today + 365 THEN
    RAISE EXCEPTION 'Choose a date within the next year' USING ERRCODE = '22023';
  END IF;

  SELECT due_on INTO previous FROM public.sales_tasks
  WHERE id = p_task_id AND status = 'pending'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This task is no longer open' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.sales_tasks SET due_on = p_due_on, updated_at = now()
  WHERE id = p_task_id
  RETURNING * INTO result;

  INSERT INTO public.sales_task_events (task_id, event, details, created_by, created_by_email)
  VALUES (
    result.id, 'follow_up_set',
    jsonb_build_object('from', previous, 'to', p_due_on),
    auth.uid(), auth.jwt() ->> 'email'
  );
  RETURN result;
END;
$$;

-- Saves the customer's note (the same note the other admin pages show, on
-- customer_followups) and logs it against the task. The customer_followups
-- trigger stamps who/when from the caller's session.
CREATE OR REPLACE FUNCTION public.update_sales_task_note(p_task_id UUID, p_note TEXT)
RETURNS public.customer_followups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.sales_tasks%ROWTYPE;
  result public.customer_followups%ROWTYPE;
  note TEXT := NULLIF(btrim(p_note), '');
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF char_length(note) > 2000 THEN
    RAISE EXCEPTION 'The note can be up to 2000 characters' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO task FROM public.sales_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.customer_followups AS f (customer_key, note)
  VALUES (task.customer_key, note)
  ON CONFLICT (customer_key) DO UPDATE SET note = EXCLUDED.note
  RETURNING * INTO result;

  INSERT INTO public.sales_task_events (task_id, event, details, created_by, created_by_email)
  VALUES (
    task.id, 'note_updated',
    jsonb_build_object('length', COALESCE(char_length(note), 0)),
    auth.uid(), auth.jwt() ->> 'email'
  );
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_sales_task(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_sales_task(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_sales_task_due(UUID, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_sales_task_note(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_sales_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_sales_task(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_sales_task_due(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sales_task_note(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Access: admins read; the browser never writes these tables directly.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_task_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view sales tasks" ON public.sales_tasks;
CREATE POLICY "Admins can view sales tasks"
ON public.sales_tasks
FOR SELECT
USING (public.has_role('admin'));

DROP POLICY IF EXISTS "Admins can view sales task events" ON public.sales_task_events;
CREATE POLICY "Admins can view sales task events"
ON public.sales_task_events
FOR SELECT
USING (public.has_role('admin'));

DROP POLICY IF EXISTS "Admins can view sales task runs" ON public.sales_task_runs;
CREATE POLICY "Admins can view sales task runs"
ON public.sales_task_runs
FOR SELECT
USING (public.has_role('admin'));

REVOKE INSERT, UPDATE, DELETE ON public.sales_tasks FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sales_task_events FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sales_task_runs FROM anon, authenticated;

-- Make the API see the new tables and functions straight away.
NOTIFY pgrst, 'reload schema';
