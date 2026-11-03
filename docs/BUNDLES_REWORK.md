# Bundles rework: testing and release

Branch `fix/bundles-rework`. Clients with a session bundle were told "coupon not
recognised" and sent to card payment. This branch fixes that in the booking
modal, the `/book` wizard, the dashboard, Packages and unpaid sessions.

## What changed

| Step | Commit | Change |
|---|---|---|
| 1 | a1650e9, 783ab7f | A refused code keeps the client on the confirm step with the reason and three choices (try another code, pay for this session, email hello@fettle.ie). Staff get a bell notification and an email the first time a client and code fail. |
| 3 | 5886af3 | A bundle registered to another email links by its code (Acuity redeems by code alone). Booking screens re-check Acuity for new bundles when they open. Bundle prices in `sync-acuity-packages` and `verify-package-payment` match the store. |
| 2 | 6c0351a | "Have a bundle? Add your code" above the payment choice, on the dashboard and in Packages. The old field is now "Discount code". |
| 4 | ea9871b | One card per bundle: sessions left, session type, expiry, warnings. Bundles that can't pay for the session are shown with the reason. |
| 5 | 7fa3be9 | "This booking will use 1 credit from your 6 Session Bundle. You'll have 3 left." before booking, the new balance after, and "Paid with bundle" on the Sessions page. |
| 6 | b1269a7 | Unpaid sessions offer "Use a bundle credit" next to "Pay by card" (`pay-session` action `use-credit`). |
| 7 | f1a4849 | The same handling in the `/book` wizard (Plan, Review and Pay steps). |

## Release (Ernest)

1. Apply the migration `supabase/migrations/20261030120000_admin_notifications.sql`.
2. Redeploy these edge functions:
   - `redeem-package-code`
   - `sync-acuity-packages`
   - `verify-package-payment`
   - `pay-session`
   - `unpaid-sessions`
3. In Resend, check that `notifications.fettle.ie` can send to operations@fettle.ie and alex@fettle.ie.
4. Deploy the frontend.

## Test cases

Run each in the booking modal (Book a Session) and in `/book`, unless noted.
Use a test client signed in to the hub.

| # | Case | Expected |
|---|---|---|
| 1 | Bundle bought on the login email | The credit shows on the confirm step / Plan step, preselected. The confirm step says which bundle and how many will be left. |
| 2 | Bundle bought under another email: enter its code in "Have a bundle? Add your code" | It links and the booking switches to a credit. The redeem-package-code log shows "Code is tied to another email". |
| 3 | Used-up bundle code | "All sessions on this bundle are used", with Try another code / Pay for this session / Email. Bell notification and one staff email; trying again sends no second email. |
| 4 | Expired bundle code | "This bundle has expired", same choices. |
| 5 | Youth bundle on an individual session | Linked, shown under "Can't be used for this session" with the reason. The client can pay or go back. |
| 6 | No bundle, discount code that doesn't exist | "That code isn't recognised" with the choices; nothing charged until they choose to pay. |
| 7 | Bundle code typed in the discount field | Treated as a bundle (linked and booked with a credit). |
| 8 | Bundle bought on fettle.ie while signed in to the hub | Shows up when the booking screen opens, without signing out (wait two minutes between tries). |
| 9 | Dashboard and Packages: add a code before booking | Success line with sessions left; the dashboard card lists the bundle. |
| 10 | Book with a credit | Success screen "Paid with 1 bundle credit" and the new balance; credit-used email arrives; Sessions page shows "Paid with bundle". |
| 11 | Unpaid session (booked in Acuity directly) with a matching bundle | Pay modal offers "Use a bundle credit". After using it: the session is no longer listed as unpaid, the hub balance is one lower, and **Acuity's certificate balance is one lower too**. |
| 12 | Unpaid session with no matching bundle | Pay modal goes straight to card, as before. |
| 13 | Psychiatry or assessment booking | No bundle offered; bundles listed as "can't be used". |

### Check first: case 11

`use-credit` sets `certificate` on an existing Acuity appointment with
`PUT /appointments/{id}`. That has not been tried against the live account. If
Acuity refuses it, the client's credit is given back and they are told nothing
was taken (log line "Acuity refused the bundle credit"). If Acuity accepts the
update but does not deduct the certificate, the hub and Acuity balances will
differ: check the certificate in Acuity after the test.

### Edge function logs to check

To confirm the cause of the reported cases, look in the `redeem-package-code`
and `create-payment-intent` logs from before the release for refusals with
`wrong_email` / "registered to a different email". Those are the cases Step 3
fixes.

## Known limits

- "Paid with bundle" only marks sessions booked with a bundle in the hub (it
  reads the `[Bundle: …]` note). Acuity doesn't say whether a code used on
  fettle.ie was a bundle or a discount.
- Open for Fettle: "code not found" also notifies staff, so discount-code typos
  will reach the bell and the inbox. It can be limited to clear bundle problems.
