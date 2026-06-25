-- ============================================================================
-- Refer & Earn  —  "Give €20, Get €20" referral system
-- ============================================================================
-- Rules (per product decisions):
--   * Referee earns €20 credit when they sign up via a code / link / email.
--   * Referrer earns €20 credit, unlocked when their friend signs up.
--   * Credits are SPEND-ONLY (sessions & packages) — never paid out as cash.
--   * Anti-abuse: rewards are granted only once the referee's email is
--     CONFIRMED (the real "signed up" moment); self-referral is blocked; a
--     given new account can be referred at most once; auth enforces unique
--     emails so each reward needs a unique, verifiable inbox.
-- All amounts are stored in cents. €20 = 2000.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

-- One persistent, shareable code per user.
CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per referred person (the referee).
CREATE TABLE IF NOT EXISTS public.referrals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- A given new account can only ever be referred once (anti-farm).
  referee_user_id     UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code_used           TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'rewarded')),
  -- Denormalised snapshot so the referrer can see who they referred without
  -- gaining RLS access to another user's profile row.
  referee_first_name  TEXT,
  referee_masked_email TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at         TIMESTAMPTZ,
  -- Self-referral is impossible.
  CONSTRAINT referrals_no_self_referral CHECK (referrer_user_id <> referee_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_user_id);

-- Append-only credit ledger. Balance = SUM(amount_cents).
CREATE TABLE IF NOT EXISTS public.referral_credits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents       INTEGER NOT NULL,           -- +earned, -redeemed
  type               TEXT NOT NULL
                       CHECK (type IN ('referee_signup', 'referrer_reward', 'redeemed', 'adjustment')),
  source_referral_id UUID REFERENCES public.referrals(id) ON DELETE SET NULL,
  description        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referral_credits_user_idx ON public.referral_credits (user_id);

-- ----------------------------------------------------------------------------
-- RLS — users read only their own rows; all writes happen via SECURITY DEFINER
-- functions below (which bypass RLS), so no INSERT/UPDATE policies are granted.
-- ----------------------------------------------------------------------------
ALTER TABLE public.referral_codes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own referral code" ON public.referral_codes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "own referrals" ON public.referrals
  FOR SELECT USING (auth.uid() IN (referrer_user_id, referee_user_id));

CREATE POLICY "own referral credits" ON public.referral_credits
  FOR SELECT USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Reward amount in cents (single source of truth).
CREATE OR REPLACE FUNCTION public.referral_reward_cents()
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 2000 $$;

