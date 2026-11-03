# Admin Overview overhaul: progression and customer analytics

**Owner:** Art (product). **Built by:** the dev team.
**Date:** 28 October 2026
**Where it lives:** the Overview page of the admin area (`/admin`, `src/components/admin/AdminDashboard.tsx`)

## Why we're doing this

The Overview page today shows one-off totals (revenue, sessions, a simple retention funnel). It can't answer the questions we actually ask each week:

- Are more clients going on from one session to the next than they were a few months ago?
- At which stage do we lose the most people, and is that getting better or worse?
- How many brand-new clients did we get in a given period, and how many booked themselves online?
- How many existing clients came back and booked again?

The **Progression** pages (`/admin/progression/1-2` to `4-5`) already show who is moving from session N to N+1, but only for the last 30 days and only as a call list. There is no history and no chart.

This first phase adds two analytics boards to the Overview page:

1. **Progression over time:** how well clients move between session stages, tracked week by week or month by month.
2. **Customers in a time frame:** new customers, new self-booked customers, and returning customers for any date range.

Everything else on the current Overview stays where it is for now (see "Out of scope").

---

## Board 1: Progression over time

### What it should show

**Chart 1a: Stage conversion rate over time (the main chart)**

- A line chart with one line per stage: **1→2, 2→3, 3→4 and 4→5**.
- X axis: the period in which clients completed session N (week or month, the user picks).
- Y axis: the % of those clients who went on to have session N+1 (completed or booked) within the conversion window (default **30 days**).
- Hovering a point shows the period, the stage, the %, and the raw numbers ("42 of 61 clients").
- Each stage line can be switched on or off from the legend.

**Chart 1b: Stage funnel for the selected period**

- A bar or funnel chart showing, for the chosen date range, how many clients completed session 1, 2, 3, 4 and 5+, and the % carried over between each bar.
- The current "Retention funnel" card does a rough version of this. This replaces it, using the corrected definitions below.

**Chart 1c (nice to have): Days between sessions**

- The median number of days between session N and N+1, per stage, over time. This tells us whether clients are rebooking faster or slower.

**Headline tiles above the charts**

For the selected range, compared with the previous range of the same length:

- Overall progression rate (all stages combined)
- 1→2 rate. This is our biggest drop-off, so it gets its own tile.
- Best and worst stage this period
- Change vs the previous period, shown as a percentage-point difference (e.g. "+4.2 pts")

### Definitions (please follow these exactly)

