-- Live chat between visitors on fettle.ie and staff in the admin Inbox
-- (docs/LIVE_CHAT.md).
--
-- Visitors aren't logged in, so they never touch these tables: the website
-- widget talks to the chat-visitor edge function, which writes with the
-- service role after checking the visitor's secret. Staff read and reply
-- straight from the browser; RLS limits that to admins.
--
--   chat_conversations         one row per visitor conversation
--   chat_messages              the messages in it
--   chat_conversation_secrets  the visitor's secret (hashed) and a hashed IP
--                              for rate limiting; service role only, so staff
--                              sessions can't read them
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Random name of the Realtime broadcast channel for this conversation.
  -- The visitor and the admin who has it open both join it, for "new
  -- message" pings and typing indicators. It carries no message text.
  realtime_topic TEXT NOT NULL UNIQUE CHECK (char_length(realtime_topic) BETWEEN 16 AND 80),
  -- What the visitor told us, if anything.
  visitor_name TEXT CHECK (char_length(visitor_name) <= 100),
  visitor_email TEXT CHECK (char_length(visitor_email) <= 200),
  visitor_phone TEXT CHECK (char_length(visitor_phone) <= 40),
  -- True when the chat was started outside working hours, from the widget's
  -- "leave your details" form.
  started_offline BOOLEAN NOT NULL DEFAULT false,
  -- Where they started the chat.
  page_url TEXT CHECK (char_length(page_url) <= 500),
  page_title TEXT CHECK (char_length(page_title) <= 200),
  referrer TEXT CHECK (char_length(referrer) <= 500),
  user_agent TEXT CHECK (char_length(user_agent) <= 400),
  -- The admin looking after it.
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to_email TEXT CHECK (char_length(assigned_to_email) <= 200),
  -- Kept up to date by the message trigger, so the list needs no joins.
  last_message_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_message_preview TEXT,
  last_message_sender TEXT,
  admin_unread_count INTEGER NOT NULL DEFAULT 0 CHECK (admin_unread_count >= 0),
  visitor_last_read_at TIMESTAMP WITH TIME ZONE,
  closed_at TIMESTAMP WITH TIME ZONE,
  closed_by_email TEXT
);

