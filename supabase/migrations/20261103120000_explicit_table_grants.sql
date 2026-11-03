-- Explicit GRANTs for every public table added since October 2026.
--
-- New public tables no longer get default privileges, so each one states
-- them here: service_role ALL, authenticated only what the browser uses
-- (RLS still limits that to admins or to the user's own rows), anon nothing.
-- Writes that go through SECURITY DEFINER functions (sales tasks, no-answer
-- sequences) or edge functions need no grant for authenticated.
--
-- admin_notifications is covered in 20261030120000_admin_notifications.sql.
--
-- Safe to re-run.

-- Admin follow-ups: admins read, and save "contacted" and notes (upsert).
REVOKE ALL ON public.customer_followups FROM anon, authenticated;
GRANT ALL ON public.customer_followups TO service_role;
GRANT SELECT ON public.customer_followups TO authenticated;
GRANT INSERT (customer_key, contacted, note) ON public.customer_followups TO authenticated;
GRANT UPDATE (customer_key, contacted, note) ON public.customer_followups TO authenticated;

-- Contact outcomes: admins read and add rows. A trigger stamps who and when.
REVOKE ALL ON public.customer_contact_attempts FROM anon, authenticated;
GRANT ALL ON public.customer_contact_attempts TO service_role;
GRANT SELECT, INSERT ON public.customer_contact_attempts TO authenticated;

-- Portal adoption emails: admins read; only the edge function writes.
REVOKE ALL ON public.email_sends FROM anon, authenticated;
REVOKE ALL ON public.email_suppressions FROM anon, authenticated;
GRANT ALL ON public.email_sends TO service_role;
GRANT ALL ON public.email_suppressions TO service_role;
GRANT SELECT ON public.email_sends TO authenticated;
GRANT SELECT ON public.email_suppressions TO authenticated;

-- No-answer sequences: admins read; writes go through the RPCs.
REVOKE ALL ON public.no_answer_sequences FROM anon, authenticated;
GRANT ALL ON public.no_answer_sequences TO service_role;
GRANT SELECT ON public.no_answer_sequences TO authenticated;

-- Hub feedback: clients send it, admins read it and change only the status.
-- The trigger fills in everything else.
REVOKE ALL ON public.hub_feedback FROM anon, authenticated;
GRANT ALL ON public.hub_feedback TO service_role;
GRANT SELECT ON public.hub_feedback TO authenticated;
GRANT INSERT (user_id, category, message, rating, page) ON public.hub_feedback TO authenticated;
GRANT UPDATE (status) ON public.hub_feedback TO authenticated;

-- Sales tasks: admins read; writes go through the RPCs and the edge function.
REVOKE ALL ON public.sales_tasks FROM anon, authenticated;
REVOKE ALL ON public.sales_task_events FROM anon, authenticated;
REVOKE ALL ON public.sales_task_runs FROM anon, authenticated;
GRANT ALL ON public.sales_tasks TO service_role;
GRANT ALL ON public.sales_task_events TO service_role;
GRANT ALL ON public.sales_task_runs TO service_role;
GRANT SELECT ON public.sales_tasks TO authenticated;
GRANT SELECT ON public.sales_task_events TO authenticated;
GRANT SELECT ON public.sales_task_runs TO authenticated;

-- Service-role only: they hold client details and are never read from the
-- browser. The edge functions read them after their own admin check.
REVOKE ALL ON public.admin_snapshots FROM anon, authenticated;
REVOKE ALL ON public.acuity_appointments FROM anon, authenticated;
REVOKE ALL ON public.acuity_sync_state FROM anon, authenticated;
GRANT ALL ON public.admin_snapshots TO service_role;
GRANT ALL ON public.acuity_appointments TO service_role;
GRANT ALL ON public.acuity_sync_state TO service_role;

NOTIFY pgrst, 'reload schema';
