# Session bundle codes in the Fettle Client Hub

**Problem this solves:** clients who hold an Acuity session-bundle certificate
code (e.g. `704E3907`) — bought on fettle.ie / Acuity's store, or issued by the
clinic in Acuity — typed it into the hub's coupon field and were told
"This is a session-package code — redeem it via Packages" with no way to do so.
Their only option was to pay again.

## What happens now

- **Coupon field (Confirm step).** `create-payment-intent` still validates the
  code as before (loyalty → Stripe promotion code → Acuity certificate check).
  If Acuity reports a session-bundle certificate (`type` of
  `appointments` / `counts` / `minutes`) the function returns
  `{ packageCertificate }` **without creating a PaymentIntent**. The booking
  modal then calls `redeem-package-code`, refreshes credits, and flips the
  booking to **Use Package Credit** — the client presses *Book Session* and the
  existing `book-with-package` path books it (Acuity deducts the certificate).
- **Packages modal.** New *Already have a bundle code?* input calls
  `redeem-package-code` directly, so a bundle can be linked before booking.
- **Cross-category codes.** A youth/couples code typed on an individual booking
  is still linked to the account but reported `applicable: false`; the booking
  stays on card payment and the toast explains which session type it's for.

## `supabase/functions/redeem-package-code`

Signed-in only. Input `{ code, appointmentTypeID? }`.

1. Asks Acuity `GET /certificates/check?certificate=…&appointmentTypeID=…&email=<caller>`.
   With `appointmentTypeID` it tries that type first; otherwise (or if that
   type is refused) it scans live therapy types — one per category, then the
   rest in parallel batches — until Acuity accepts the code.
2. Refuses discount coupons (`discount_code`), monetary gift certificates
   (`unsupported`), expired / used-up / wrong-email / unknown codes, and
   certificates already linked to **another** hub account (`claimed`).
3. Inserts a `user_packages` row keyed exactly like `sync-acuity-packages`
   (`stripe_session_id = acuity-cert-<id>`), so a later sync updates rather
   than duplicates it. Unknown product IDs (clinic-issued certs) are stored
   with the category-based name; the modal offers those credits for any
   therapy session and Acuity enforces the type restriction at booking.

All user-facing refusals return HTTP 200 with `{ ok: false, reason, message }`
so the UI can show the message verbatim.

## Deploy

Frontend deploys via Vercel on merge. Edge functions are deployed manually:

```bash
supabase functions deploy redeem-package-code
supabase functions deploy create-payment-intent
```

Deploy `redeem-package-code` **before** the frontend goes live — the modal
calls it as soon as a bundle code is typed.

## QA

- [ ] Type a valid bundle code in the coupon field on a matching session → toast
      "Bundle linked", confirm step switches to Use Package Credit, Book Session
      books it, Acuity shows the certificate deducted, dashboard credit count drops.
- [ ] Same code again → "Bundle found on your account", no duplicate package row.
- [ ] Youth code on an individual booking → linked, stays on card payment,
      toast names youth therapy; booking a youth session then offers the credit.
- [ ] Packages → *Already have a bundle code?* with a valid code → "Bundle linked!"
      screen; with a made-up code → "We couldn't find a bundle with that code".
- [ ] A discount coupon (Stripe promo or Acuity coupon) still applies as a discount.
- [ ] Code linked to a different account → "already linked to another Fettle account".
