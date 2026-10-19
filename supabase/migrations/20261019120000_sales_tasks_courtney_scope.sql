-- Sales tasks: keep the list to Courtney's own tasks.
--
-- The first run (19 Oct) made tasks for every hot lead, assessment client and
-- psychiatry follow-up on every calendar. The sales-tasks function now only
-- makes hot-lead tasks for events on Courtney's calendar (SALES_TASK_CALENDARS
-- / SALES_TASK_KINDS in supabase/functions/sales-tasks/logic.ts); this tidies
-- the tasks already saved to match. Deploy the function first, then run this.
--
-- 1. Open tasks outside Courtney's list that nobody has worked on are deleted
--    (their events go with them), not closed: a closed task blocks its event
--    for good, so if her list is widened later they come back on their own.
--    Notes are unaffected — they live on customer_followups, not on tasks.
-- 2. Open tasks outside her list that staff did touch (note, follow-up date,
--    reopened) are closed with a reason instead, so that history stays.
-- 3. Tasks made today aren't "carried over" yet: undo the carry-over a
--    second run on the day of creation counted.
--
-- Safe to re-run.

-- Outside Courtney's list: not a hot lead, or not on her calendar.
DROP TABLE IF EXISTS pg_temp.sales_tasks_out_of_scope;
CREATE TEMP TABLE sales_tasks_out_of_scope AS
SELECT t.id,
       EXISTS (
         SELECT 1 FROM public.sales_task_events e
         WHERE e.task_id = t.id
           AND e.event IN ('note_updated', 'follow_up_set', 'reopened')
       ) AS touched
FROM public.sales_tasks t
WHERE t.status = 'pending'
  AND (t.kind <> 'hot_lead' OR coalesce(lower(t.owner), '') NOT LIKE '%courtney%');

-- 1. Untouched: delete (sales_task_events cascade).
DELETE FROM public.sales_tasks
WHERE id IN (SELECT id FROM sales_tasks_out_of_scope WHERE NOT touched);

-- 2. Touched: close, with the reason logged.
WITH closed AS (
  UPDATE public.sales_tasks t
  SET status = 'auto_closed',
      completed_at = now(),
      closed_reason = 'Not on Courtney''s list',
      priority_at_completion = t.priority,
      score_at_completion = t.score,
      updated_at = now()
  WHERE t.id IN (SELECT id FROM sales_tasks_out_of_scope WHERE touched)
    AND t.status = 'pending'
  RETURNING t.id, t.priority
)
INSERT INTO public.sales_task_events (task_id, event, details)
SELECT id, 'auto_closed', jsonb_build_object('reason', 'Not on Courtney''s list', 'priority', priority)
FROM closed;

-- 3. Carry-overs counted on the day the task was made.
DELETE FROM public.sales_task_events e
USING public.sales_tasks t
WHERE e.task_id = t.id
  AND e.event = 'carried_over'
  AND (e.created_at AT TIME ZONE 'Europe/Dublin')::date = t.created_on;

UPDATE public.sales_tasks
SET carried_over_count = 0,
    last_carried_on = NULL,
    updated_at = now()
WHERE last_carried_on = created_on;

DROP TABLE IF EXISTS pg_temp.sales_tasks_out_of_scope;
