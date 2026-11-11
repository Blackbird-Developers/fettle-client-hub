-- Staff activity log: who did what in the admin area, and when.
--
-- admin_activity is one append-only row per staff action. Database triggers
-- fill it from the tables staff already write to, so every route (single and
-- bulk actions, the Sales Tasks page, every other admin page) is caught
-- without changes in the browser:
--
--   sales_task_events          task completed / reopened / due date moved
--   customer_followups         customer note edited, "contacted" changed
--                              (a note saved on a task is logged as a task
--                              note edit, with the task)
--   customer_contact_attempts  contact outcome logged
--   no_answer_sequences        sequence closed or restarted by hand
--   hub_feedback               feedback status changed
--
-- The user-roles function logs admins added/removed, and the sales-tasks
-- function logs "Prepare today's list" runs by staff (both use the service
-- role, so they insert directly).
--
-- Only direct staff actions are logged: knock-on writes made by other
-- triggers (e.g. the customer summary updated after a contact outcome) are
-- skipped with pg_trigger_depth(), and writes with no signed-in user
-- (daily run, migrations, SQL editor) are skipped too.
--
-- Every admin can read it. Nobody can edit or delete log rows from the browser.
--
-- History from before this migration is copied in at the end (tasks,
-- contact outcomes, sequences closed by hand, latest feedback status).
-- Safe to re-run.

-- ---------------------------------------------------------------------------
-- Log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'task.completed', 'task.reopened', 'task.due_moved', 'task.note_edited',
    'tasks.list_prepared',
    'customer.outcome_logged', 'customer.contacted_changed', 'customer.note_edited',
    'sequence.closed', 'sequence.restarted',
    'feedback.status_changed',
    'team.admin_added', 'team.admin_removed'
  )),
  customer_key TEXT CHECK (char_length(customer_key) <= 320),
  customer_name TEXT CHECK (char_length(customer_name) <= 200),
  task_id UUID REFERENCES public.sales_tasks(id) ON DELETE SET NULL,
  -- What changed, e.g. {"from": "2026-11-11", "to": "2026-11-14"}.
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The row this was logged from ("table:id"), so the history copy can be
  -- re-run without duplicates.
  source_ref TEXT UNIQUE,
  -- Lets a task note edit find the customer note row from the same save.
  tx_id BIGINT NOT NULL DEFAULT txid_current()
);

