-- Saved copies of the slow Acuity-backed admin views, so admin pages open at
-- once instead of waiting on Acuity. One row per edge function (source); a
-- scheduled GitHub Actions workflow rebuilds it, and the function returns the
-- saved copy to admins.
--
-- PRIVACY: data holds client names, emails and phones. RLS is on with no
-- policies, so only the service role (the edge functions, after their own
-- admin check) can read or write it — never the browser directly.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.admin_snapshots (
  source TEXT PRIMARY KEY CHECK (source IN ('admin-bundles')),
  data JSONB NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_snapshots FROM anon, authenticated;
