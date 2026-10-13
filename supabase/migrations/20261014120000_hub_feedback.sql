-- General feedback about the hub, sent by logged-in clients from the
-- Feedback page and read by staff on the admin Feedback page.
--
-- Kept separate from therapist_reviews on purpose: those are tied to a
-- specific Acuity appointment and written by an edge function, while this is
-- general feedback that isn't about any one session, so clients insert it
-- directly and RLS is enough.
--
-- Admins can't read profiles, so the sender's name and email are copied onto
-- the row when it's sent. Safe to re-run.
CREATE TABLE IF NOT EXISTS public.hub_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN ('hub_experience', 'accessibility', 'therapist', 'psychiatry', 'other')),
  message TEXT NOT NULL CHECK (char_length(btrim(message)) BETWEEN 1 AND 4000),
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  -- Where in the hub they were before opening the Feedback page.
  page TEXT CHECK (char_length(page) <= 200),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'actioned')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- Stamped by the trigger below, never taken from the request.
  sender_email TEXT,
  sender_name TEXT,
  status_updated_at TIMESTAMP WITH TIME ZONE,
  status_updated_by_email TEXT
);

CREATE INDEX IF NOT EXISTS hub_feedback_created_idx ON public.hub_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS hub_feedback_status_idx ON public.hub_feedback (status);

-- On insert: sender details come from the caller's session and a new row is
-- always "new". On update: only the status can change, and who changed it
-- and when are stamped from the caller's session.
CREATE OR REPLACE FUNCTION public.stamp_hub_feedback()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.message := btrim(NEW.message);
    NEW.page := NULLIF(btrim(NEW.page), '');
    NEW.status := 'new';
    NEW.created_at := now();
    NEW.sender_email := auth.jwt() ->> 'email';
    NEW.sender_name := (
      SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
      FROM public.profiles p
      WHERE p.user_id = NEW.user_id
      LIMIT 1
    );
    NEW.status_updated_at := NULL;
    NEW.status_updated_by_email := NULL;
    RETURN NEW;
  END IF;

  NEW.id := OLD.id;
  NEW.user_id := OLD.user_id;
  NEW.category := OLD.category;
  NEW.message := OLD.message;
  NEW.rating := OLD.rating;
  NEW.page := OLD.page;
  NEW.created_at := OLD.created_at;
  NEW.sender_email := OLD.sender_email;
  NEW.sender_name := OLD.sender_name;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_updated_at := now();
    NEW.status_updated_by_email := auth.jwt() ->> 'email';
  ELSE
    NEW.status_updated_at := OLD.status_updated_at;
    NEW.status_updated_by_email := OLD.status_updated_by_email;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_hub_feedback ON public.hub_feedback;
CREATE TRIGGER stamp_hub_feedback
  BEFORE INSERT OR UPDATE ON public.hub_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_hub_feedback();

-- Enable Row Level Security
ALTER TABLE public.hub_feedback ENABLE ROW LEVEL SECURITY;

-- Clients can send feedback as themselves only. There's no client SELECT
-- policy, so they can't read anything back (including their own).
DROP POLICY IF EXISTS "Users can send their own hub feedback" ON public.hub_feedback;
CREATE POLICY "Users can send their own hub feedback"
ON public.hub_feedback
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Admins read everything and move it through new → read → actioned.
-- No delete policy: feedback is never removed from the browser.
--
-- Checks user_roles directly rather than calling has_role(), because some
-- databases only have has_role('admin') and others only
-- has_role(uuid, app_role). role::text works whether role is TEXT or the
-- app_role enum, and users can always read their own user_roles rows.
DROP POLICY IF EXISTS "Admins can view hub feedback" ON public.hub_feedback;
CREATE POLICY "Admins can view hub feedback"
ON public.hub_feedback
FOR SELECT
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'));

DROP POLICY IF EXISTS "Admins can update hub feedback" ON public.hub_feedback;
CREATE POLICY "Admins can update hub feedback"
ON public.hub_feedback
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'));

REVOKE DELETE ON public.hub_feedback FROM anon, authenticated;

-- Make the API see the new table straight away.
NOTIFY pgrst, 'reload schema';
