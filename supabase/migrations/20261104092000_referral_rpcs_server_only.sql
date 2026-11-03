-- The referral functions are SECURITY DEFINER and take a user id as an
-- argument. Postgres grants EXECUTE on new functions to PUBLIC, and
-- 20260625120000_referrals.sql never revoked it, so anyone holding the anon key
-- (which ships in the website and the app) could call, for example,
--   qualify_referral(<own id>)          grant €20 to themselves and their referrer without paying
--   redeem_referral_credit(<any id>, …) spend another client's credit
--   referral_available_balance(<any id>) read another client's balance
-- Only edge functions (service role) and the signup trigger (runs as the
-- function owner) call these. The website calls only get_referral_overview(),
-- which uses auth.uid() and keeps its grant.

REVOKE EXECUTE ON FUNCTION public.qualify_referral(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.referral_available_balance(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_referral_code(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.qualify_referral(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.referral_available_balance(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_referral_code(UUID) TO service_role;

-- redeem_referral_credit and link_referral have longer signatures; revoke
-- every overload by name so this doesn't depend on their exact arguments.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('redeem_referral_credit', 'link_referral')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
