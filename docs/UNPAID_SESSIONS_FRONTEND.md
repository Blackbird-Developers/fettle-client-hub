# Unpaid sessions — front-end integration guide

Backend is live (edge function `unpaid-sessions`, deployed 2026-09-22). It returns
the signed-in client's **genuinely unpaid** sessions — Acuity says unpaid AND no
Stripe payment is stamped for that appointment AND no referral credit covered it.
Package/website bookings never appear (Acuity already shows them paid via
certificate). The server is deliberately fail-safe: any doubt → the session is
NOT listed, so the UI never accuses someone who paid.

## Calling it

```ts
const { data, error } = await supabase.functions.invoke('unpaid-sessions');
```

The user's session JWT is sent automatically by `functions.invoke`. There is no
request body and no parameters — the server resolves the client from the JWT and
ignores everything else. Signed-out callers get a 401.

## Response

```jsonc
{
  "unpaidSessions": [
    {
      "id": 1764974242,                       // Acuity appointment id
      "type": "Individual Session with Laura McDermott",
      "therapist": "Laura McDermott",         // may be "" for pooled types
      "datetime": "2026-09-29T19:00:00+0100", // ISO with offset
      "price": "95.00",                       // string, EUR
      "amountPaid": "0.00",
      "isPast": false                         // true = session already happened
    }
  ],
  "degraded": "stripe_check_failed",          // OPTIONAL — see below
  "checkedAt": "2026-09-22T10:15:00.000Z"
}
```

Window: sessions from 60 days back to 90 days ahead, oldest first, max 20.

## Rendering rules

1. **Empty `unpaidSessions`, any `error`, or a non-2xx** → render **nothing**.
   No skeleton, no fallback text. The dashboard must look identical to today.
2. **`degraded` present** → also render nothing extra; it means a downstream
   check was unavailable and results are conservative. Never show it to users.
3. **One or more sessions** → show a dismissible amber banner on the Dashboard
   (place it directly under the announcement bar / above `WelcomeHeader`):

   - One session, upcoming: `Your session with {therapist} on {date} hasn't been
     paid yet ({€price}). Please settle it before your appointment.`
   - One session, `isPast: true`: `Your session with {therapist} on {date} is
     awaiting payment ({€price}).`
   - Multiple: `You have {n} unpaid sessions totalling €{sum}.`
   - CTA for v1 (no pay-now flow yet): link to `/sessions` plus
     `mailto:hello@fettle.ie?subject=Session payment` ("Contact us to settle").

4. On the **Sessions page**, add an amber `Unpaid` Badge on any session card
   whose appointment id is in the list.

Format dates with the user's profile timezone falling back to `Europe/Dublin`,
same as `BookingModal` does.

## Data fetching pattern

Follow the existing hooks style (`src/hooks/useAcuity.ts`):

```ts
// src/hooks/useUnpaidSessions.ts
export function useUnpaidSessions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['unpaid-sessions', user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,   // once per login-ish; it hits Acuity + Stripe
    retry: false,               // fail silent, never hammer
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('unpaid-sessions');
      if (error) throw error;
      return (data?.unpaidSessions ?? []) as UnpaidSession[];
    },
  });
}
```

Use shadcn `Alert` with the site's warning/amber tokens (see how the
announcement bar and destructive toasts are styled) — not `destructive` red;
this is a nudge, not an error. Dismissal can be sessionStorage-scoped
(`unpaid-dismissed-{ids hash}`) so it reappears next login or when the list
changes.

## Copy rules

- Currency: `€95` / `€95.00` — match existing formatting helpers.
- Never say "overdue", "debt", or threaten cancellation; the clinic hasn't
  defined a policy. "Hasn't been paid yet" / "awaiting payment" only.
- No mention of Acuity/Stripe internals.

## Verification checklist (before merging)

- [ ] Signed-out visitor: dashboard unchanged, no failed-request noise in console.
- [ ] Signed-in account with no unpaid sessions: dashboard unchanged.
- [ ] Signed-in account WITH a therapist-booked unpaid session: banner + badge
      show correct therapist/date/amount (cross-check the amount against
      Acuity's appointment record).
- [ ] An account that paid by card in the hub: their session does NOT appear
      (this is the false-positive case the server exists to prevent — check the
      function logs show "Excluded: paid via Stripe" for it).
- [ ] Banner dismiss works and returns on next login.

## Not in scope yet

Self-serve "Pay now" (Stripe form + stamping the Acuity appointment as settled)
is designed but not built — the banner CTA is contact/manual for v1. Ask before
building it; the backend will need one more function.