-- Mask an email: "sarah@gmail.com" -> "s•••@gmail.com".
CREATE OR REPLACE FUNCTION public.mask_email(addr TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  at_pos INT;
BEGIN
  IF addr IS NULL OR length(addr) = 0 THEN RETURN NULL; END IF;
  at_pos := position('@' IN addr);
  IF at_pos < 2 THEN RETURN '•••' || substring(addr FROM at_pos); END IF;
  RETURN substring(addr FROM 1 FOR 1) || '•••' || substring(addr FROM at_pos);
END;
$$;

-- Generate a random, readable, unique code: "FET-XXXXXX" (no 0/O/1/I/L).
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate TEXT;
  i INT;
BEGIN
  LOOP
    candidate := 'FET-';
    FOR i IN 1..6 LOOP
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.referral_codes WHERE code = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

-- Ensure a user has a referral code; return it (lazy backfill for existing users).
CREATE OR REPLACE FUNCTION public.ensure_referral_code(uid UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  existing TEXT;
BEGIN
  SELECT code INTO existing FROM public.referral_codes WHERE user_id = uid;
  IF existing IS NOT NULL THEN RETURN existing; END IF;

  existing := public.generate_referral_code();
  INSERT INTO public.referral_codes (user_id, code)
  VALUES (uid, existing)
  ON CONFLICT (user_id) DO NOTHING;

  -- Re-read in case of a concurrent insert.
  SELECT code INTO existing FROM public.referral_codes WHERE user_id = uid;
  RETURN existing;
END;
$$;

-- Record attribution at signup (no credit granted yet — that waits for email
-- confirmation). Safe to call with a bad/empty code (it just no-ops).
CREATE OR REPLACE FUNCTION public.link_referral(
  referee_id UUID, referee_email TEXT, referee_name TEXT, raw_code TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  norm_code TEXT;
  ref_user  UUID;
BEGIN
  IF raw_code IS NULL OR length(trim(raw_code)) = 0 THEN RETURN; END IF;
  norm_code := upper(trim(raw_code));

  SELECT user_id INTO ref_user FROM public.referral_codes WHERE code = norm_code;
  IF ref_user IS NULL THEN RETURN; END IF;          -- invalid code
  IF ref_user = referee_id THEN RETURN; END IF;     -- self-referral blocked
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_user_id = referee_id) THEN
    RETURN;                                          -- already referred once
  END IF;

  INSERT INTO public.referrals (
    referrer_user_id, referee_user_id, code_used, status,
    referee_first_name, referee_masked_email
  ) VALUES (
    ref_user, referee_id, norm_code, 'pending',
    referee_name, public.mask_email(referee_email)
  )
  ON CONFLICT (referee_user_id) DO NOTHING;
END;
$$;

-- Grant both rewards once the referee is confirmed. Idempotent: only acts on a
-- 'pending' referral and flips it to 'rewarded'.
CREATE OR REPLACE FUNCTION public.grant_referral_rewards(referee_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      public.referrals%ROWTYPE;
  reward INTEGER := public.referral_reward_cents();
BEGIN
  SELECT * INTO r FROM public.referrals
   WHERE referee_user_id = referee_id AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- Referee's €20
  INSERT INTO public.referral_credits (user_id, amount_cents, type, source_referral_id, description)
  VALUES (r.referee_user_id, reward, 'referee_signup', r.id, 'Welcome credit for joining via referral');

  -- Referrer's €20
  INSERT INTO public.referral_credits (user_id, amount_cents, type, source_referral_id, description)
  VALUES (r.referrer_user_id, reward, 'referrer_reward', r.id, 'Reward for referring a friend');

  UPDATE public.referrals
     SET status = 'rewarded', rewarded_at = now()
   WHERE id = r.id;
END;
$$;

-- ----------------------------------------------------------------------------
-- Triggers — extend new-user handling + reward on email confirmation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  names RECORD;
BEGIN
  SELECT * INTO names FROM public.extract_user_names(NEW.raw_user_meta_data);

  INSERT INTO public.profiles (user_id, email, first_name, last_name)
  VALUES (NEW.id, NEW.email, names.first_name, names.last_name)
  ON CONFLICT (user_id) DO NOTHING;

  -- Every new user gets their own referral code.
  PERFORM public.ensure_referral_code(NEW.id);

  -- If they arrived via a referral code, record attribution.
  PERFORM public.link_referral(
    NEW.id, NEW.email, names.first_name,
    NEW.raw_user_meta_data ->> 'referral_code'
  );

  -- OAuth signups (e.g. Google) are created already-confirmed, so reward now.
  IF NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM public.grant_referral_rewards(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

-- Email/password signups confirm later; reward at that moment.
CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    PERFORM public.grant_referral_rewards(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_confirmed();

-- ----------------------------------------------------------------------------
-- Read API — single RPC the frontend calls for the whole Refer & Earn page.
-- Lazily ensures the caller has a code (covers users created before this feature).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_referral_overview()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid        UUID := auth.uid();
  my_code    TEXT;
  reward     INTEGER := public.referral_reward_cents();
  balance    INTEGER;
  friends    JSON;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  my_code := public.ensure_referral_code(uid);

  SELECT COALESCE(SUM(amount_cents), 0) INTO balance
    FROM public.referral_credits WHERE user_id = uid;

  SELECT COALESCE(json_agg(f ORDER BY f.created_at DESC), '[]'::json) INTO friends
  FROM (
    SELECT id,
           referee_first_name AS name,
           referee_masked_email AS masked_email,
           status,
           created_at,
           CASE WHEN status = 'rewarded' THEN reward ELSE 0 END AS credit_cents
    FROM public.referrals
    WHERE referrer_user_id = uid
  ) f;

  RETURN json_build_object(
    'code', my_code,
    'reward_cents', reward,
    'balance_cents', balance,
    'friends_joined', (SELECT count(*) FROM public.referrals
                        WHERE referrer_user_id = uid AND status = 'rewarded'),
    'pending', (SELECT count(*) FROM public.referrals
                 WHERE referrer_user_id = uid AND status = 'pending'),
    'total_earned_cents', COALESCE((SELECT SUM(amount_cents) FROM public.referral_credits
                                     WHERE user_id = uid AND type = 'referrer_reward'), 0),
    'friends', friends
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_referral_code(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- Backfill: give every existing user a referral code now (one at a time so the
-- uniqueness check inside ensure_referral_code sees prior inserts).
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  u RECORD;
BEGIN
  FOR u IN
    SELECT id FROM auth.users
    WHERE id NOT IN (SELECT user_id FROM public.referral_codes)
  LOOP
    PERFORM public.ensure_referral_code(u.id);
  END LOOP;
END $$;
