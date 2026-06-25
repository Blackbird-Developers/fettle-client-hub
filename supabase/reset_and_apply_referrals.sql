-- ============================================================================
-- ONE-TIME STAGING HELPER — reset + rebuild the referral schema in one paste.
-- ============================================================================
-- Use this on STAGING when an OLDER version of the referral migration was
-- already applied (so the tables exist with the wrong columns and a plain
-- re-run skips them via CREATE TABLE IF NOT EXISTS).
--
-- It DROPS the referral tables (safe on staging — no real referral data) and
-- then runs the current migration, which rebuilds them with the new structure.
--
-- ⚠️ NOT a migration and NOT for production. Production never had the referral
--    tables, so it just applies supabase/migrations/20260625120000_referrals.sql
--    normally via `supabase db push`.
-- ============================================================================

-- ---- RESET (drop old referral objects) -------------------------------------
DROP TABLE IF EXISTS public.referral_redemptions CASCADE;
DROP TABLE IF EXISTS public.referral_credits    CASCADE;
DROP TABLE IF EXISTS public.referrals           CASCADE;
DROP TABLE IF EXISTS public.referral_codes      CASCADE;

-- Old reward path from earlier drafts (no-ops if absent).
DROP TRIGGER  IF EXISTS on_auth_user_email_confirmed ON auth.users;
DROP FUNCTION IF EXISTS public.handle_user_email_confirmed();
DROP FUNCTION IF EXISTS public.grant_referral_rewards(UUID);

-- ============================================================================
-- REBUILD — identical to supabase/migrations/20260625120000_referrals.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.referrals (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referee_user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code_used            TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'rewarded')),
  referee_first_name   TEXT,
  referee_masked_email TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  rewarded_at          TIMESTAMPTZ,
  CONSTRAINT referrals_no_self_referral CHECK (referrer_user_id <> referee_user_id)
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_user_id);

