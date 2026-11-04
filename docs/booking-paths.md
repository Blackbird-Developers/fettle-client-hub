# Booking paths: what the server checks

The app books through the same edge functions as the website, so bookings, credits and payments end up in the same Acuity, Stripe and Supabase records. This page lists, for each booking path, which rules the server enforces and which exist only in the browser. It's for the `packages/core` / `src/core` extraction (MA-10) and for the live walkthrough at the end.

**Rule of thumb:** anything in the "client only" column is UX. The app should copy it, so users don't hit errors they could have avoided, but it can't be relied on for safety. Anything in the "server" column holds whatever the client sends.

## Rules

| Rule (BookingModal / wizard) | Server | Where |
|---|---|---|
| Price of a session | ✅ From Acuity plus `PRICE_OVERRIDES`. The body price is only logged. | `_shared/sessionPrice.ts`, used by `create-payment-intent` and `book-with-credit` |
| Assessment staged pricing | ✅ Only the stage-1 consultation is bookable, priced as in the row above. Later stages are display-only. | `src/lib/assessments.ts` ↔ `PRICE_OVERRIDES` |
| Package credits vs card | ✅ The bundle must be the caller's own, not expired, with credits left. The credit is taken with a compare-and-set before booking and given back if Acuity refuses. | `book-with-package` |
| Category matching (`packageCategory`) | ✅ An individual, youth or couples bundle can only book its own category. Unknown types are allowed. | `book-with-package`, `pay-session` `use-credit` |
| Psychiatry and assessments are card-only | ✅ No bundle credits, codes or referral credit. **New:** this used to be client-only (`isClinicalCategory`). | `_shared/clinical.ts`, used by `book-with-package`, `book-with-credit` and `create-payment-intent` |
| Referral credit covers the full price | ✅ Balance re-checked against the server price. The credit is redeemed only after the booking succeeds. | `create-payment-intent` (returns `fullyCovered`), then `book-with-credit` |
| Bundle code typed into the coupon field | ✅ `create-payment-intent` spots it (`packageCertificate`). `redeem-package-code` checks the purchaser email, use count and session type before linking. | `create-payment-intent`, then `redeem-package-code`, then `book-with-package` |
| Loyalty codes (FETTLELOYALTY…) | ⚠️ Checked against `user_achievements`, **but users can insert their own achievements** (`useAchievements.ts` awards them from the browser). Open issue. | `create-payment-intent` |
| TENOFF refused in the portal | ✅ | `create-payment-intent`, `create-package-payment-intent` |
| Discount below €0.50 | ✅ Reverts to full price. | both create functions |
| Cancel and reschedule before the start time | ✅ **New** (the Sessions page only hid the buttons). | `cancel-session-with-refund`, `acuity` `cancel-appointment` / `reschedule` |
| Booking email = account email | ❌ Client only. `BookingModal` lets the email be edited; the wizard forces the account email. Ownership is bound to the user (`userId` on the PaymentIntent), not to the booking email. A booking under another email won't show in that user's Sessions. | — |
| Youth / couples auto-assign | Not a rule: the client pools availability across each therapist's type and sends the type and calendar of the chosen slot. Acuity refuses a slot that's taken. | `usePooledAvailability.ts` |
| Psychiatry and assessments pooled (no therapist step) | Not a rule: no `calendarID` is sent and Acuity assigns the clinician. `confirm-payment-and-book` falls back to `appointment.calendar` for the email. | — |
| Intake fields | Adaptive: invalid fields are dropped and required ones added on retry. `book-with-package` now accepts the array or the JSON string. | confirm / credit / package functions |

## Retries (the app retries when the network drops)

| Path | What makes a retry safe |
|---|---|
| Card: `confirm-payment-and-book` | `booking_claims` claim on the PaymentIntent id, plus `acuity_appointment_id` / `booking_outcome` stamped on the PaymentIntent. A second call returns `alreadyBooked`, and an in-flight duplicate waits and mirrors the result. |
| Bundle purchase: `confirm-package-payment` | Same claim, plus `acuity_certificate_id` on the PaymentIntent and the `user_packages` row keyed by the PaymentIntent. |
| Settle unpaid session: `pay-session` `confirm` | `settlement_recorded` on the PaymentIntent, plus the claim (new). |
| Bundle credit: `book-with-package` | **New.** An existing `[Bundle:` appointment at that time returns `alreadyBooked`. A duplicate in flight gets 409 `in_progress`. Compare-and-set on credits. |
| Referral credit: `book-with-credit` | **New.** An existing appointment with a redemption returns `alreadyBooked`. A duplicate in flight gets 409 `in_progress`. |
| App killed mid-3DS | `stripe-webhook` completes all three PaymentIntent types (session, bundle, settlement). The app should re-check Sessions on next launch rather than relying on a redirect. |

The app should treat 409 `in_progress` as "wait a few seconds and reload Sessions", not as a failure.

## Live walkthrough (staff test account, after deploy)

Use a staff test account. Use a 100% coupon where possible (Stripe needs at least €0.50, so otherwise refund the same day). Cancel test bookings in Acuity and tell the therapist first.

| # | Path | Calls | Check |
|---|---|---|---|
| 1 | Acuity proxy | `acuity?action=get-appointment-types`, `get-calendars`, `get-availability`, `get-times` | Lists load with the anon key, on web and app |
| 2 | Paid by card | `create-payment-intent` → PaymentSheet → `confirm-payment-and-book` | Booked; invoice on web + app; PI has `userId`, `source: myfettlehub` |
| 3 | Same, app killed after 3DS | Kill the app after authorising | Webhook books it within a minute |
| 4 | Bundle credits | `book-with-package` | Credit −1; retry returns `alreadyBooked`, no second credit |
| 5 | Referral credit (full) | `create-payment-intent` (`fullyCovered`) → `book-with-credit` | Credit redeemed once |
| 6 | Bundle code in the coupon field | `create-payment-intent` (`packageCertificate`) → `redeem-package-code` → `book-with-package` | Bundle linked, then booked |
| 7 | Psychiatry / assessment | card path | Codes refused (`not_for_clinical`); bundle credit refused |
| 8 | Youth / couples auto-assign | card or bundle path | Booked with the slot's therapist |
| 9 | Cancel | `cancel-session-with-refund` | Refunded; a past session is refused (`too_late`) |
| 10 | Reschedule | `acuity?action=reschedule` | Moved; email + push received |
| 11 | Web hub regression | the same flows on my.fettle.ie | Unchanged |
