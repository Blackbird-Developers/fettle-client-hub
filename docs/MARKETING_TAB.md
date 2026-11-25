# Marketing tab

The admin Overview's **Marketing** tab shows ad spend and results from Google Ads, Meta and TikTok, and what each new customer costs in ads. It sits after Booking funnel and uses the Overview's Date range, Group by and Compare to. Session type and Calendar don't apply, so the tab hides them.

How the data flows:

```
Meta / Google Ads / TikTok APIs
   │  every 4 hours: .github/workflows/marketing-sync.yml
   ▼
marketing-sync (edge function, one channel per call)
   ▼
marketing_daily + marketing_sync_state (Supabase tables)
   ▼
admin-analytics?action=marketing (+ new customers from the Acuity copy)
   ▼
Marketing tab (MarketingBoard.tsx)
```

A channel whose secrets aren't set is skipped, so everything can be deployed before any ad account is connected, and each channel starts working as soon as its secrets are added. On the tab, a channel that was never set up is named under the table as "Not connected"; if its first sync fails, it gets a row with the error.

**Status (25 Nov 2026):** Meta and Google Ads are connected through CreativeHub's existing access. TikTok is on hold; its code stays in and is skipped until its secrets are set. A channel can pull several ad accounts (comma-separated IDs); they show as one channel.

## 1. What the tab shows

| Figure | Definition |
|---|---|
| Ad spend | What each platform reports, in EUR. Spend in any other currency is left out and shown as a warning; nothing is converted. |
| Cost per new customer | All ad spend ÷ new customers in the hub (first-ever session booked in the range, booking-date basis). It's the same count as the Customers board, so it includes customers who didn't come from ads. Customers with no email are left out, as on the board. |
| Conversions | Each channel's own count (agreed with Fettle, Nov 2026). **Meta:** purchases + leads. **Google Ads:** the standard Conversions column, across all its accounts. **TikTok:** Complete Payment + Complete Registration. Channels overlap, so the total can be higher than the real number of new customers. |
| Cost per conversion | A channel's spend ÷ its own reported conversions. |
| CTR | Clicks ÷ impressions. |
| Outbound CTR | Clicks that leave the platform for the website ÷ impressions. Only Meta reports this; other channels show n/a. |

Code: [admin-analytics/marketing.ts](../supabase/functions/admin-analytics/marketing.ts) (definitions, tested) and [MarketingBoard.tsx](../src/components/admin/analytics/MarketingBoard.tsx).

## 2. How the sync works

[marketing-sync](../supabase/functions/marketing-sync/index.ts) does this on every run, for each channel:

1. **Re-pulls the last 28 days** and replaces those rows. Platforms keep revising recent conversions, so recent days can change between runs. Rows the platform no longer returns are deleted, but only after the new ones have saved.
2. **Copies one 90-day chunk of older history**, working backwards to **1 Jul 2025**: a year before the Overview's start date, so "Same period last year" has figures. That takes about 4–5 runs (under a day).

A channel with several accounts pulls them one after another. If any account fails, nothing is replaced on that run and the error names the account, so a channel's figures never cover only some of its accounts.

Days are in each ad account's own time zone, as the platform reports them.

Errors are saved to `marketing_sync_state.last_error` and appear on the tab next to the channel. Tokens are removed from error messages before they're saved, logged or returned.

The workflow ([marketing-sync.yml](../.github/workflows/marketing-sync.yml)) runs at :40 every 4 hours and can also be run by hand from the Actions tab. It uses the existing `REMINDER_CRON_SECRET`, so no new GitHub secret is needed. A run fails if a connected channel errors; skipped channels don't count as failures.

## 3. Secrets (Supabase → Edge Functions → Secrets)

Set them in the Supabase Dashboard. Avoid `supabase secrets set NAME=value` in a terminal, which leaves the token in the shell's history. A channel needs **all** of its required secrets; until then it's skipped. Names must match exactly.

### Meta

| Secret | Required | Value |
|---|---|---|
| `META_ACCESS_TOKEN` | yes | System-user access token with `ads_read` or `ads_management`, never expiring (see §4) |
| `META_AD_ACCOUNT_ID` | yes | Fettle's ad account ID, with or without `act_`. Several are allowed, comma-separated. |
| `META_API_VERSION` | no | Default `v25.0` |