CREATE TABLE IF NOT EXISTS public.referral_credits (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents       INTEGER NOT NULL CHECK (amount_cents > 0),
  remaining_cents    INTEGER NOT NULL CHECK (remaining_cents >= 0),
  type               TEXT NOT NULL CHECK (type IN ('referee_reward', 'referrer_reward')),
  source_referral_id UUID REFERENCES public.referrals(id) ON DELETE SET NULL,
  description        TEXT,
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_credits_user_idx ON public.referral_credits (user_id);

CREATE TABLE IF NOT EXISTS public.referral_redemptions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_id    UUID NOT NULL REFERENCES public.referral_credits(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  booking_type TEXT,
  booking_ref  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_redemptions_user_idx ON public.referral_redemptions (user_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.referral_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_credits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own referral code" ON public.referral_codes;
CREATE POLICY "own referral code" ON public.referral_codes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own referrals" ON public.referrals;
CREATE POLICY "own referrals" ON public.referrals
  FOR SELECT USING (auth.uid() IN (referrer_user_id, referee_user_id));

DROP POLICY IF EXISTS "own referral credits" ON public.referral_credits;
CREATE POLICY "own referral credits" ON public.referral_credits
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own referral redemptions" ON public.referral_redemptions;
CREATE POLICY "own referral redemptions" ON public.referral_redemptions
  FOR SELECT USING (auth.uid() = user_id);

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- Constants & helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_reward_cents()
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 2000 $$;

CREATE OR REPLACE FUNCTION public.referral_validity_days()
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$ SELECT 45 $$;

CREATE OR REPLACE FUNCTION public.mask_email(addr TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE at_pos INT;
BEGIN
  IF addr IS NULL OR length(addr) = 0 THEN RETURN NULL; END IF;
  at_pos := position('@' IN addr);
  IF at_pos < 2 THEN RETURN '•••' || substring(addr FROM at_pos); END IF;
  RETURN substring(addr FROM 1 FOR 1) || '•••' || substring(addr FROM at_pos);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  candidate TEXT; i INT;
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

CREATE OR REPLACE FUNCTION public.ensure_referral_code(uid UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing TEXT;
BEGIN
  SELECT code INTO existing FROM public.referral_codes WHERE user_id = uid;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  existing := public.generate_referral_code();
  INSERT INTO public.referral_codes (user_id, code) VALUES (uid, existing)
    ON CONFLICT (user_id) DO NOTHING;
  SELECT code INTO existing FROM public.referral_codes WHERE user_id = uid;
  RETURN existing;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_referral(
  referee_id UUID, referee_email TEXT, referee_name TEXT, raw_code TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE norm_code TEXT; ref_user UUID;
BEGIN
  IF raw_code IS NULL OR length(trim(raw_code)) = 0 THEN RETURN; END IF;
  norm_code := upper(trim(raw_code));
  SELECT user_id INTO ref_user FROM public.referral_codes WHERE code = norm_code;
  IF ref_user IS NULL THEN RETURN; END IF;
  IF ref_user = referee_id THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.referrals WHERE referee_user_id = referee_id) THEN
    RETURN;
  END IF;
  INSERT INTO public.referrals (
    referrer_user_id, referee_user_id, code_used, status,
    referee_first_name, referee_masked_email
  ) VALUES (
    ref_user, referee_id, norm_code, 'pending',
    referee_name, public.mask_email(referee_email)
  ) ON CONFLICT (referee_user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.qualify_referral(referee_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r      public.referrals%ROWTYPE;
  reward INTEGER := public.referral_reward_cents();
  exp    TIMESTAMPTZ := now() + make_interval(days => public.referral_validity_days());
BEGIN
  SELECT * INTO r FROM public.referrals
   WHERE referee_user_id = referee_id AND status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  INSERT INTO public.referral_credits
    (user_id, amount_cents, remaining_cents, type, source_referral_id, description, expires_at)
  VALUES
    (r.referee_user_id, reward, reward, 'referee_reward', r.id,
     'Welcome credit — completed your first paid session', exp),
    (r.referrer_user_id, reward, reward, 'referrer_reward', r.id,
     'Reward — your referral became a paying client', exp);

  UPDATE public.referrals SET status = 'rewarded', rewarded_at = now() WHERE id = r.id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.referral_available_balance(uid UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(remaining_cents), 0)::int
  FROM public.referral_credits
  WHERE user_id = uid AND remaining_cents > 0 AND expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.redeem_referral_credit(
  uid UUID, want_cents INTEGER, p_booking_type TEXT, p_booking_ref TEXT
)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  remaining INTEGER := want_cents;
  take      INTEGER;
  lot       RECORD;
BEGIN
  IF want_cents IS NULL OR want_cents <= 0 THEN RETURN 0; END IF;

  FOR lot IN
    SELECT id, remaining_cents FROM public.referral_credits
     WHERE user_id = uid AND remaining_cents > 0 AND expires_at > now()
     ORDER BY expires_at ASC, granted_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN remaining <= 0;
    take := least(lot.remaining_cents, remaining);
    UPDATE public.referral_credits SET remaining_cents = remaining_cents - take WHERE id = lot.id;
    INSERT INTO public.referral_redemptions (user_id, credit_id, amount_cents, booking_type, booking_ref)
    VALUES (uid, lot.id, take, p_booking_type, p_booking_ref);
    remaining := remaining - take;
  END LOOP;

  RETURN want_cents - remaining;
END;
$$;

-- ----------------------------------------------------------------------------
-- New-user handling
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE names RECORD;
BEGIN
  SELECT * INTO names FROM public.extract_user_names(NEW.raw_user_meta_data);

  INSERT INTO public.profiles (user_id, email, first_name, last_name)
  VALUES (NEW.id, NEW.email, names.first_name, names.last_name)
  ON CONFLICT (user_id) DO NOTHING;

  PERFORM public.ensure_referral_code(NEW.id);
  PERFORM public.link_referral(
    NEW.id, NEW.email, names.first_name, NEW.raw_user_meta_data ->> 'referral_code'
  );

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- Read API
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_referral_overview()
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid     UUID := auth.uid();
  my_code TEXT;
  reward  INTEGER := public.referral_reward_cents();
  friends JSON;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  my_code := public.ensure_referral_code(uid);

  SELECT COALESCE(json_agg(f ORDER BY f.created_at DESC), '[]'::json) INTO friends
  FROM (
    SELECT id,
           referee_first_name   AS name,
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
    'validity_days', public.referral_validity_days(),
    'balance_cents', public.referral_available_balance(uid),
    'friends_joined', (SELECT count(*) FROM public.referrals
                        WHERE referrer_user_id = uid AND status = 'rewarded'),
    'pending', (SELECT count(*) FROM public.referrals
                 WHERE referrer_user_id = uid AND status = 'pending'),
    'total_earned_cents', COALESCE((SELECT SUM(amount_cents) FROM public.referral_credits
                                     WHERE user_id = uid AND type = 'referrer_reward'), 0),
    'next_expiry', (SELECT min(expires_at) FROM public.referral_credits
                     WHERE user_id = uid AND remaining_cents > 0 AND expires_at > now()),
    'friends', friends
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_referral_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_referral_code(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.referral_available_balance(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- Backfill
-- ----------------------------------------------------------------------------
DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN SELECT id FROM auth.users WHERE id NOT IN (SELECT user_id FROM public.referral_codes) LOOP
    PERFORM public.ensure_referral_code(u.id);
  END LOOP;
END $$;
