# Backend TODO: deploy the MyFettle app backend

**From:** Buna, out for 2 days. **For:** Ernest (Supabase access).

The code is merged to `main`. **Nothing in Supabase has been changed.** The live database and edge functions are still the old versions until you run the steps below. Until then, `main` doesn't match production.

The background is in `docs/edge-function-auth.md` (who may call each function) and `docs/booking-paths.md`. The app side is in `myfettle-app/docs/mobile-api.md`.

## Why the order matters

- The new functions lock down endpoints that used to be open, and three migrations remove write access users had. Do the migrations and all the functions in one go, then test.
- `stripe-webhook` and the `confirm-*` functions must be deployed **together**. The new confirm functions no longer accept the anon key, and the old webhook sends it.
- The `Session push reminders` workflow is **switched off** in `.github/workflows/session-push-reminders.yml`. The **old** `session-reminders` function ignores `mode` and emails every inactive client, so running the schedule before the deploy would email them every 15 minutes. Turn it on last (step 7).

## Steps

### 1. Back up

Make sure point-in-time recovery or a fresh backup exists. The migrations change RLS policies and grants.

### 2. Run the migrations

```bash
supabase link --project-ref gxeoillrmjezpehmcvrh
supabase migration list          # see what is pending on prod
```

**Live's migration history is empty** (checked 5 Nov 2026): every migration was applied by hand, so `migration list` shows all 32 as pending. **Don't `db push` like that**: it would replay every migration since December 2025 against a database that already has them. Record the 26 that are already on live first (history only, no schema change; checked by probing their tables and columns on live). `20260112133600` is left pending on purpose; it's a no-op.

```bash
supabase migration repair --status applied --linked 20251220161609 20251220163950 20251220165257 20251221094712 20251224084436 20251224115008 20260108100832 20260109185831 20260112100000 20260424120000 20260525120000 20260609083000 20260625120000 20260717120000 20261007120000 20261008120000 20261012120000 20261013120000 20261014120000 20261014120001 20261016120000 20261019120000 20261023120000 20261028120000 20261029120000 20261030120000
supabase db push --dry-run       # must list exactly the 6 below
supabase db push
```

The dry run must show exactly: `20260112133600`, `20261103120000`, `20261104090000`, `20261104091000`, `20261104092000`, `20261104120000`. Stop if it shows anything else.

New from this work:

| Migration | What it does |
|---|---|
| `20261104090000_user_packages_server_writes_only` | Users can read their own `user_packages` rows but can no longer insert them or change `remaining_sessions`. Only the functions write it. |
| `20261104091000_push_notifications` | Adds the `device_tokens` and `push_sends` tables, `profiles.notification_preferences`, and the `register_device_token` / `unregister_device_token` RPCs. |
| `20261104092000_referral_rpcs_server_only` | Limits `qualify_referral`, `redeem_referral_credit`, `referral_available_balance`, `ensure_referral_code` and `link_referral` to the service role. Users keep `get_referral_overview()`. |

