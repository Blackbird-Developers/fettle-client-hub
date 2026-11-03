# Edge function auth

Every edge function runs with `verify_jwt = false` (see `supabase/config.toml`), so the Supabase gateway lets every request through. Each function checks its own caller. The anon key ships inside the website and the MyFettle app, so treat it as public: a function that accepts it is open to anyone.

The shared checks are in `supabase/functions/_shared/auth.ts`:

| Check | Meaning |
|---|---|
| **User JWT** | `Authorization: Bearer <access token>` of a signed-in user (`getCaller`). The anon key and the service-role key don't count. |
| **Owner** | User JWT, and the record belongs to that user: the Acuity appointment's email is the JWT email, or the PaymentIntent's `userId` is the JWT user. |
| **Admin** | User JWT with the `admin` role (`has_role`). |
| **Service role** | `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Only our own functions have it (`isServiceRoleRequest`). |
| **Cron secret** | `x-cron-secret: <REMINDER_CRON_SECRET>`, sent by the GitHub Actions schedules (`hasCronSecret`). |
| **Signature** | The caller's own webhook signature (Stripe, Resend/Svix) or a signed link token. |
| **Public** | Anyone with the anon key. Only for data that is public anyway. |

Functions the app calls also check `x-app-version` (`_shared/appVersion.ts`). The website never sends that header, so it is never blocked.

## Functions

| Function | Who may call it | Notes |
|---|---|---|
| `acuity` `get-appointment-types`, `get-calendars`, `get-availability`, `get-times` | Public | Session types, therapists and free times. The same data is on fettle.ie. |
| `acuity` `get-appointments` | User JWT | Only the caller's own appointments. The `email` query parameter is ignored. |
| `acuity` `cancel-appointment` | Owner | Only before the start time. No refund. Clients normally use `cancel-session-with-refund`. |
| `acuity` `reschedule` | Owner | Only before the start time. |
| `acuity` `book-appointment` | Nobody (410) | Retired. It booked into Acuity with no payment, and nothing called it. |
| `book-with-credit` | User JWT | Credit and price are checked on the server. |
| `book-with-package` | User JWT | The bundle must be the caller's own. |
| `cancel-session-with-refund` | Owner | Only before the start time. The `clientEmail` body field is ignored; it used to be trusted. |
| `confirm-package-payment` | Owner (PI `userId`) or Service role | Service role is the `stripe-webhook` backstop. The bare anon key is no longer accepted. |
| `confirm-payment-and-book` | Owner (PI `userId`, or the email on PIs created before `userId` was stamped) or Service role | Service role is the `stripe-webhook` backstop. |
| `create-package-payment-intent` | User JWT | Stamps `userId` on the PI. |
| `create-payment-intent` | User JWT | Stamps `userId` on the PI. Used to be public. |
| `delete-user-account`, `export-user-data` | User JWT | The caller's own account only. |
| `get-payment-history` | User JWT | Stripe payments for the caller's email. |
| `pay-session` | Owner | `create` and `use-credit` check the appointment. `confirm` checks the PI's email. |
| `redeem-package-code` | User JWT | The certificate must have been bought with the caller's email, or be unclaimed. |
| `submit-therapist-review` | Owner | Checks the appointment against Acuity. |
| `sync-acuity-appointments` | User JWT (own account only) or Service role / Cron secret (anyone) | Used to be public, with a client-chosen email. |
| `sync-acuity-packages` | User JWT (own account only) or Service role / Cron secret (anyone) | Used to be public, with a client-chosen email. |
| `unpaid-sessions` | User JWT | The caller's own sessions only. |
| `user-roles` | Admin | |
| `admin-analytics`, `admin-clinical`, `admin-customer-insights`, `admin-leads`, `admin-metrics` | Admin | |
| `admin-bundles`, `sales-tasks` | Admin or Cron secret | |
| `acuity-appointments-mirror`, `portal-adoption-emails`, `unpaid-session-reminders` | Cron secret | |
| `session-reminders` | Cron secret or Service role | Emails every client. Used to be public. |
| `send-monthly-credit-summary` | Cron secret or Service role | Emails every bundle holder. Used to be public. See "Before deploying". |
| `send-booking-confirmation`, `send-credit-used-confirmation`, `send-credits-depleted`, `send-package-confirmation` | Service role | Called by other functions. They used to be open email relays. |
| `stripe-webhook` | Signature (Stripe) | Calls the confirm functions with the service-role key. |
| `resend-webhook` | Signature (Svix, `RESEND_WEBHOOK_SECRET`) | |
| `email-unsubscribe` | Signature (signed link token) | Opened by people who aren't signed in. |
| `send-password-reset` | Public | It has to work for people who aren't signed in. GoTrue only accepts a `redirectTo` that is on the Auth redirect allow-list. |

Removed: `create-session-payment`, `create-package-payment`, `verify-payment-and-book` and `verify-package-payment`. These were the old Stripe Checkout redirect flow, and nothing called them any more.

## Database

- `user_packages`: users can only read their own rows. The policies that let users insert rows and change `remaining_sessions` are dropped by migration `20261104090000`. Only the functions write this table, using the service-role key.
- **Open issue:** users can insert their own `user_achievements` rows (`useAchievements.ts` awards milestones from the browser), and those rows unlock the FETTLELOYALTY discounts in `create-payment-intent`. Awarding should move to the server.
- Referral functions: `qualify_referral`, `redeem_referral_credit`, `referral_available_balance`, `ensure_referral_code` and `link_referral` take a user id and were executable by anyone (Postgres grants EXECUTE to PUBLIC by default). Migration `20261104092000` limits them to the service role. Users keep `get_referral_overview()`, which uses `auth.uid()`.
- Push (`20261104091000`): `device_tokens` can be read and deleted by its owner, and written only through `register_device_token` / `unregister_device_token`, which use `auth.uid()`. `push_sends` is service role only.

## Before deploying

1. Run the new migrations: `20261104090000` (user_packages), `20261104091000` (push) and `20261104092000` (referral functions).
2. Redeploy every changed function, including `stripe-webhook`. The confirm functions no longer accept the anon key from an old webhook build.
3. Delete the removed functions from the project: `supabase functions delete create-session-payment create-package-payment verify-payment-and-book verify-package-payment`.
4. Run `select * from cron.job;`. If a job calls `trigger_monthly_credit_summary()`, it posts without auth and will now get a 401. Move that schedule to a GitHub Actions workflow that sends `x-cron-secret`, like `unpaid-session-reminders.yml`.
5. Optional: `MIN_APP_VERSION` makes app builds older than that version show their "please update" screen.
