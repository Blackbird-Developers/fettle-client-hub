-- Notifications for staff, shown under the bell in the admin dashboard.
--
-- Written only by edge functions (service role), never by clients: the first
-- one is "a client couldn't use their bundle code" from redeem-package-code.
-- Kept general (kind + title + body + details) so other admin features can
-- post here later.
--
-- dedupe_key stops a client who retries the same failing code from flooding
-- the list: writers insert with ON CONFLICT (dedupe_key) DO NOTHING, so only
-- the first occurrence is recorded (redeem-package-code also only emails
-- staff when a new row was saved). Safe to re-run.
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  kind TEXT NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
  dedupe_key TEXT UNIQUE CHECK (char_length(dedupe_key) <= 300),
  -- The client the notification is about, if any. Name and email are copied
  -- on because admins can't read profiles.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  client_email TEXT,
  client_name TEXT,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  body TEXT CHECK (char_length(body) <= 2000),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMP WITH TIME ZONE,
  read_by_email TEXT
);

CREATE INDEX IF NOT EXISTS admin_notifications_created_idx ON public.admin_notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_unread_idx ON public.admin_notifications (created_at DESC) WHERE read_at IS NULL;

-- Admins may only mark a notification read or unread; who did it is stamped
-- from their session.
CREATE OR REPLACE FUNCTION public.stamp_admin_notification_read()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;
  NEW.kind := OLD.kind;
  NEW.dedupe_key := OLD.dedupe_key;
  NEW.user_id := OLD.user_id;
  NEW.client_email := OLD.client_email;
  NEW.client_name := OLD.client_name;
  NEW.title := OLD.title;
  NEW.body := OLD.body;
  NEW.details := OLD.details;

  IF NEW.read_at IS NULL THEN
    NEW.read_by_email := NULL;
  ELSIF OLD.read_at IS NULL THEN
    NEW.read_at := now();
    NEW.read_by_email := auth.jwt() ->> 'email';
  ELSE
    NEW.read_at := OLD.read_at;
    NEW.read_by_email := OLD.read_by_email;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_admin_notification_read ON public.admin_notifications;
CREATE TRIGGER stamp_admin_notification_read
  BEFORE UPDATE ON public.admin_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_admin_notification_read();

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Admins read and mark read. No insert or delete policy: only the service
-- role writes, and notifications are never removed from the browser.
-- Checks user_roles directly for the same reason as hub_feedback.
DROP POLICY IF EXISTS "Admins can view admin notifications" ON public.admin_notifications;
CREATE POLICY "Admins can view admin notifications"
ON public.admin_notifications
FOR SELECT
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'));

DROP POLICY IF EXISTS "Admins can mark admin notifications read" ON public.admin_notifications;
CREATE POLICY "Admins can mark admin notifications read"
ON public.admin_notifications
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'));

REVOKE INSERT, DELETE ON public.admin_notifications FROM anon, authenticated;

-- Make the API see the new table straight away.
NOTIFY pgrst, 'reload schema';
