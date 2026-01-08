-- Enable pg_net extension for HTTP requests (should already exist)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Create a function to call the monthly credit summary edge function
CREATE OR REPLACE FUNCTION public.trigger_monthly_credit_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Make HTTP request to the edge function
  PERFORM extensions.http_post(
    url := 'https://gxeoillrmjezpehmcvrh.supabase.co/functions/v1/send-monthly-credit-summary',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  
  RAISE LOG 'Monthly credit summary email triggered';
END;
$$;