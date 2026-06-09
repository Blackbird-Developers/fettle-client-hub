-- Concurrency control for session booking fulfillment.
--
-- confirm-payment-and-book can be invoked for the same PaymentIntent by several
-- callers at once: the client's direct call, the redirect-return handler, and
-- the stripe-webhook backstop. The start-of-function metadata check is not
-- enough — two simultaneous calls both pass it, both create the Acuity
-- appointment, and one ends up refunding the other's booking (appointment
-- created AND money refunded). This provides an atomic claim so exactly one
-- invocation books; the others detect the live claim and mirror its outcome.

create table if not exists public.booking_claims (
  payment_intent_id text primary key,
  claimed_at        timestamptz not null default now(),
  expires_at        timestamptz not null
);

-- Service-role only. RLS on with no policies => anon/authenticated cannot touch
-- it; the service role (used by the edge function) bypasses RLS.
alter table public.booking_claims enable row level security;

-- Atomically acquire the claim for a PaymentIntent.
-- Returns true if the caller now holds the claim (fresh insert, or takeover of
-- an expired claim left behind by a crashed invocation), false if another live
-- claim already exists.
create or replace function public.claim_booking(
  p_payment_intent_id text,
  p_ttl_seconds integer default 120
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acquired boolean := false;
begin
  insert into public.booking_claims (payment_intent_id, claimed_at, expires_at)
  values (p_payment_intent_id, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (payment_intent_id) do update
    set claimed_at = excluded.claimed_at,
        expires_at = excluded.expires_at
    where public.booking_claims.expires_at <= now()
  returning true into v_acquired;

  return coalesce(v_acquired, false);
end;
$$;

revoke all on function public.claim_booking(text, integer) from public;
grant execute on function public.claim_booking(text, integer) to service_role;