-- Added after the first draft; does nothing on a fresh database.
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS visitor_phone TEXT CHECK (char_length(visitor_phone) <= 40),
  ADD COLUMN IF NOT EXISTS started_offline BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS chat_conversations_last_message_idx
  ON public.chat_conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS chat_conversations_status_idx
  ON public.chat_conversations (status, last_message_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_conversation_secrets (
  conversation_id UUID PRIMARY KEY REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- SHA-256 of the secret the widget keeps in the visitor's browser.
  secret_hash TEXT NOT NULL,
  -- SHA-256 of the visitor's IP, only used to limit new chats per IP.
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS chat_conversation_secrets_ip_idx
  ON public.chat_conversation_secrets (ip_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sender TEXT NOT NULL DEFAULT 'admin' CHECK (sender IN ('visitor', 'admin', 'system')),
  -- Set for admin messages; the name is what the visitor sees.
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name TEXT CHECK (char_length(sender_name) <= 100),
  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
  -- Id made up by the sender's browser, so a resent message is stored once.
  client_id TEXT CHECK (char_length(client_id) <= 64),
  UNIQUE (conversation_id, client_id)
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx
  ON public.chat_messages (conversation_id, created_at);

-- Messages sent from a staff session are always "admin" messages from that
-- person, whatever the request says. The service role (the chat-visitor
-- function) has no user, so its sender is kept as given.
CREATE OR REPLACE FUNCTION public.stamp_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.body := btrim(NEW.body);
  NEW.created_at := now();
  IF auth.uid() IS NOT NULL THEN
    NEW.sender := 'admin';
    NEW.sender_user_id := auth.uid();
    NEW.sender_name := COALESCE(
      (
        SELECT NULLIF(btrim(p.first_name), '')
        FROM public.profiles p
        WHERE p.user_id = auth.uid()
        LIMIT 1
      ),
      'Fettle team'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_chat_message ON public.chat_messages;
CREATE TRIGGER stamp_chat_message
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_chat_message();

-- Keeps the conversation's summary in step with its messages:
--   visitor message: one more unread for staff, and a closed chat reopens
--   admin message:   staff have read it, and an unassigned chat goes to
--                    whoever replied
--   system message:  (e.g. the out-of-hours note) changes nothing, so the
--                    list keeps showing what the visitor wrote
-- SECURITY DEFINER because staff may only update a few columns themselves.
CREATE OR REPLACE FUNCTION public.apply_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sender = 'system' THEN
    RETURN NULL;
  END IF;

  UPDATE public.chat_conversations c
  SET
    last_message_at = NEW.created_at,
    last_message_preview = left(NEW.body, 160),
    last_message_sender = NEW.sender,
    admin_unread_count = CASE
      WHEN NEW.sender = 'visitor' THEN c.admin_unread_count + 1
      WHEN NEW.sender = 'admin' THEN 0
      ELSE c.admin_unread_count
    END,
    status = CASE WHEN NEW.sender = 'visitor' THEN 'open' ELSE c.status END,
    assigned_to = CASE
      WHEN NEW.sender = 'admin' AND c.assigned_to IS NULL THEN NEW.sender_user_id
      ELSE c.assigned_to
    END,
    assigned_to_email = CASE
      WHEN NEW.sender = 'admin' AND c.assigned_to IS NULL THEN auth.jwt() ->> 'email'
      ELSE c.assigned_to_email
    END
  WHERE c.id = NEW.conversation_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS apply_chat_message ON public.chat_messages;
CREATE TRIGGER apply_chat_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_chat_message();

-- Stamps who closed a conversation and when, and clears that when it
-- reopens. Fields a conversation is created with never change.
CREATE OR REPLACE FUNCTION public.stamp_chat_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;
  NEW.realtime_topic := OLD.realtime_topic;
  NEW.updated_at := now();

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'closed' THEN
      NEW.closed_at := now();
      NEW.closed_by_email := auth.jwt() ->> 'email';
    ELSE
      NEW.closed_at := NULL;
      NEW.closed_by_email := NULL;
    END IF;
  END IF;

  IF NEW.assigned_to IS NULL THEN
    NEW.assigned_to_email := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_chat_conversation ON public.chat_conversations;
CREATE TRIGGER stamp_chat_conversation
  BEFORE UPDATE ON public.chat_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_chat_conversation();

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
-- No policies on the secrets table: only the service role reads it.
ALTER TABLE public.chat_conversation_secrets ENABLE ROW LEVEL SECURITY;

-- Admins read every conversation and change its status, assignee and unread
-- count. Checks user_roles directly for the same reason as hub_feedback.
DROP POLICY IF EXISTS "Admins can view chat conversations" ON public.chat_conversations;
CREATE POLICY "Admins can view chat conversations"
ON public.chat_conversations
FOR SELECT
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'));

DROP POLICY IF EXISTS "Admins can update chat conversations" ON public.chat_conversations;
CREATE POLICY "Admins can update chat conversations"
ON public.chat_conversations
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'));

-- Admins read every message and send replies. No update or delete policy:
-- a sent message is never changed or removed from the browser.
DROP POLICY IF EXISTS "Admins can view chat messages" ON public.chat_messages;
CREATE POLICY "Admins can view chat messages"
ON public.chat_messages
FOR SELECT
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'));

DROP POLICY IF EXISTS "Admins can send chat messages" ON public.chat_messages;
CREATE POLICY "Admins can send chat messages"
ON public.chat_messages
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'admin'));

-- Explicit privileges (new public tables get no default grants): the service
-- role does everything; signed-in users get only what the policies above
-- need, column by column; anon gets nothing.
REVOKE ALL ON public.chat_conversations FROM anon, authenticated;
REVOKE ALL ON public.chat_messages FROM anon, authenticated;
REVOKE ALL ON public.chat_conversation_secrets FROM anon, authenticated;
GRANT ALL ON public.chat_conversations TO service_role;
GRANT ALL ON public.chat_messages TO service_role;
GRANT ALL ON public.chat_conversation_secrets TO service_role;
GRANT SELECT ON public.chat_conversations TO authenticated;
GRANT UPDATE (status, assigned_to, assigned_to_email, admin_unread_count)
  ON public.chat_conversations TO authenticated;
GRANT SELECT ON public.chat_messages TO authenticated;
GRANT INSERT (conversation_id, body, client_id) ON public.chat_messages TO authenticated;

-- Realtime: the Inbox listens for new messages and conversation changes, so
-- staff see them without refreshing (RLS applies, so only admins get them).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
    END IF;
  END IF;
END
$$;

-- Make the API see the new tables straight away.
NOTIFY pgrst, 'reload schema';