- **Session:** use the existing classifier in `supabase/functions/admin-customer-insights/logic.ts` (`classifyAppointmentType` / `isSession`). Free calls (Let's Talk, Introduction Chat), matching, internal, demo and testing appointments are **not** sessions. Therapy, intro and assessment appointments **are**. Cancelled appointments never count.
- **Customer:** use the same `customerKey` logic as the rest of the admin area: email first, then phone, then the appointment id. This keeps numbers consistent with the Progression and Follow-ups pages.
- **Session number:** a customer's Nth non-cancelled session ever, counted across their **full** Acuity history, not just the date range. Someone on their 5th session this month is at stage 5 even if sessions 1–4 were last year.
- **Progressed:** session N+1 is completed or booked within the conversion window after session N. The window is 30 days by default, with a selector for 14 / 30 / 60 days.
- **Cohort period:** a client belongs to the week or month in which they *completed* session N. Weeks start on Monday. All dates are in **Europe/Dublin** time.
- **Immature periods:** for recent periods, clients haven't had the full window to rebook yet, so the rate is artificially low. Points where the window hasn't fully passed must be shown differently (dashed line or faded point), with a tooltip saying "Still maturing: final figure on DD MMM". Don't hide them.
- **Unverified history:** if a customer's full history can't be confirmed (no email, a failed lookup), leave them out of the rates and show the excluded count in small print. This matches how the Progression pages already behave.

> **To confirm with Art:** "improvement" here is taken to mean improvement in conversion between stages. We don't hold any clinical outcome scores (e.g. symptom questionnaires), so clinical improvement isn't possible yet. If that's wanted later, it's a separate project.

---

## Board 2: Customers in a time frame

### What it should show

**Headline tiles** for the selected range, each with the change vs the previous period:

| Tile | Definition |
|---|---|
| **New customers** | Customers whose **first-ever** session falls in the range. |
| **New self-book customers** | New customers whose first session was **booked by the client themselves** (online), not by staff. Show the count and the % of all new customers. |
| **Returning customers** | Customers with at least one session in the range **and** at least one session before the range started. |
| **Total active customers** | Unique customers with a session in the range (new + returning). |

**Chart 2a: New vs returning over time**

- A stacked bar chart per week or month: new customers (split into self-booked and staff-booked) and returning customers.
- Hovering a bar shows the counts for each segment.

**Chart 2b (nice to have): Self-booking share over time**

- A line showing the % of all bookings made by clients themselves. This tells us whether online booking (website and hub) is taking load off the team.

**Drill-down list**

- Clicking a tile or a bar opens a list of the customers behind the number: name, email, first session date, session type, who booked it, and portal account yes/no.
- Each name links to the relevant admin page (search pre-filled with `?q=`), the same way Sales tasks links today.
- An **Export CSV** button on the list.

### Definitions

- **"Booked in the time frame":** there are two reasonable readings, and the board should support both through a toggle:
  - **By session date** (default): the session takes place in the range.
  - **By booking date:** the booking was *made* in the range, using Acuity's `datetimeCreated`. This is the better measure of sales activity.
- **Self-booked:** the booking was made by the client, through the Acuity scheduling page, the website checkout or the hub. Staff-booked means a team member made it in Acuity.
  - Acuity records this in the appointment's `scheduledBy` field. Client bookings through Acuity's own page have it empty. Bookings made through our API (website checkout and hub) carry the API account's email (`art@blackbird.marketing`, the `API_BOOKED_BY` constant in `supabase/functions/unpaid-sessions/index.ts`). Staff bookings carry that staff member's email.
  - **Watch out:** Acuity's bulk `/appointments` listing does **not** return `scheduledBy`. It is only on the single-appointment endpoint `/appointments/{id}`. This was discovered the hard way on 6 October (see the comment in `supabase/functions/unpaid-session-reminders/index.ts`). So getting this field means one extra request per appointment, which is why the data layer below stores it once rather than fetching it every time the page loads.
  - Art uses the same Acuity account as the API, so bookings he makes by hand will look self-booked. This is a known edge case. Please confirm with Art whether that matters, or whether bookings can be told apart another way (e.g. a hub/website booking also has a matching Stripe payment or a Supabase record).
- **New customer:** based on their first *session*, not their first free call. Someone who had a Let's Talk call in March and a first session in May is new in **May**.
- **First-ever** means across the customer's full Acuity history, so the same full-history requirement applies as in Board 1.

> **To confirm with Art:** should Let's Talk / Introduction Chat calls appear anywhere on this board (e.g. "new enquiries")? This brief assumes **no**: they are leads, not customers. Hot leads already covers them.

---

## Shared controls (both boards)

- **Date range:** presets for last 7 days, last 30 days, last 90 days, this month, last month, this quarter, this year and last 12 months, plus a custom range.
- **Group by:** week or month. Default to month for ranges over 90 days and week otherwise.
- **Compare to:** previous period (default) or same period last year.
- **Filters:**
  - session type: individual, couples, youth, assessment;
  - calendar/therapist.
  - Optional for phase 1, but design the data so it's easy to add.
- Keep the chosen range and grouping in the URL query string so a view can be shared with a link.
- All dates in Europe/Dublin time.

---

## Data: where the numbers should come from

### The problem with fetching live from Acuity

Today every admin page asks Acuity for appointments on the fly. That doesn't work for these boards:

- **Full history is needed.** Session numbers and "new customer" both depend on everything a client has ever booked, going back years.
- **Acuity has no paging and caps each request at 500 appointments.** The current Overview silently loses data because of this.
- **`scheduledBy` needs one request per appointment** (see above), which is far too slow to do on page load.
- **Acuity rate limits.** The admin area already loads pages one at a time to avoid them.

### Recommended approach: a nightly appointment mirror

1. **Create a Supabase table**, e.g. `acuity_appointments`, holding one row per Acuity appointment with:
   - `id`, `customer_key`, `email`, `phone`, `first_name`, `last_name`
   - `appointment_type_id`, `type`, `kind` (therapy / intro / assessment / excluded)
   - `calendar_id`, `calendar`
   - `datetime`, `datetime_created`, `canceled`
   - `scheduled_by`, `booked_by_client` (boolean)
   - `certificate`, `labels`
   - `synced_at`
2. **Backfill it once** from the start of our Acuity history, in small date chunks, following the splitting approach already used in `admin-customer-insights` (7-day chunks, split any chunk that comes back full).
3. **Refresh it on a schedule** (e.g. nightly, plus hourly during the working day), re-pulling a rolling window of roughly 60 days back to 180 days ahead to pick up new bookings, reschedules and cancellations. Only fetch `/appointments/{id}` details for appointments we haven't seen before, to get `scheduledBy`.
4. **Run it the same way as the existing bundles snapshot:** a GitHub Actions cron calling an edge function step by step with the `x-cron-secret` header (see `.github/workflows/admin-snapshots.yml` and `.github/scripts/build-bundles-snapshot.mjs`).
5. **Lock the table down:**
   - RLS on, admin SELECT only through `has_role('admin')`;
   - writes from the service role only.
   - It contains client names and contact details.
6. **Compute the board numbers from the mirror**, either with Postgres views/functions or a new `admin-analytics` edge function. Return aggregated numbers for the charts, and customer lists only when someone drills down.
7. **Reuse the existing logic** for classification and customer keys from `admin-customer-insights/logic.ts` rather than writing new versions, so the boards agree with the Progression and Follow-ups pages. Add the classified `kind` and `customer_key` at sync time.

This mirror will also let us fix the existing Overview numbers later and speed up the other admin pages, so it's worth building properly.

Show a "Data last updated: HH:MM" line on the boards so staff know how fresh the numbers are.

---

## Front end

- Charts: use **Recharts**, which is already installed, through the shadcn chart wrapper in `src/components/ui/chart.tsx`, so styling matches the rest of the app.
- Put the new boards in their own components (e.g. `src/components/admin/analytics/ProgressionBoard.tsx` and `CustomersBoard.tsx`), and add them to `AdminDashboard.tsx` above the existing cards.
- Use the existing admin data-loading pattern in `src/hooks/useAdmin.ts` (`fetchAdminFunction`, TanStack Query, the progress loader in `AdminDataLoader.tsx`).
- Show proper loading, empty and error states. Don't show zeros when the data failed to load: the current Overview does this and it's misleading.
- It must work on a laptop screen and stay readable on a phone.
- Charts need text alternatives: tooltips, plus an accessible table or summary of the same numbers.

---

## Out of scope for this phase

- Redesigning or removing the existing revenue, sessions and engagement cards. They stay as they are for now.
- Clinical outcome tracking.
- Revenue analytics.
- Marketing source / channel attribution (where a client heard about us).
- Changes to any other admin page.

## Known issues on the current Overview to be aware of

These aren't part of this brief, but the team should know about them so the new boards don't repeat them:

- **Revenue, package and client totals probably only reflect the logged-in admin's own rows.** The `admin-metrics` function queries `user_packages` and `profiles` as the user, and the database only lets users read their own rows.
- **Acuity data is capped and failures look like zeros.** Acuity requests are capped at 500 appointments, and failures show as 0 instead of an error.
- **Month boundaries are wrong.** "Last month" drops the last day of the month, and "Canceled (Month)" includes future months.

---

## Acceptance criteria

**Progression board**
- [ ] The progression board shows conversion lines for 1→2 to 4→5, by week or month, for any date range.
- [ ] Recent periods that haven't finished maturing are clearly marked.
- [ ] Rates exclude unverified customers, and the excluded count is visible.

**Customers board**
- [ ] The customers board shows new, new self-booked, returning and total active customers for any date range, with comparison to the previous period.
- [ ] The session-date / booking-date toggle works.
- [ ] Every number can be drilled into to see the customers behind it, and exported to CSV.

**Data and access**
- [ ] For the same period, numbers agree with the existing Progression pages (spot-check at least three periods by hand against Acuity).
- [ ] All dates are Europe/Dublin; weeks start Monday.
- [ ] Only admins can see the data, enforced in the database, not just the UI.
- [ ] The boards load in under 3 seconds once the mirror exists, and show when the data was last updated.

**Testing**
- [ ] Unit tests cover the definitions above, following the existing `logic.test.ts` pattern. Include at least:
  - a client whose first session is in the range but who had a Let's Talk call before it;
  - a cancelled session;
  - a client with no email;
  - a cohort that is still maturing.

## Open questions for Art

1. "Improvement": is conversion between stages the right reading, or is something else meant?
2. The default conversion window: is 30 days right for "went on to the next session"?
3. Should free calls (Let's Talk) appear anywhere on these boards?
4. Self-booked: is it OK that bookings Art makes by hand in Acuity will count as self-booked, or do we need another way to tell them apart?
5. Should "returning" require a minimum gap? For example, only count someone as returning if their previous session was 60+ days ago, i.e. a lapsed client coming back, rather than any ongoing client.
6. Do we need stage 5→6 and beyond, or does 4→5 cover what we care about?

## Useful files

| What | Where |
|---|---|
| Current Overview page | `src/components/admin/AdminDashboard.tsx` |
| Current Overview data | `supabase/functions/admin-metrics/index.ts` |
| Session classifier, customer keys, progression logic | `supabase/functions/admin-customer-insights/logic.ts` |
| Progression pages | `src/components/admin/SessionProgression.tsx` |
| Admin data hooks and caching | `src/hooks/useAdmin.ts`, `src/lib/adminDataCache.ts` |
| Admin menu / sections | `src/lib/adminNavigation.ts` |
| Scheduled job pattern | `.github/workflows/admin-snapshots.yml`, `.github/scripts/build-bundles-snapshot.mjs` |
| `scheduledBy` behaviour | `supabase/functions/unpaid-session-reminders/index.ts` |
| Chart components | `src/components/ui/chart.tsx` (Recharts) |