Conversions are purchases + leads, each counted once. Meta reports `purchase` (all purchases, including the pixel's) alongside `offsite_conversion.fb_pixel_purchase` (pixel only), so adding both would count most purchases twice. The sync takes `purchase`, or the pixel figure if Meta didn't report `purchase`. Leads work the same way with `lead` and `offsite_conversion.fb_pixel_lead`. Conversion value is purchase value only. This is set in code (`META_CONVERSION_GROUPS` in [marketing-sync/logic.ts](../supabase/functions/marketing-sync/logic.ts)), not by a secret.

### Google Ads

| Secret | Required | Value |
|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | yes | From CreativeHub's manager account, Admin → API Center (see §4) |
| `GOOGLE_ADS_CLIENT_ID` | yes | OAuth client ID from Google Cloud |
| `GOOGLE_ADS_CLIENT_SECRET` | yes | OAuth client secret |
| `GOOGLE_ADS_REFRESH_TOKEN` | yes | Refresh token for a Google user who can see the Fettle accounts |
| `GOOGLE_ADS_CUSTOMER_ID` | yes | Fettle's three Ads account IDs, comma-separated (dashes are fine), e.g. `123-456-7890,234-567-8901,345-678-9012` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | yes, via CreativeHub | CreativeHub's manager (MCC) account ID, which the access comes through |
| `GOOGLE_ADS_API_VERSION` | no | Default `v26` (supported until Nov 2027) |

Conversions are `metrics.conversions`, the standard Conversions column: the conversion actions marked **Primary** in each Google Ads account. To change what counts, change which actions are primary in Google Ads.

An account taken out of `GOOGLE_ADS_CUSTOMER_ID` keeps the rows already copied; delete them in SQL if they shouldn't count any more. The same goes for Meta accounts.

### TikTok (on hold)

| Secret | Required | Value |
|---|---|---|
| `TIKTOK_ACCESS_TOKEN` | yes | Long-term advertiser access token (see §4) |
| `TIKTOK_ADVERTISER_ID` | yes | The ad account's advertiser ID (not the pixel ID) |
| `TIKTOK_CONVERSION_METRIC` | no | Report metrics added together as conversions, comma-separated. Default `complete_payment,user_registration` (Complete Payment + Complete Registration web events). |
| `TIKTOK_CURRENCY` | no | e.g. `EUR`. Set this to skip looking the account's currency up. |

## 4. Getting the credentials

Fettle's Meta and Google Ads accounts are reached through **CreativeHub**, which already has working Meta and Google Ads API credentials (kept in CreativeHub's AWS). Those can be reused: copy them straight from AWS into the Supabase secrets in §3, never through chat, email or files. Check each one first:

| Reused from CreativeHub | Check |
|---|---|
| Meta access token | In Meta's [Access Token Debugger](https://developers.facebook.com/tools/debug/accesstoken) it shows **Type: System User**, **Expires: Never**, and `ads_read` or `ads_management`. A **User** token with an expiry date (about 60 days) would stop the sync when it expires: make a system-user token instead (Meta steps 2–4 below). |
| Google developer token | CreativeHub's manager account, **Admin → API Center**, shows **Basic** or **Standard** access, not "Test account". |
| Google OAuth client ID + secret | The same client that issued the refresh token. |
| Google refresh token | Belongs to a Google user who can see all three Fettle accounts; the OAuth consent screen is **In production**, not Testing. |
| CreativeHub's manager account ID | Goes in `GOOGLE_ADS_LOGIN_CUSTOMER_ID`. |

Not needed: Meta app ID or app secret, pixel or page IDs, Google API keys or service-account files, redirect URIs.

Sharing CreativeHub's tokens means that if CreativeHub rotates or revokes one, this sync stops too (the error shows on the tab). To keep them independent, give the hub its own Meta system-user token. Sharing the Google developer token is fine, since the hub's use is tiny.

The steps below are for making new credentials if any of the checks fail. The menu paths are as of Nov 2026 and may move.

### Meta (no review wait)

