-- Push notifications for the MyFettle app (Expo Push).
--
-- device_tokens   one row per installed app, owned by the signed-in user.
--                 The app registers through register_device_token() (a phone
--                 can change hands on sign-out/sign-in, so a token moves to
--                 the latest user) and removes it on sign-out with
--                 unregister_device_token(). Edge functions read it with the
--                 service role (_shared/push.ts) and delete tokens Expo
--                 reports as DeviceNotRegistered.
-- push_sends      which reminders were already pushed, so a scheduled run
--                 never sends the same one twice.
-- profiles.notification_preferences
--                 what the client wants pushed. Missing keys count as on.

CREATE TABLE IF NOT EXISTS public.device_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token  text NOT NULL UNIQUE
                   CHECK (expo_push_token ~ '^(ExponentPushToken|ExpoPushToken)\[.+\]$'),
  platform         text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_version      text,
  last_seen        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx ON public.device_tokens (user_id);

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;

-- Users see and remove their own devices. Writes go through the functions
-- below, so there is no INSERT/UPDATE policy.
CREATE POLICY "Users can view their own device tokens"
ON public.device_tokens FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own device tokens"
ON public.device_tokens FOR DELETE
USING (auth.uid() = user_id);

GRANT ALL ON public.device_tokens TO service_role;
GRANT SELECT, DELETE ON public.device_tokens TO authenticated;

-- Register (or refresh) this device for the signed-in user.
CREATE OR REPLACE FUNCTION public.register_device_token(
  p_token text,
  p_platform text,
  p_app_version text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.device_tokens (user_id, expo_push_token, platform, app_version, last_seen)
  VALUES (auth.uid(), p_token, p_platform, p_app_version, now())
  ON CONFLICT (expo_push_token) DO UPDATE
    SET user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        last_seen = now();
END;
$$;

-- Forget this device for the signed-in user (call on sign-out).
CREATE OR REPLACE FUNCTION public.unregister_device_token(p_token text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.device_tokens
  WHERE expo_push_token = p_token AND user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.register_device_token(text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.unregister_device_token(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.register_device_token(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unregister_device_token(text) TO authenticated;

-- Reminders already pushed (service role only).
CREATE TABLE IF NOT EXISTS public.push_sends (
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind     text NOT NULL,          -- e.g. session_reminder_24h
  ref      text NOT NULL,          -- e.g. the Acuity appointment id
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref)
);
ALTER TABLE public.push_sends ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.push_sends TO service_role;

-- What the client wants pushed. Keys match the Notifications card on the
-- Profile page; a missing key means "on".
--   session_reminders   24h and 1h before a session
--   booking_updates     booked / rescheduled / cancelled
--   payment_reminders   unpaid sessions
--   credit_updates      bundle credits used up
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL
  DEFAULT '{"session_reminders": true, "booking_updates": true, "payment_reminders": true, "credit_updates": true}'::jsonb;
