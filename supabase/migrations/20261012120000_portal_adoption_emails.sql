-- Portal-adoption emails: who was sent which email, what happened to it
-- (delivered / opened / clicked / bounced, from the Resend webhook) and who
-- must never get marketing email again (unsubscribed, bounced, complained).
--
-- Written by the portal-adoption-emails, resend-webhook and email-unsubscribe
-- edge functions with the service role; admins can only read from the
-- browser. Safe to re-run.

-- ---------------------------------------------------------------------------
-- One row per email sent. UNIQUE (campaign, email) is what guarantees nobody
-- gets the same campaign twice, even if two runs overlap: the sender claims
-- the row first and only then calls Resend.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign TEXT NOT NULL
    CHECK (campaign IN ('existing_clients', 'new_enquiries')),
  email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND char_length(email) <= 320),
  customer_key TEXT NOT NULL CHECK (char_length(customer_key) <= 320),
  customer_name TEXT CHECK (char_length(customer_name) <= 200),
  -- claimed: reserved by a run, Resend not called yet (or the call failed and
  --          the row couldn't be released). seeded: never emailed, recorded so
  --          the backlog isn't sent when going live.
  status TEXT NOT NULL DEFAULT 'claimed'
    CHECK (status IN ('claimed', 'sent', 'seeded')),
  resend_message_id TEXT UNIQUE,
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  opened_at TIMESTAMP WITH TIME ZONE,
  first_clicked_at TIMESTAMP WITH TIME ZONE,
  click_count INTEGER NOT NULL DEFAULT 0,
  bounced_at TIMESTAMP WITH TIME ZONE,
  complained_at TIMESTAMP WITH TIME ZONE,
  -- Stamped by the daily run once a hub account with this email exists.
  signed_up_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT email_sends_once_per_campaign UNIQUE (campaign, email)
);

CREATE INDEX IF NOT EXISTS email_sends_email_idx ON public.email_sends (email);
CREATE INDEX IF NOT EXISTS email_sends_sent_at_idx ON public.email_sends (sent_at DESC);

-- ---------------------------------------------------------------------------
-- Addresses that must not get marketing email.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  email TEXT PRIMARY KEY CHECK (email = lower(btrim(email)) AND char_length(email) <= 320),
  reason TEXT NOT NULL CHECK (reason IN ('unsubscribed', 'bounced', 'complained')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.email_sends ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_suppressions ENABLE ROW LEVEL SECURITY;

-- Admins can read both. No browser writes: only the edge functions (service
-- role, which bypasses RLS) change these tables.
DROP POLICY IF EXISTS "Admins can view email sends" ON public.email_sends;
CREATE POLICY "Admins can view email sends"
ON public.email_sends
FOR SELECT
USING (public.has_role('admin'));

DROP POLICY IF EXISTS "Admins can view email suppressions" ON public.email_suppressions;
CREATE POLICY "Admins can view email suppressions"
ON public.email_suppressions
FOR SELECT
USING (public.has_role('admin'));

REVOKE INSERT, UPDATE, DELETE ON public.email_sends FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.email_suppressions FROM anon, authenticated;

-- Make the API see the new tables straight away.
NOTIFY pgrst, 'reload schema';