1. In [Meta for Developers](https://developers.facebook.com/apps), create an app of type **Business**, owned by CreativeHub's Business portfolio, and add the **Marketing API** product (or reuse CreativeHub's app).
2. In **Business Settings → Users → System users**, add a system user, e.g. "Fettle hub sync". Employee is enough.
3. **Assign assets**: Fettle's ad account(s), with **View performance** only.
4. **Generate new token**: choose the app, tick `ads_read`, and set expiry to **Never**. Copy the token; it's only shown once.
5. The ad account ID is in Ads Manager's account switcher, or in the URL as `act=…`.

### Google Ads (developer token review: a few days)

1. **Developer token**: in CreativeHub's **manager (MCC)** account, go to **Admin → API Center**. A new token starts with test-account access only. Apply for **Basic access** before it can read real accounts; Google reviews that application.
2. **OAuth client**: in [Google Cloud Console](https://console.cloud.google.com), create a project, enable the **Google Ads API**, and set up the OAuth consent screen. Then create an **OAuth client ID** of type **Web application** with the authorised redirect URI `https://developers.google.com/oauthplayground`. The Playground in step 4 only works with that.
3. **Publish the consent screen** ("In production", or "Internal" on Google Workspace). While it's in "Testing", refresh tokens expire after 7 days and the sync stops. An "unverified app" warning when signing in is expected for an internal tool.
4. **Refresh token**: in the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), click the gear icon, tick "Use your own OAuth credentials", and paste the client ID and secret.
   - Authorise the scope `https://www.googleapis.com/auth/adwords`, signed in as a Google user who can see the three Fettle accounts.
   - Click **Exchange authorization code for tokens** and copy the refresh token.
5. **IDs**: each account's ID is at the top of Google Ads (`123-456-7890`).
   - Fettle's three go in `GOOGLE_ADS_CUSTOMER_ID`.
   - CreativeHub's manager account goes in `GOOGLE_ADS_LOGIN_CUSTOMER_ID`.

### TikTok (on hold; app review: a few days)

1. Register at [TikTok API for Business](https://business-api.tiktok.com/portal) as a developer and create an app with the **Reporting** and **Ad Account Management** scopes. TikTok reviews the app.
2. Once approved, open the app's **advertiser authorisation link**, sign in with a TikTok for Business user that has access to the ad account, and approve. The redirect carries an `auth_code`.
3. Swap it for a long-term access token: `POST https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/` with JSON `{"app_id": "…", "secret": "…", "auth_code": "…"}`. The response has `access_token` and the authorised `advertiser_ids`.
4. The token stays valid until the authorisation is revoked.

## 5. Deploying (in this order)

1. **Migration**: run `supabase/migrations/20261125120000_marketing_daily.sql` on its own in the SQL editor (not `db push`). It's safe to re-run.
2. **`supabase functions deploy admin-analytics`**. It imports `./marketing.ts` and other shared files, so use the CLI.
3. **`supabase functions deploy marketing-sync`**. It imports `../admin-analytics` and `../admin-customer-insights`, so use the CLI. `config.toml` already sets `verify_jwt = false`; the function checks `x-cron-secret` itself.
4. **Front end**: the tab goes live with the normal Vercel deploy from `main`. If the front end goes out before step 2, the tab says it "isn't switched on yet" instead of breaking.
5. **Secrets** (§3): they can be added before or after the deploy. No redeploy is needed.

The workflow starts running on its own once it's on `main`.

## 6. Checking it works

1. In GitHub, go to **Actions → Marketing sync → Run workflow**. A channel without its secrets shows `skipped (secrets not set)` (TikTok, for now) and doesn't fail the run.
2. With Meta's and Google's secrets set, the log should show `meta: ok … N rows; copied from …`, and the same for google.
   - A `FAILED` line carries the platform's error: bad token, missing permission, developer token not approved yet, and so on.
   - With several accounts, the error ends with `[account 1234567890]`.
3. Run it 4–5 more times (or wait a day) to copy the history back to 1 Jul 2025.
4. On the tab, each channel shows **Synced <time>** and its figures appear.
5. **Spot-check** the last 7 full days against Ads Manager and Google Ads over the same days.
   - Spend should match to the cent. For Google, add the three accounts together.
   - Meta conversions should match Ads Manager's **Purchases** + **Leads** columns.
   - Conversions can differ slightly for the most recent days until the next sync.
6. In SQL, if needed:

   ```sql
   select channel, last_success_at, history_from, last_error, last_run_summary
   from marketing_sync_state;

   select channel, account_id, min(day), max(day), count(*), sum(spend)
   from marketing_daily group by channel, account_id order by channel, account_id;
   ```

## 7. Decisions (agreed with Fettle, 25 Nov 2026)

| Question | Answer |
|---|---|
| Cost per new customer and CTR | As proposed: blended cost per new customer (all spend ÷ all new customers), plus each channel's cost per conversion as it reports it. CTR and outbound CTR as in §1. Per-channel attribution from our own data (UTM tags on the booking funnel) could come later. |
| Which channels? | Google Ads and Meta, through CreativeHub's existing access. TikTok on hold. |
| What counts as a conversion? | **Meta:** purchases + leads (`purchase`, `offsite_conversion.fb_pixel_purchase`, `lead`, `offsite_conversion.fb_pixel_lead`, each group counted once, §3). **Google Ads:** the standard Conversions column across all three accounts. **TikTok:** Complete Payment + Complete Registration. |
| Currency | EUR. Any other currency is left out of totals and flagged on the tab. |