CREATE INDEX IF NOT EXISTS admin_activity_created_idx ON public.admin_activity (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_actor_idx ON public.admin_activity (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_action_idx ON public.admin_activity (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- Who can read the log: admins
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read the activity log" ON public.admin_activity;
CREATE POLICY "Admins can read the activity log"
ON public.admin_activity
FOR SELECT
TO authenticated
USING (public.has_role('admin'));

REVOKE ALL ON public.admin_activity FROM anon, authenticated;
GRANT SELECT ON public.admin_activity TO authenticated;
GRANT ALL ON public.admin_activity TO service_role;

-- ---------------------------------------------------------------------------
-- Writing to the log (triggers only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_admin_activity(
  p_action TEXT,
  p_customer_key TEXT,
  p_customer_name TEXT,
  p_task_id UUID,
  p_details JSONB,
  p_source_ref TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_activity (
    actor_id, actor_email, action, customer_key, customer_name, task_id, details, source_ref
  ) VALUES (
    auth.uid(), auth.jwt() ->> 'email', p_action, p_customer_key, left(p_customer_name, 200),
    p_task_id, COALESCE(p_details, '{}'::jsonb), p_source_ref
  )
  ON CONFLICT (source_ref) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.log_admin_activity(TEXT, TEXT, TEXT, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;

-- Sales tasks: completed, reopened, due date moved. A note saved on a task
-- has already been logged by the customer_followups trigger in the same
-- save; this marks that row as a task note edit and links the task.
CREATE OR REPLACE FUNCTION public.log_sales_task_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.sales_tasks%ROWTYPE;
BEGIN
  IF NEW.created_by IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO task FROM public.sales_tasks WHERE id = NEW.task_id;

  IF NEW.event = 'note_updated' THEN
    UPDATE public.admin_activity SET
      action = 'task.note_edited',
      task_id = NEW.task_id,
      customer_name = COALESCE(customer_name, task.customer_name),
      source_ref = 'sales_task_events:' || NEW.id,
      details = details || jsonb_build_object('kind', task.kind)
    WHERE tx_id = txid_current()
      AND action = 'customer.note_edited'
      AND customer_key = task.customer_key;
    RETURN NULL;
  END IF;

  IF NEW.event NOT IN ('completed', 'reopened', 'follow_up_set') THEN
    RETURN NULL;
  END IF;

  PERFORM public.log_admin_activity(
    CASE NEW.event
      WHEN 'completed' THEN 'task.completed'
      WHEN 'reopened' THEN 'task.reopened'
      ELSE 'task.due_moved'
    END,
    task.customer_key,
    task.customer_name,
    NEW.task_id,
    NEW.details || jsonb_build_object('kind', task.kind),
    'sales_task_events:' || NEW.id
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_sales_task_event ON public.sales_task_events;
CREATE TRIGGER log_sales_task_event
  AFTER INSERT ON public.sales_task_events
  FOR EACH ROW
  EXECUTE FUNCTION public.log_sales_task_event();

-- Customer note and "contacted". Only direct saves: the contact-outcome
-- trigger also writes this table (depth 2), and that's logged as the outcome.
CREATE OR REPLACE FUNCTION public.log_customer_followup_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_note TEXT := CASE WHEN TG_OP = 'UPDATE' THEN OLD.note END;
  old_contacted BOOLEAN := CASE WHEN TG_OP = 'UPDATE' THEN OLD.contacted ELSE false END;
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF NEW.note IS DISTINCT FROM old_note THEN
    PERFORM public.log_admin_activity(
      'customer.note_edited', NEW.customer_key, NEW.customer_name, NULL,
      jsonb_build_object('from', old_note, 'to', NEW.note), NULL
    );
  END IF;
  IF NEW.contacted IS DISTINCT FROM old_contacted THEN
    PERFORM public.log_admin_activity(
      'customer.contacted_changed', NEW.customer_key, NEW.customer_name, NULL,
      jsonb_build_object('from', old_contacted, 'to', NEW.contacted), NULL
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_customer_followup_change ON public.customer_followups;
CREATE TRIGGER log_customer_followup_change
  AFTER INSERT OR UPDATE ON public.customer_followups
  FOR EACH ROW
  EXECUTE FUNCTION public.log_customer_followup_change();

-- Contact outcomes. A "No answer" from Sales Tasks is already in the log as
-- the task's completion, so it isn't logged twice.
CREATE OR REPLACE FUNCTION public.log_customer_contact_attempt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.created_by IS NULL
     OR NEW.source IS NOT DISTINCT FROM 'sales_tasks' THEN
    RETURN NULL;
  END IF;

  PERFORM public.log_admin_activity(
    'customer.outcome_logged', NEW.customer_key, NEW.customer_name, NULL,
    jsonb_strip_nulls(jsonb_build_object(
      'outcome', NEW.outcome,
      'method', NEW.method,
      'note', NEW.note,
      'reasons', to_jsonb(NEW.reasons),
      'reason_other', NEW.reason_other,
      'attempt_number', NEW.attempt_number,
      'source', NEW.source
    )),
    'customer_contact_attempts:' || NEW.id
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_customer_contact_attempt ON public.customer_contact_attempts;
CREATE TRIGGER log_customer_contact_attempt
  AFTER INSERT ON public.customer_contact_attempts
  FOR EACH ROW
  EXECUTE FUNCTION public.log_customer_contact_attempt();

-- No-answer sequences closed or restarted by hand (close_no_answer_sequence /
-- restart_no_answer_sequence). Sequences moved on by a contact outcome are
-- written from a trigger (depth 2) and skipped.
CREATE OR REPLACE FUNCTION public.log_no_answer_sequence_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_admin_activity(
      'sequence.restarted', NEW.customer_key, NEW.customer_name, NULL, '{}'::jsonb,
      'no_answer_sequences:' || NEW.id || ':restarted'
    );
  ELSIF NEW.status = 'closed' AND OLD.status = 'active' THEN
    PERFORM public.log_admin_activity(
      'sequence.closed', NEW.customer_key, NEW.customer_name, NULL,
      jsonb_build_object('reason', NEW.closed_reason, 'attempts_done', NEW.attempts_done),
      'no_answer_sequences:' || NEW.id || ':closed'
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_no_answer_sequence_change ON public.no_answer_sequences;
CREATE TRIGGER log_no_answer_sequence_change
  AFTER INSERT OR UPDATE ON public.no_answer_sequences
  FOR EACH ROW
  EXECUTE FUNCTION public.log_no_answer_sequence_change();

-- Feedback status (New / Read / Actioned).
CREATE OR REPLACE FUNCTION public.log_hub_feedback_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  PERFORM public.log_admin_activity(
    'feedback.status_changed',
    CASE WHEN NEW.sender_email IS NOT NULL THEN 'email:' || lower(NEW.sender_email) END,
    NEW.sender_name, NULL,
    jsonb_build_object('from', OLD.status, 'to', NEW.status, 'feedback_id', NEW.id, 'category', NEW.category),
    NULL
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS log_hub_feedback_status ON public.hub_feedback;
CREATE TRIGGER log_hub_feedback_status
  AFTER UPDATE ON public.hub_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.log_hub_feedback_status();

-- ---------------------------------------------------------------------------
-- Reading the log (admins only)
-- ---------------------------------------------------------------------------
-- Per staff member, for the summary strip on the page.
CREATE OR REPLACE FUNCTION public.admin_activity_summary(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS TABLE (
  actor_email TEXT,
  total BIGINT,
  tasks_completed BIGINT,
  outcomes_logged BIGINT,
  notes_edited BIGINT,
  last_active TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(a.actor_email, 'unknown'),
    count(*),
    count(*) FILTER (WHERE a.action = 'task.completed'),
    count(*) FILTER (WHERE a.action = 'customer.outcome_logged'),
    count(*) FILTER (WHERE a.action IN ('task.note_edited', 'customer.note_edited')),
    max(a.created_at)
  FROM public.admin_activity a
  WHERE a.created_at >= p_from AND a.created_at < p_to
  GROUP BY 1
  ORDER BY 2 DESC;
END;
$$;

-- Everyone who appears in the log, for the staff filter.
CREATE OR REPLACE FUNCTION public.admin_activity_actors()
RETURNS TABLE (actor_email TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role('admin') THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT DISTINCT a.actor_email FROM public.admin_activity a
  WHERE a.actor_email IS NOT NULL
  ORDER BY 1;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_activity_summary(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_activity_actors() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_activity_summary(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_actors() TO authenticated;

-- ---------------------------------------------------------------------------
-- History from before the log existed
-- ---------------------------------------------------------------------------
INSERT INTO public.admin_activity (
  created_at, actor_id, actor_email, action, customer_key, customer_name, task_id, details, source_ref
)
SELECT
  e.created_at, e.created_by, e.created_by_email,
  CASE e.event
    WHEN 'completed' THEN 'task.completed'
    WHEN 'reopened' THEN 'task.reopened'
    WHEN 'follow_up_set' THEN 'task.due_moved'
    ELSE 'task.note_edited'
  END,
  t.customer_key, t.customer_name, e.task_id,
  e.details || jsonb_build_object('kind', t.kind),
  'sales_task_events:' || e.id
FROM public.sales_task_events e
JOIN public.sales_tasks t ON t.id = e.task_id
WHERE e.created_by IS NOT NULL
  AND e.event IN ('completed', 'reopened', 'follow_up_set', 'note_updated')
ON CONFLICT (source_ref) DO NOTHING;

INSERT INTO public.admin_activity (
  created_at, actor_id, actor_email, action, customer_key, customer_name, details, source_ref
)
SELECT
  a.created_at, a.created_by, a.created_by_email, 'customer.outcome_logged',
  a.customer_key, a.customer_name,
  jsonb_strip_nulls(jsonb_build_object(
    'outcome', a.outcome,
    'method', a.method,
    'note', a.note,
    'reasons', to_jsonb(a.reasons),
    'reason_other', a.reason_other,
    'attempt_number', a.attempt_number,
    'source', a.source
  )),
  'customer_contact_attempts:' || a.id
FROM public.customer_contact_attempts a
WHERE a.created_by IS NOT NULL
  AND a.source IS DISTINCT FROM 'sales_tasks'
ON CONFLICT (source_ref) DO NOTHING;

INSERT INTO public.admin_activity (
  created_at, actor_id, actor_email, action, customer_key, customer_name, details, source_ref
)
SELECT
  s.closed_at, s.closed_by, s.closed_by_email, 'sequence.closed',
  s.customer_key, s.customer_name,
  jsonb_build_object('reason', s.closed_reason, 'attempts_done', s.attempts_done),
  'no_answer_sequences:' || s.id || ':closed'
FROM public.no_answer_sequences s
WHERE s.status = 'closed' AND s.closed_by IS NOT NULL
ON CONFLICT (source_ref) DO NOTHING;

-- Only the latest status change is stored on feedback, so that's all we have.
INSERT INTO public.admin_activity (
  created_at, actor_email, action, customer_key, customer_name, details, source_ref
)
SELECT
  f.status_updated_at, f.status_updated_by_email, 'feedback.status_changed',
  CASE WHEN f.sender_email IS NOT NULL THEN 'email:' || lower(f.sender_email) END,
  f.sender_name,
  jsonb_build_object('to', f.status, 'feedback_id', f.id, 'category', f.category),
  'hub_feedback:' || f.id || ':history'
FROM public.hub_feedback f
WHERE f.status_updated_at IS NOT NULL AND f.status_updated_by_email IS NOT NULL
  -- Already logged live (this migration re-run later).
  AND NOT EXISTS (
    SELECT 1 FROM public.admin_activity a
    WHERE a.action = 'feedback.status_changed' AND a.details ->> 'feedback_id' = f.id::text
  )
ON CONFLICT (source_ref) DO NOTHING;

-- Make the API see the new table and functions straight away.
NOTIFY pgrst, 'reload schema';