Also pending, and applied by the same push: `20261103120000_explicit_table_grants` (not yet on live: anon still has SELECT on those tables, though RLS returns nothing) and `20261104120000_booking_funnel_events` (PR #30).

### 3. Secrets (optional)

Both new secrets are optional; set them in Supabase → Edge Functions → Secrets.

| Secret | Needed? |
|---|---|
| `EXPO_ACCESS_TOKEN` | Only if "enhanced push security" is turned on for the Expo project. Without it, push is sent unauthenticated, which Expo allows by default. |
| `MIN_APP_VERSION` | Leave unset for now. If it's set, app builds older than that version get a 426 response and the "please update" screen. |

`REMINDER_CRON_SECRET`, `RESEND_API_KEY`, `ACUITY_*` and the Stripe keys are unchanged.

### 4. Deploy every function

```bash
supabase functions deploy
```

This deploys every function. `supabase/config.toml` lists every function with `verify_jwt = false`, and each function checks its own caller.

On live (checked 5 Nov), seven functions are still `verify_jwt = true`: `pay-session`, `unpaid-sessions`, `sync-acuity-packages`, `admin-analytics`, `admin-clinical`, `admin-leads` and `admin-customer-insights`. This deploy switches them to `false`. That's intended: each one checks its own caller, and those checks are stricter than the gateway's (the gateway accepts the public anon key; the functions don't).

Changed functions: `acuity`, `book-with-credit`, `book-with-package`, `cancel-session-with-refund`, `confirm-package-payment`, `confirm-payment-and-book`, `create-package-payment-intent`, `create-payment-intent`, `delete-user-account`, `export-user-data`, `get-payment-history`, `pay-session`, `redeem-package-code`, `send-booking-confirmation`, `send-credit-used-confirmation`, `send-credits-depleted`, `send-monthly-credit-summary`, `send-package-confirmation`, `session-reminders`, `stripe-webhook`, `submit-therapist-review`, `sync-acuity-appointments`, `sync-acuity-packages`, `unpaid-session-reminders`, `unpaid-sessions`, plus `_shared`, which every function imports.

### 5. Delete the retired functions

Nothing calls them any more:

```bash
supabase functions delete create-session-payment
supabase functions delete create-package-payment
supabase functions delete verify-payment-and-book
supabase functions delete verify-package-payment
```

`stripe-cancel` and `stripe-capture` (removed from the repo in `2799d17`) were still deployed until 5 Nov 2026 and have now been deleted from live, so they aren't in this list.

### 6. Check the database cron jobs

```sql
select jobid, schedule, command from cron.job;
```

If a job calls `trigger_monthly_credit_summary()`, it will now get a 401, because `send-monthly-credit-summary` needs the cron secret. Unschedule it and add a GitHub Actions workflow that sends `x-cron-secret`, copying `unpaid-session-reminders.yml`.

### 7. Turn on push reminders

Do this only after step 4. In `.github/workflows/session-push-reminders.yml`, uncomment these two lines and push to `main`:

```yaml
  schedule:
    - cron: "*/15 * * * *"
```

Run it once by hand first: Actions → Session push reminders → Run workflow. It should return 200 and send no emails.

## Smoke test after deploying

On the website, signed in as a test client:

- [ ] Book a single session by card. Stripe → Webhooks should show `payment_intent.succeeded` delivered with a 200, and the session should appear in Acuity and in My Sessions.
- [ ] Book with a bundle credit. One credit should be used.
- [ ] Buy a bundle.
- [ ] Pay for an unpaid session from My Sessions.
- [ ] Cancel a session with refund.
- [ ] Use a referral code or referral credit.
- [ ] Open the admin pages.
- [ ] Check the function logs for unexpected 401 or 403 errors: Supabase → Edge Functions → Logs.

## Rolling back

- **Functions:** check out the functions from before the lockdown and redeploy them:

  ```bash
  git checkout 93e3e09 -- supabase/functions   # before MA-1, with both TENOFF blocks
  supabase functions deploy
  ```

  Use `93e3e09`, **not** `6b86a64` or `edc9f45`. Live was never one commit: `create-payment-intent` was deployed from the TENOFF branch (`d38213a`), which reached `main` only through PR #31. `6b86a64` and `edc9f45` don't have that block, so rolling back to either would let TENOFF work in the portal again. `93e3e09` has the same `create-payment-intent` as live, keeps the bundle TENOFF block (PR #29), and predates the MA-1 lockdown (`21b90da`).

  Redeploy the four deleted functions too if you need them.
- **Migrations:** these don't undo themselves. To undo one, write a new migration that brings back the old policies or grants.

## Not done, and not blocking the deploy

- **MA-3 (mobile auth): not started on the backend.**
  - Add `myfettle://auth/callback` to Auth → URL Configuration → Redirect URLs. The app's password reset and Google sign-in need it; see `TODO(MA-3)` in the app's `forgot-password.tsx`.
  - Apple Sign-In isn't set up: no Apple provider or keys yet.
- **Push deep links:** `_shared/push.ts` sends `myfettle://sessions/{id}`, but the app's screen is `session/[id]` (singular). One side needs changing before tapping a notification opens the right screen.
- **Open security issue:** users can still insert their own `user_achievements` rows, and those rows unlock the FETTLELOYALTY discount in `create-payment-intent`. Awarding achievements should move to the server.
