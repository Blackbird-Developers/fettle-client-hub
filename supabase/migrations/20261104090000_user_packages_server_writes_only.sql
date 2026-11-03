-- Bundle credits are written only by edge functions (service role):
-- confirm-package-payment, book-with-package, pay-session, redeem-package-code,
-- sync-acuity-packages. No browser or app code writes user_packages, but these
-- two policies let any signed-in user insert a bundle for themselves or set
-- their own remaining_sessions, i.e. give themselves free sessions with the
-- anon key that ships in the app. Users keep read access to their own rows.
DROP POLICY IF EXISTS "Users can insert their own packages" ON public.user_packages;
DROP POLICY IF EXISTS "Users can update their own packages" ON public.user_packages;
