# New booking flow for My Fettle (Client Hub): final implementation brief

**For:** the build in `Blackbird-Developers/fettle-client-hub` (my.fettle.ie).
The hub is React 18 + Vite + TypeScript, Tailwind + shadcn/ui, Supabase auth and edge functions, and Stripe, deployed on Vercel.

**Source of truth for the experience:** the live website version at **https://fettle.ie/book-a-session/?t=319**.
Every text, rule and number in sections 1–15 was taken from the live website code on 2026-10-29 (original brief, kept complete below).

**What is new in this version:** every claim about the hub was checked against `origin/main` at commit `a410b0c` (2026-10-29), the live `fettleschema.therapists_duplicate` table and the live Acuity appointment types and intake forms.
- Section **0** lists what was verified and where the hub differs from the original brief.
- **Hub notes** inside sections 1–15 say exactly how each rule maps onto the real code.
- Section **16** is the step-by-step build plan, section **17** the full list of decisions (original Q1–Q9 plus new ones from the verification), section **18** how everything was checked.

**Repo status:** nothing has been built yet and no code was changed while preparing this brief. When the build starts, the first commit saves this file in the repo as `docs/QUIZ_BOOKING_FLOW.md`.

**How to read this:**
- Sections 1–9 describe what the website does. Rebuild the same experience.
- Section 10 says how it maps onto the hub (now with verified file paths and backend facts).
- Sections 13 and 17 list the decisions to confirm before coding.
- Section 16 is the build order.

---

## Contents
0. Verified against the hub: findings and corrections
1. Why this exists
2. The flow at a glance
3. Screens, step by step (exact copy)
4. Business rules
5. Availability and time rules
6. Matching (no therapist chosen)
7. Payment, discounts and booking
8. Errors and edge cases
9. Analytics
10. Mapping onto the hub
11. Design and layout
12. State, navigation and accessibility
13. Decisions to confirm before coding (original)
14. Acceptance checklist
15. Out of scope
16. Build plan
17. All open decisions (original + new)
18. Verification log

---

## 0. Verified against the hub: findings and corrections

### 0.1 Confirmed as the brief says
| Brief claim | Verified |
|---|---|
| Stack | React ^18.3.1, Vite ^5.4.19, TS ^5.8.3, Tailwind ^3.4.17, shadcn/ui, `@supabase/supabase-js` ^2.89, `@stripe/react-stripe-js` ^5.4.1, `@tanstack/react-query` ^5.83, `react-router-dom` ^6.30, `date-fns` ^3.6, zod, react-hook-form. Vercel (`vercel.json` SPA rewrite). |
| `ProtectedRoute` + `CustomerOnly` | Both exist (`src/components/auth/CustomerOnly.tsx`; admins are sent to `/admin`). All customer routes in `src/App.tsx` use `<ProtectedRoute><CustomerOnly>…`. |
| Hooks | `src/hooks/useAcuity.ts` (`useAcuityCalendars`, `useAcuityAppointmentTypes`, `useAcuityAvailability`, `useAcuityTimes`, `useAcuityAppointments`), `src/hooks/usePooledAvailability.ts`, `src/hooks/useNextAvailable.ts` (exports `fetchDates`, `fetchTimes`, `resolveSlotCalendar`). |
| Docs | `NEXT_AVAILABLE_APPOINTMENT.md`, `ASSESSMENTS_BOOKING.md`, `PSYCHIATRY_BOOKING.md`, `BUNDLE_CODES.md` are in the repo root; `docs/UNPAID_SESSIONS_FRONTEND.md` in `docs/`. |
| Single session pay + book | Edge functions `create-payment-intent`, `confirm-payment-and-book`, `verify-payment-and-book`; `src/components/booking/PaymentForm.tsx`; `PaymentRedirectHandler.tsx` + `src/hooks/usePaymentRedirectReturn.ts`. |
| Bundle purchase | `create-package-payment-intent`, `create-package-payment`, `confirm-package-payment`, `verify-package-payment`; `PackagePaymentForm.tsx`, `PackageBookingModal.tsx`. |
| Booking with credits | `book-with-package`; `src/hooks/useUserPackages.ts`; `src/components/dashboard/PackageSessionsCounter.tsx`. |
| Prices | `src/lib/sessionBundles.ts` (`SESSION_BUNDLES`, `formatEuro`, `findSessionBundle`) and `src/lib/packageCategory.ts` match §4.1 exactly. |
| Therapist table | `fettleschema.therapists_duplicate` exists and has every field §4.2 uses (see 0.3). |
| `BookingModal.tsx` | 3,334 lines; steps `type → pricing → therapist → date → time → details → confirm → payment → success`. |
| Unit tests | Vitest ^2.1.9 + Testing Library + jsdom are set up (`npm test` = `vitest run`, setup `src/test/setupDom`, examples in `src/components/admin/*.test.tsx`). |

### 0.2 Corrections to the original brief
| # | Original brief says | Reality in the hub | Consequence |
|---|---|---|---|
| C1 | `PackageCreditsCard` is a dashboard component | It is `src/components/sessions/PackageCreditsCard.tsx` | Path only. |
| C2 | `book-with-credit` books with package credits | `book-with-credit` books a session **fully covered by referral credit** (no Stripe). Package credits use **`book-with-package`** only. | Use `book-with-package` for "Use 1 of your N remaining sessions". Keep referral credit as a separate option (Q18). |
| C3 | Entry points: `BookSessionDropdown`, `MyTherapist`, `BookAgainPrompt`, `Packages` | `<BookingModal>` is also opened from `src/pages/Sessions.tsx`, `src/pages/GetStarted.tsx` (bundle funnel) and `src/pages/Psychiatry.tsx`. `MyTherapist` opens it twice. | Include `Sessions.tsx` in the rollout plan; Psychiatry stays (Q5); `GetStarted` see Q14. |
| C4 | §7.1 "If the intent was authorised only (`requires_capture`), capture it after booking" | `create-payment-intent` creates **auto-capture** intents (`automatic_payment_methods`, no manual capture, so Revolut Pay/PayPal work). `confirm-payment-and-book` already handles both: captures `requires_capture` after booking, cancels it if booking fails, and **refunds** auto-captured payments when booking fails (after checking the booking doesn't already exist). | No new capture logic in the frontend. The "Charged, but booking failed" message must say a refund is coming (backend refunds automatically). |
| C5 | §7.2 "Re-pricing must update the **same** intent (`updatedExistingIntent`)" | `create-payment-intent` **always creates a new intent**; it has no `paymentIntentId` input and never returns `updatedExistingIntent`. There is no endpoint to cancel an abandoned intent. | Needs a backend change (Q13). An intent that is never confirmed is never charged, so the safe interim is: re-create on code change and never confirm the old one. |
| C6 | §7.2 Welcome offer (TENOFF) eligibility comes from the backend | Nothing in the hub knows about TENOFF or a welcome offer. `create-payment-intent` **rejects** Stripe promotion codes restricted to first-time transactions (`couponRejected: "promo_restricted"`). | Welcome offer needs backend work (Q12). Until then the modal is not shown. |
| C7 | §4.6 intake fields 10466116 / 9292394 / 9292405 / 10104284 | Verified on the live Acuity forms (see 0.4): youth types **require 13686405** and do not have 10466116/9292394/9292405; psychologist types **require 9291898**; Lisa Kelly's couples type has **no intake form**, so the partner name field would be dropped. | Send the fields per service from 0.4. Put the partner name in the notes too. |
| C8 | §10.2 prefill details "from the profile" incl. phone | `profiles` has `first_name`, `last_name`, `email`, `timezone` — **no phone**. Acuity appointments do have `phone`. | Prefill phone from the client's latest Acuity appointment (`useAcuityAppointments`), else ask (Q17). |
| C9 | §3.7 / Q8 reuse `/booking-success` | `src/pages/BookingSuccess.tsx` handles the old Stripe **Checkout** return (`session_id` → `verify-payment-and-book` / `verify-package-payment`), not PaymentIntents. | Build the Done screen inside the wizard (Q8 answer). |
| C10 | §9 analytics with GTM `dataLayer`, Comet | The hub has **no** GTM, `dataLayer`, `gtag` or Comet anywhere (`src/`, `index.html`). | Needs the GTM container ID and adding the GTM snippet (Q11). Comet not used. |
| C11 | §11 Nunito, orange `#ff7300` | Hub theme: **DM Sans** (body) + **Sora** (headings), primary `hsl(24 80% 55%)`, radius `1rem`, and a **dark mode** (`.dark` tokens in `src/index.css`). | Decide website look vs hub theme, and dark mode (Q10). |
| C12 | §3.2 calendar "this month + 11" | Today's `BookingModal` limits to 3 months (`toDate={addMonths(new Date(), 3)}`). The Acuity edge function works for any month. | Follow the brief (12 months) in the wizard. |
| C13 | §4.1 badge flags: youth 3 "Most popular", couples 5 "Biggest saving" | `SESSION_BUNDLES` marks **youth 5** and **couples 5** as `popular: true`, and `PackageBookingModal` shows them as "Most Popular". | The wizard uses the brief's flags from its own plan metadata; don't change `SESSION_BUNDLES.popular` without agreement (Q20). |
| C14 | "Nothing in this brief has been started" | True for the wizard. Related work already live: the `/packages?bundle=&therapy=` → `/get-started` bundle funnel (pay bundle, then book first session with automatic therapist assignment on **topic** types), and the "rebook your past therapist" shortcut in `BookingModal` (commit `9bd202b`). | See Q14 and §10.5. |
| C15 | (not in brief) | `create-payment-intent` takes the price **from the client** (`appointmentTypePrice`). | Send the Acuity type's price as today's `BookingModal` does. Flag to the backend owner as a separate hardening item (out of scope here). |
| C16 | (not in brief) | Global `PaymentRedirectHandler` (mounted in `App.tsx`) handles every return with `payment_intent_client_secret` in the URL using sessionStorage key `fettleRedirectPayment`; after a package payment it navigates to `/packages`. It already skips returns carrying `SETTLEMENT_RETURN_PARAM` (unpaid-session flow). | The wizard must add its own return marker param and the same skip guard, then finish the booking itself (§7.4 hub note). |
| C17 | (not in brief) | Stripe metadata values are capped at **500 characters**; notes travel in PaymentIntent metadata (see `PSYCHIATRY_NOTES_MAX_LENGTH = 500`). | The §4.5 notes string must be trimmed to 500. |
| C18 | (not in brief) | The local `.env` uses a **live** Stripe key (`pk_live`). | "Stripe test mode end to end" (§14) needs a test environment: test publishable key + Supabase functions running with test secret keys (Q22). |

### 0.3 Live therapist data (`fettleschema.therapists_duplicate`, 113 rows)
- Columns: `id, name, url, calendarid, imageurl, status, tag1, tag2, tag3, tag4, tag5, tags (array), tags2 (comma string), appointmentidindividual, appointmentidcouples, appointmentidyouth, quote, Accreditation, Insurance, isPsychologist, ocdAssessment, anxietyAssessment, depressionAssessment`.
- `status`: 52 `active`, 61 `inactive`. `calendarid` is a **string** (108 filled). Empty appointment ids can be `null`, `""` or the **string `"NULL"`**: treat all three as empty.
- Active therapists: 48 with an individual type, 10 with a couples type, 7 with a youth type, 4 psychologists (`isPsychologist` values are only `null` or the string `"true"`).
- `url` is the fettle.ie profile URL (e.g. `https://fettle.ie/our-therapists/elaine-o-dwyer`): the slug for §8 lookups is its last part.
- The hub reads this table today only in `src/hooks/useTherapistImages.ts` (columns `calendarid, imageurl, tags, tags2, Accreditation`, keyed by calendar id). The wizard needs the full row.
- **Important difference:** the website books each therapist's **own** Acuity type ("Individual Session with {Name}", €95, 50 min, 1 calendar; all 48 active individual ids are public types). Today's hub individual booking uses the **topic** types ("Individual Therapy Session (Anxiety)", pooled across many calendars). The wizard follows the website: book `appointmentidindividual` / `appointmentidcouples` / `appointmentidyouth` with that therapist's `calendarid`.
- Youth types: Trisha Norry, Linda Linnane, Emma Hand, Doreen Maher, Concillia Jackson → "Youth Therapy - Individual Session with …" (60 min, €125). Ana Moore's youth id is "Youth Therapy - Introductory Appointment (Guardian + Child)" (she is on the not-accepting list anyway). Fergal Clancy's youth type is not public (he is on the youth-excluded list).
- Psychologists (all active): Zai Edworthy, Judith Malone, Fabiola Honorio (OCD + anxiety + depression), Jennifer Cuppage (OCD only). They share the types `92852936` OCD, `92853020` anxiety, `92853161` depression ("… Assessment Screening", €89, 30 min) — the same ids as `ASSESSMENTS` in `src/lib/assessments.ts`. Book with the psychologist's `calendarid`.
- Name lists (§4.3) all exist in the table: Ana Moore, Janet Homan, Emma Keane, Brendan Slattery, Doreen Maher, Fergal Clancy, Lisa Kelly, Nicole Dunne, Olivia Fahy (all `active`).
- Tags need normalising: live values include `self esteem`, `self-esteem` and `self esteem,` (trailing comma), `anger management`, `loss` and `grief`, `eating disorders` / `eating-disorders`. Lower-case, trim, strip trailing punctuation, `self esteem` → `self-esteem`.

### 0.4 Live Acuity intake forms per type (from the public scheduling pages)
| Booked type | Forms and fields | Send |
|---|---|---|
| Individual (therapist's own type, all 48) | "Intake Form" 1679944: **10466116** over-18 (checkbox, required), **9292394** contact (yes/no, required), **9292405** terms (yes/no, required); plus "Where did you hear about Fettle?" **18105514** (dropdown, optional: Social Media, Google, AI Chatbots, Influencers, Friends or Family); "Onboarding Details" 17395480 (admin only) | 10466116, 9292394, 9292405 |
| Couples (9 of 10 types) | Intake Form 1679944 (same three) + "Couple's Therapy" **10104284** partner name (required) | 10466116, 9292394, 9292405, 10104284 |
| Couples: Lisa Kelly `99207008` | **No forms attached** | Same fields (backend drops invalid ones); partner name **also in notes** |
| Youth individual sessions | "Youth Therapy - Subsequent" **13686405** consent-form acknowledgement (checkbox, **required**); 18105514; 17395480 | **13686405** (+ 9292405 harmlessly dropped). The original brief's §4.6 omits 13686405. |
| Psychologist screening types | "Terms of Use, Security & Confidentiality" **9291898** (checkbox, **required**) | **9291898** |

How the backend treats fields today: `confirm-payment-and-book` removes any field Acuity reports as invalid for the type and retries, and adds a missing **required** field with `yes` and retries; `book-with-package` retries without fields on `invalid_fields`. Values must be non-empty (`book-with-package` filters empty values).

### 0.5 Already handled elsewhere
- The €85 / €95 "price rise" rule is **done in the backend** by Ernest (commit `37f09c4`, 2026-09-23): adult sessions booked before 26 Aug 2026 are priced €85 in `unpaid-sessions`, `pay-session` and `unpaid-session-reminders`, and the reminder email now uses the house template. New bookings from this wizard use the current Acuity price; nothing to do here.

---

## 1. Why this exists

The old booking popup asked everything first and showed times last. Alex (Fettle) asked to move the time picker to the start:

> Should we have the time selection at the start of the process in case they get to the end and the therapist
> doesn't have a good time slot for them? … Some therapists only have very limited times so if they go over the
> whole process and see no time at the end there is risk of losing them.

Alex's required order: **individual/youth/couples → select time → history → details → payment.**

Other feedback that shaped the website version (keep all of it):
- **No auto-advance.** Picking an answer must not jump to the next step after a delay. The client picks, then presses **Continue**.
- **Don't say "first session"** before we know. The history question asks whether they are new or returning.
- **Spacing:** every element needs breathing room; it must look clean, balanced and modern on desktop and phone.
- Prices appear only at the Payment step, after the questions.

> **Hub note:** the live `/get-started` page says "Book your first session" and "your first … session" before any history question. That page is the bundle funnel (the client arrives from a fettle.ie bundle link), so it is outside this wizard; if the wizard replaces its booking step later (Q14), use the wizard's wording.

## 2. The flow at a glance

**With a therapist chosen** (the normal case, e.g. from "Book Now" on a therapist):

```
Intro → 1 Who it's for → 2 Date & time → 3 About you (history) → 4 Your details → 5 Payment (plan → review → pay) → Done
```

**Progress bar labels:** `Who it’s for · Date & time · About you · Your details · Payment`.
For psychologists the first label reads `Consultation`.

| Variant | Order |
|---|---|
| Therapist chosen | intro → who* → **slot** → history → details → plan → review → pay → done |
| Therapist offers only one service, or the service was given in the link | intro → **slot** → history → … (who is skipped) |
| No therapist chosen (matching) | intro → who → focus (topics) → match → **slot** → history → details → plan → review → pay → done |
| Psychologist | intro → assessment (if the therapist offers more than one) → **slot** → history → details → review → pay → done (no plan step, €89) |
| Bundle chosen at plan (website only) | … → plan → bundle hand-off screen → my.fettle.ie/packages. **In the hub this should be a real purchase, see §10.4.** |

\* "who" is skipped when only one option is possible.

The question numbers ("Question 1", "Question 2"…) count only the question steps (who, assessment, focus, history), in the order they appear.

> **Hub notes:**
> - If Q2 skips the history question for returning clients, the step list (and question numbering) is computed without it.
> - If Q3 shows the compact "Booking for …" row, the details step still exists (it holds the partner/young person/note inputs).
> - Clients with usable package credits for the service skip nothing, but Payment shows the credit option first (§10.2).

## 3. Screens, step by step (exact copy)

The copy below is the current website wording. Use `{Name}` for the therapist's full name and `{First}` for their first name.

### 3.0 Intro
- **Therapist chosen:**
  - Large photo (or initials).
  - Eyebrow: `✦ Book with {First}`.
  - Heading: **`Your session with {Name}`**.
  - Accreditation badge, e.g. `APCP Pre-Accredited` / `PSI Accredited`.
  - Lead text:
    - therapy: `Start by choosing a time that suits you. Then a few quick questions help {First} prepare for your session.`
    - psychologist: `A 30-minute clinical consultation with a validated assessment, then a clear plan for what comes next.`
  - The therapist's quote in italics, if they have one.
  - Button `Let’s begin →`, with `🕐 Takes about 2 minutes` next to it.
  - Three trust items: `Accredited therapists` · `Online, from home` · `Insurance receipts`.
- **No therapist chosen:**
  - Eyebrow `✦ Book a session`.
  - Heading `Let’s find the right therapist for you`.
  - Lead: `Answer a few short questions and we’ll match you with an accredited therapist, then you can pick a time that suits you.`
  - Button `Get started →`, plus `Takes about 2 minutes`, plus the trust items.
- **Therapist not bookable or not found** (not accepting, hidden, no services, or the link points to nobody):
  - Eyebrow `⚠ Not available right now`.
  - Heading: one of
    - `{First} isn’t taking new bookings right now` (not accepting, hidden or inactive)
    - `{First} has no sessions open for online booking`
    - `{First} has no consultations open for booking` (psychologist)
    - `We couldn’t find that therapist` (unknown id or slug)
  - Lead: `Answer a few quick questions and we’ll match you with an accredited Fettle therapist who has availability.`
  - Button `Find me a therapist →`, which switches to the matching flow.

> **Hub notes:** photo = `imageurl`, badge = `Accreditation`, quote = `quote` (all from `therapists_duplicate`). Use the existing `TherapistAvatar` from `src/components/dashboard/MyTherapist.tsx` for the initials fallback.

### 3.1 Who it's for (Question 1)
- Heading `Who are the sessions for?`.
- Sub-text:
  - therapist chosen: `{First} offers the options below.`
  - otherwise: `This helps us show the right therapists and session length.`
- Options (only the ones the therapist offers, see §4.2). Each is a large row with an icon, title and description, and a tick on the right:
  - `Just me`: `One-to-one therapy for you`
  - `Me and my partner`: `Couples therapy, both partners attend`
  - `My child or teenager`: `Youth therapy for young people, booked by a parent`
- `Continue →` is disabled until an option is picked. The hint `or press Enter ↵` shows on desktop only.
- Changing the answer clears topics, plan, slot and any payment in progress.

### 3.1b Consultation type (psychologists, Question 1)
- Heading `What would you like to explore?`.
- Sub: `Each consultation includes a validated clinical questionnaire, so {First} can give you clear next steps.`
- Options (only those the psychologist offers):
  - `Depression consultation`: `30 minutes · PHQ-9 validated`
  - `Anxiety consultation`: `30 minutes · GAD-7 validated`
  - `OCD consultation`: `30 minutes · Validated screening`
- Skipped when there is only one.

> **Hub note:** the type ids are the `ASSESSMENTS` screening ids in `src/lib/assessments.ts` (92853161 depression, 92853020 anxiety, 92852936 OCD). Jennifer Cuppage offers OCD only, so the step is skipped for her. The addiction assessment (94856237, €140 override) is not part of this flow.

### 3.2 Date & time
- Eyebrow `📅 Date and time`.
- Heading `When suits you?` (`When suits you, {client first name}?` if known).
- Sub: `{50-minute session | 60-minute session | 30-minute consultation} with {Name}, online.`
- **While loading:** skeleton bars plus `Checking {First}’s calendar…`.
- **Earliest card** (dashed orange border, ⚡ icon):
  - Text: `Earliest time: Wednesday, 28 October at 5:00pm`, with `Tap to choose it, or pick another time below`.
  - With a time-of-day filter on, it reads `Earliest morning time: …`.
  - Tapping it selects that slot. The card hides once that exact slot is selected.
- **Time-of-day control:** a segmented control `Any time · Mornings · Afternoons · Evenings`.
  - Mornings are before 12:00, afternoons 12:00–17:00, evenings from 17:00, all in Irish time.
  - It is full width on phones.
- **Calendar:**
  - Month view starting Monday (`Mo Tu We Th Fr Sa Su`), with ‹ › arrows limited to this month and the next 11 months.
  - Days with times are highlighted and clickable.
  - With a filter on, days without times in that part of the day look faded.
  - Today is marked.
  - A month with nothing shows `No open times this month. Try the next one.`
- **Times for the chosen day:**
  - Header: `Wednesday, 28 October`, with `3 times available` under it.
  - Times are grouped under `Morning · n`, `Afternoon · n`, `Evening · n` as pill buttons, e.g. `5:00pm`.
  - If the filter hides every time on that day, all times are shown with the note `No mornings on this day, so we’re showing all times.`
  - Footer: `All times are shown in Irish time.`
- **Button:** `Choose a time to continue` (disabled) becomes `Continue →` once a time is picked.
- **No times in the next 12 months:**
  - Message: `{First} has no open times in the next 12 months.` followed by:
    - therapist chosen: `We can match you with another therapist who has availability.`
    - otherwise: `Please choose another therapist.`
  - Button `Find another therapist →`, which goes to matching.
- **Availability failed to load:** `We couldn’t load {First}’s calendar just now. Please try again.` with a `Try again` button.

> **Hub notes:**
> - Data: `fetchDates(typeId, 'yyyy-MM', calendarId)` and `fetchTimes(typeId, 'yyyy-MM-dd', calendarId)` from `src/hooks/useNextAvailable.ts` (they return `[]` on error; the wizard needs a variant that **throws** so "failed to load" can be shown). Times come back with the Dublin offset, e.g. `2026-09-24T07:00:00+0100`.
> - Knowing the time-of-day for every day of a month needs times per day, not just dates: fetch times for the visible month's available days lazily (and cache with react-query), or show the faded state only once a day's times are known. Decide during build; keep calls bounded.
> - The shadcn `Calendar` (`src/components/ui/calendar.tsx`, react-day-picker) takes `weekStartsOn={1}`, `fromMonth`/`toMonth` and custom modifiers for "has times" / "faded".

### 3.3 About you (history)
- Heading:
  - adult: `Have you had therapy before?`
  - youth: `Have they spoken to a therapist before?`
- Sub: `There’s no wrong answer. It just helps {First} know where to start.`
- Options. Youth uses the titles in brackets and no descriptions.

| Option | Title | Description |
|---|---|---|
| first | `This is my first time` (`This is their first time`) | `Never tried therapy before` |
| past | `I’ve had therapy before` (`They’ve had therapy before`) | `Coming back to it` |
| switching | `I’m looking to switch therapist` (`They’re switching therapist`) | `Currently seeing someone` |

- After picking, a green note appears under the options. It does **not** move on by itself:

| Option | Note |
|---|---|
| first | `Taking the first step is often the hardest part. We’ll keep the rest simple.` |
| past | `Welcome back. Your therapist will build on what’s helped you before.` |
| switching | `Finding the right fit matters. You’re in good hands.` |

- `Continue →` is enabled once an option is picked.

> **Hub note:** "has past sessions" (for Q2) = the client has any non-cancelled Acuity appointment (`useAcuityAppointments(profile.email)`), the same data `BookingModal` uses for "previous therapist".

### 3.4 Your details
- Eyebrow `Almost there`.
- Heading:
  - adult: `Great. Where should we send your confirmation?`
  - youth: `Your details as parent or guardian`
- Sub: `We’ll use these to confirm your booking and send your session link.` Youth adds `We’ll contact you, not your child.`
- Fields (two columns on desktop, one on phones):

| Field | Placeholder | Notes |
|---|---|---|
| First name | `e.g. Sarah` | — |
| Last name | `e.g. Byrne` | — |
| Email | `you@example.com` | full width |
| Mobile number | `+353 87 123 4567` | full width |
| `Your partner’s name (and pronouns)` | `e.g. Alex Byrne (he/him)` | couples only, required |
| `Young person’s first name (optional)` | `e.g. Jamie` | youth only |
| `Anything you’d like {First} to know? (optional)` | `You can share as much or as little as you like.` | 3-line text area |

- Privacy line: `🔒 Your details are confidential and only shared with your therapist.`
- Button `Continue to payment →`.
- **Validation** runs on Continue. It shows errors under each field, focuses the first bad one and scrolls to it:

| Field | Rule | Message |
|---|---|---|
| First / last name | 2–50 characters | `Please enter your first name` / `First name must be at least 2 characters` / `… under 50 characters` (same for last name) |
| Email | `^[^\s@]+@[^\s@]+\.[^\s@]+$`, ≤100 characters | `Please enter your email` / `Please enter a valid email address` |
| Phone | only digits, spaces, `+ - ( )`, at least 8 digits | `Please enter your mobile number` / `Please enter a valid phone number` |
| Partner (couples) | required | `Please add your partner’s name` |

> **Hub notes:** prefill first/last name and email from `profile` (`useAuth`), phone from the latest Acuity appointment (C8). The hub already has zod + react-hook-form; plain state with the rules above is also fine (keep messages exact).

### 3.5 Payment, part a: plan (not for psychologists)
- Eyebrow `🏷 Your plan`.
- Heading `How would you like to start?`.
- Sub: `Pay as you go for {Wednesday, 28 October} at {5:00pm}, or save with a bundle.`
- A grey strip with the therapist avatar: `Sessions with {Name}`, with `{50|60} minutes, online · insurance receipts provided` under it.
- **Plan rows** (full width; tick on the left; name and description; price on the right):
  - Main line: name, e.g. `3-session bundle`, with `3 x 50-minute sessions · A gentle start` under it.
  - Right side: big `€90.50` with `/ session`. Under it `€271.50 total` plus a green `Save €13.50` pill, or `Pay as you go` for a single session.
  - Only the **selected** row expands to show its features list with green ticks.
  - A small badge sits on top of the row border: the recommended row gets an orange `RECOMMENDED FOR YOU`; others show their own flag (`MOST POPULAR`, `BEST VALUE`, `BIGGEST SAVING`) in dark.
  - "More" plans (individual 9-session) are hidden behind a link `Looking for longer-term support? See 1 more option`. A hidden plan still shows if it is the selected one.
- Under the rows, a soft orange note gives the recommendation reason (§4.4).
- The recommended plan is preselected. Button `Continue →`.

> **Hub note:** amounts are formatted with the existing `formatEuro` (`€271.50`, `€90.50`, `€108.33`).

### 3.5 Payment, part b: review
- Eyebrow `✓ Review`.
- Heading `Everything look right?`.
- Sub: `Check your booking, then continue to secure payment.`
- Rows, each with an icon, a small label, a bold value and an `Edit` link:
  - `Therapist` — {Name}. Edit goes to the intro (therapist chosen) or the matches.
  - `Date and time` — `Wednesday, 28 October at 5:00pm (Irish time)`.
  - `Plan` (or `Consultation`) — plan title.
  - `Your details` (youth: `Parent or guardian`) — `Sarah Byrne · sarah@…`.
  - `Partner` — couples only.
- **Editing time, plan or details returns straight to review** after Continue. The client does not walk the steps again.
- Total box: `Total due today`, with the amount on the right and a small line under it:
  - bundle: `€90.50 per session · you save €13.50`
  - psychologist: `30-minute clinical consultation`
  - single: `Pay per session, no commitment`
- **Discount code:** label `Have a discount code?`, an input and an `Apply` button.
  - The code is uppercased and saved, with the note `Code saved. Your total is confirmed on the next step.`
  - It is actually checked when the payment is created (§7).
- **Three required consent checkboxes:**
  1. Adult: `I confirm I am over 18. This service is for over 18s only.` Youth: `I am the parent or legal guardian of the young person attending.`
  2. `I agree to be contacted by email and text by Fettle. Texts are how we send your session log-in details.`
  3. `I accept the terms of use, including the 48-hour cancellation policy.` "terms of use" links to https://www.fettle.ie/terms-of-use.
  - If any box is missing on Continue, mark it and show `Please tick all three boxes to continue.`
- Button `Continue to payment →`.

> **Hub notes:**
> - Codes go to `create-payment-intent` as `couponCode` (one field handles loyalty codes `FETTLELOYALTY4/5/8/10`, Stripe promotion codes, Acuity coupons). Today's hub never sends codes or referral credit for assessments/psychiatry; keep that for psychologist consultations unless Q12 says otherwise.
> - If the code is a **session-bundle certificate**, `create-payment-intent` returns `packageCertificate` and no intent; today's `BookingModal` links it (`redeem-package-code`) and books with `book-with-package`. The wizard must do the same (`BUNDLE_CODES.md`).
> - Discount codes apply to single sessions only; a bundle purchase goes through `create-package-payment-intent` (check what it accepts before showing the code field on bundle plans).
> - Youth consent 1 must map to Acuity field 13686405, whose live wording is "I acknowledge and agree that I have completed the mandatory consent form for Fettle Youth Therapy" (Q15).

### 3.5 Payment, part c: pay
- Eyebrow `🔒 Secure payment`.
- Heading `Confirm and pay`.
- Sub: `{Wednesday, 28 October} at {5:00pm} with {Name}.`
- Grey bar: `Amount to pay` with the amount, e.g. `€95.00`. It updates when a discount applies.
- **Discount banner** under the bar:
  - applied (green): `✓ Discount applied · CODE`, then `You save €10.00 — you pay €85.00 ~~€95.00~~`
  - rejected (amber): the rejection message from §7.3
- Stripe Payment Element (tabs layout). Appearance:
  - primary `#ff7300`, text `#2d2c2b`, radius 12px, Nunito font
  - inputs: 1.5px border `#ebe2d6`; focus border `#ff7300` with a soft orange glow
  - labels: bold
- Full-width button `🔒 Pay €95.00`. While busy its text changes:
  - `Checking your time is still free…`
  - `Processing payment…`
  - `Waiting for verification…`
  - `Confirming your booking…`
  - `Updating price…`
- Under the button: `🛡 Payments are processed securely by Stripe. We never see your card details.`

> **Hub notes:** Stripe is loaded with `VITE_STRIPE_PUBLISHABLE_KEY` (see top of `BookingModal.tsx`). `create-payment-intent` returns `discountApplied`, `discountPercent`, `discountAmount`, `originalAmount`, `couponRejected`, `referralCreditApplied`, or `fullyCovered: true` (referral credit covers everything → book with `book-with-credit`, no card).

### 3.6 Bundle hand-off (website only, replace in the hub)
On the website, choosing a bundle shows a "what happens next" screen and sends people to my.fettle.ie/packages, because the website cannot sell bundles. The screen has:
- Eyebrow `Great choice`.
- Heading `Your 3-session bundle`.
- A price box.
- Three numbered steps:
  1. `Buy your bundle on My Fettle`
  2. `Book your first session with {First}`, which mentions the chosen time and that it isn't held
  3. `Meet online`
- `Use {email} on My Fettle so your account matches your answers.`
- Button `Continue to My Fettle →`.
- Link `Book {Wednesday, 28 October at 5:00pm} now for €95`, which switches to a single session.

**In the hub, don't hand off: buy the bundle and book the chosen slot in one go (§10.4).**

### 3.7 Done
- Big green tick. Heading `You’re booked, {client first name}!`.
- Sub: `{Wednesday, 28 October at 5:00pm} with {Name}. A confirmation is on its way to {email}.`
- If the payment was taken but couldn't be finalised (capture failed), add: `Your session is booked, but we couldn’t finalise the payment. Our team will be in touch. Please don’t book again.`
- Three numbered steps:
  1. `Check your inbox`: `Your confirmation email has the date, time and how to manage your booking.`
  2. `Look out for your session link`: `We’ll text and email your secure log-in details before the session.`
  3. `Meet {First} online`: `Find a quiet, private spot. That’s all you need.`
- Button `📅 Add to Google Calendar`:
  - title `Fettle session with {Name}`
  - correct length: 50, 60 or 30 minutes
  - details `Your online session link will be sent by text and email before the session.`
- Optional chips: `One last thing: how did you hear about Fettle? (optional)`:
  - `Google`, `Social media`, `Friend or family`, `GP or healthcare provider`, `Insurance provider`, `Other`
  - After a pick the label becomes `Thanks for letting us know!`
- **In the hub**, also offer `Go to my sessions` / `Back to dashboard`, and refresh the sessions list (see §13).

> **Hub notes:**
> - Refresh by invalidating the react-query caches the hub uses: `['user-packages']`, `['unpaid-sessions']`, and the appointments data (`useAcuityAppointments`).
> - Bundle purchases add `{n} sessions left in your bundle` (§10.4).
> - The "how did you hear" chips differ from the Acuity field 18105514 options (Q16).
> - The confirmation email is sent by `confirm-payment-and-book` / `book-with-package` already; the wizard sends nothing extra.

### 3.8 Summary card (beside the steps; under them on phones)
- **Header:** therapist photo, name and accreditation badge. With no therapist yet: a people icon, `Your therapist`, `Matched to your answers`.
- Title `YOUR BOOKING`, then rows in flow order. Each row shows a grey placeholder until answered, then a green ✓ with the value:
  - who: `Individual therapy` / `Couples therapy` / `Youth therapy` / `Psychology consultation`
  - psychologist: the consultation type
  - date and time: `Wednesday, 28 October · 5:00pm`
  - topics (matching only)
  - plan, shown once at Payment
- **Total:** shown once at Payment, e.g. `Total €271.50`. It becomes `Total after discount` when a code applies.
- A second card with five assurances:
  - `Accredited, vetted therapists`
  - `Online sessions from home`
  - `Evenings and weekends available`
  - `Insurance receipt after every session`
  - `Secure payment by Stripe`

## 4. Business rules

### 4.1 Session lengths and prices (Aug 2026 register)
These match the hub's `src/lib/sessionBundles.ts` (`SESSION_BUNDLES`). Use that file; don't hard-code a second copy.

| Service | Single | Bundles | Length |
|---|---|---|---|
| Individual | €95 | 3 = €271.50 (€90.50 each, save €13.50) · 6 = €528 (€88, save €42, "Most popular") · 9 = €765 (€85, save €90, "Best value", hidden behind "more") | 50 min |
| Couples | €135 | 3 = €345 (€115, save €60) · 5 = €575 (€115, save €100, "Biggest saving") | 60 min |
| Youth | €125 | 3 = €325 (€108.33, save €50, "Most popular") · 5 = €550 (€110, save €75, "Biggest saving") | 60 min |
| Psychologist consultation | €89 | none | 30 min |

**Plan descriptions and feature lists:**

| Plan | Tag line | Features |
|---|---|---|
| Individual single | `No commitment` | `1 x 50-minute session`, `Insurance receipt provided`, `Upgrade to a bundle anytime` |
| Individual 3 | `A gentle start` | `3 x 50-minute sessions`, `Book each session when it suits you`, `Insurance receipt for every session`, `Fettle Circle access included` |
| Individual 6 | `Keep momentum going` | same four as the 3-session bundle, with 6 sessions |
| Individual 9 | `Lowest price per session` | `9 x 50-minute sessions`, `Lowest price per session`, `Insurance receipt for every session`, `Fettle Circle access included` |
| Couples single | `Both partners attend` | `1 x 60-minute couples session`, `Insurance receipt provided`, `Upgrade to a bundle anytime` |
| Couples 3 | `Build your foundation` | `3 x 60-minute couples sessions` + the same three bundle features |
| Couples 5 | `Biggest total saving` | `5 x 60-minute couples sessions` + the same three bundle features |
| Youth single | `No commitment` | `1 x 60-minute youth session`, `Insurance receipt provided`, `Upgrade to a bundle anytime` |
| Youth 3 | `Time to settle in` | `3 x 60-minute youth sessions` + the same three bundle features |
| Youth 5 | `Biggest total saving` | `5 x 60-minute youth sessions` + the same three bundle features |

> **Hub notes (verified):**
> - Bundle ids/prices in `SESSION_BUNDLES` and in `create-package-payment-intent`'s `PACKAGES` both match the table: individual 1122832/996385/1197875, youth 1370588/1975510, couples 2000708/1967869.
> - Single prices are **not** in `SESSION_BUNDLES`; they are each Acuity type's `price` (all checked: individual €95, couples €135, youth €125, psychologist €89). Charge the type's live price.
> - Tag lines, features and flags don't exist in the hub; add them in one new plan-metadata module keyed by bundle id (§16), referencing `SESSION_BUNDLES` for numbers.
> - "Fettle Circle" appears nowhere in the hub today; it is copy only.

### 4.2 Which services a therapist offers
Fields come from the therapist table (`therapists_duplicate`), or the hub's equivalent:
- **Individual:** `appointmentidindividual` is set.
- **Couples:** `appointmentidcouples` is set **and** the therapist has the tag `couples`.
- **Youth:** `appointmentidyouth` is set **and** tag `youth` or `teen`, **and** the therapist is not in the youth-excluded list.
- **Psychologist:** `isPsychologist` is true / 1 / "yes". Each consultation type is offered if its appointment-type field is set:
  - depression: `depressionAssessment`
  - anxiety: `anxietyAssessment`
  - OCD: `ocdAssessment`
  - Field names vary in case and underscores; check all variants.
- **Bookable:** `status === 'active'` and the therapist is not in the hidden or not-accepting lists.
- Tags are read from `tag1`–`tag5`, `tags[]` and the comma-separated `tags2`. They are lower-cased; `self esteem` becomes `self-esteem`.

> **Hub notes (verified):** "set" means not `null`, not `""` and not the string `"NULL"`. `isPsychologist` is the string `"true"` in the live data (accept `true`, `1`, `"true"`, `"yes"`, `"1"`). The appointment type must also exist in the public Acuity types (`useAcuityAppointmentTypes`); otherwise treat the service as not offered (e.g. Fergal Clancy's youth type is not public). Tags: also strip trailing commas/spaces (live value `self esteem,`).

### 4.3 Name lists
Name matching ignores accents, apostrophes and case. A list entry also matches a longer name that starts with it.

| List | Names | Effect |
|---|---|---|
| Not accepting new clients | Ana Moore | not bookable; intro shows "not available" and offers matching |
| Hidden | Janet Homan | not bookable |
| Excluded from matching | Emma Keane, Brendan Slattery, Doreen Maher | never suggested in matches, but bookable directly |
| Excluded from youth | Fergal Clancy | no youth option |
| Pinned first in matches | Lisa Kelly, Nicole Dunne, Olivia Fahy | ranked higher, in that order |

These lists exist in 5 places on the website. If the hub has its own, keep them in one shared module.

> **Hub note:** the hub has no such lists today; create one module (§16). All nine names exist in the live table.

### 4.4 Recommended plan and reason text
| Who | Recommended | Reason text (shown under the plans) |
|---|---|---|
| Individual, first time or history unknown | 3-session bundle | `Recommended for you: three sessions give you time to settle in with {First} and start making progress, at €90.50 per session.` |
| Individual, had therapy before or switching | 6-session bundle | `Recommended for you: as you’ve had therapy before, six sessions keep momentum going at €88 per session.` |
| Couples | 3-session bundle | `Recommended for you: three sessions give you both time to settle in with {First} and build a foundation, at €115 per session.` |
| Youth | 3-session bundle | `Recommended for you: young people often need a session or two to feel at ease. Three sessions give them that time, at €108.33 per session.` |

### 4.5 Booking notes sent with the appointment
Build one string, in this order, skipping empty parts:

`Booked via quiz booking page (v2, time first). For: individual therapy. Focus: anxiety and worry, stress and burnout. Therapy before: This is my first time. Young person: Jamie. Client note: …`

In the hub, change the first sentence to `Booked via My Fettle (quiz flow).`

> **Hub notes:** cap the whole string at 500 characters (C17), trimming the client note first. For couples, also add `Partner: {name}.` (C7, Lisa Kelly's type has no partner field).

### 4.6 Acuity intake fields
| Field ID | Value | When |
|---|---|---|
| 10466116 | over-18 consent, `yes`/`no` | not youth |
| 9292394 | contact consent, `yes`/`no` | not youth |
| 9292405 | terms consent, `yes`/`no` | always |
| 10104284 | partner name | couples |

Check whether the hub's booking functions already send these. They must be sent.

> **Hub notes (verified, see 0.4):**
> - The hub's `BookingModal` sends them today (individual/couples: 10466116, 9292394, 9292405 [+10104284]; youth: 13686405, 9292394, 9292405; psychiatry: 18105514, 9291898). `create-payment-intent` carries them as a JSON string in metadata (`intakeFormFields`); `book-with-package` takes them as an array.
> - Additions the wizard needs: **13686405** for youth (required on youth types) and **9291898** for psychologists (required on the screening types). Values are always `yes` because all consents are required to continue.
> - Booking the therapist's own individual type (0.3) means these fields are actually stored; on today's topic types they were silently dropped.

## 5. Availability and time rules

- **Timezone:** everything is shown and grouped in **Europe/Dublin**.
  - Times are formatted `5:00pm` (en-IE, lower-case am/pm).
  - Dates are `Wednesday, 28 October` in long form and `Wed 28 Oct` in short form.
- **Which appointment type** to load: the therapist's individual, couples or youth appointment-type id, or the chosen consultation's id for psychologists. It does **not** depend on the plan: single and bundle book the same type.
- **Loading:** fetch the first window of months. If there is no time at all, walk forward one month at a time, up to 12 months. Fetch other months on demand when the client moves the calendar.
- **Cleaning:**
  - Drop times less than **30 minutes** from now.
  - Drop days before today.
  - **Psychologists:** the earliest day is **today + 3 days**, and **no weekends**.
- **Default day:** the earliest day matching the time-of-day filter, else the earliest day overall. If a slot was already chosen and still exists, show that day.
- **The slot is not held.** Just before charging:
  - re-check that the exact time is still free (`Checking your time is still free…`);
  - if it's gone, show `That time was just taken` and send the client back to Date & time with fresh availability.

> **Hub notes:**
> - No `date-fns-tz` in the hub; use `Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', … })` (as `src/hooks/useUnpaidSessions.ts` does). Today/weekday/"today + 3" must be computed in Dublin time, not the browser's.
> - Always pass the therapist's `calendarid` to availability calls for that therapist's type (types for psychologists are shared by several calendars).
> - Slot re-check: call `fetchTimes(typeId, date, calendarId)` and compare epochs (same technique as `findFreeCalendar` in `usePooledAvailability.ts`). No backend endpoint is needed. `confirm-payment-and-book` and `book-with-package` also reject taken slots ("not available" / "already booked"), and the paid path refunds.

## 6. Matching (no therapist chosen)

### Topics question
- Heading by service:
  - adult: `What’s bringing you to therapy?`
  - couples: `What would you like to work on together?`
  - youth: `What’s been hardest for them lately?`
- Sub: `Choose as many as you like. We’ll use this to match you.`
- Multi-select chips; at least one is required.

| Service | Topic chips (each maps to therapist tags) |
|---|---|
| Individual | Anxiety and worry (anxiety, ocd) · Low mood (depression) · Stress and burnout (stress) · Relationships · Trauma (trauma, ptsd, abuse) · Grief and loss (loss, grief) · Self-esteem (self-esteem, identity) · Anger (anger, anger management) · Addiction · ADHD · Not sure yet |
| Couples | Communication · Frequent arguments · Trust or infidelity · Intimacy and connection (sexuality) · A big life change (stress) · Deciding our future · Not sure yet. All match `couples` plus `relationships` unless noted. |
| Youth | Anxiety and worry · Low mood · School stress (stress) · Friendships or bullying (relationships, self-esteem) · Self-esteem · Anger or behaviour (anger) · Not sure yet |

- If only `Not sure yet` is picked, show: `That’s completely fine. Many people start without knowing exactly what to say, and working it out together is part of the process.`

### Ranking
- **Who is included:** bookable, not a psychologist, not in the matching-excluded list, and offers the chosen service.
- **Score:**
  - +2 for each matching topic tag (ignoring the plain `couples` tag);
  - pinned names get +1.5 / +1.3 / +1.1;
  - therapists whose earliest time is sooner get up to +1.5. The bonus shrinks over the weeks until their first time.
  - −5 for therapists with no times.
- Highest score first.

### Matches screen
- Eyebrow `✦ Your matches`.
- Heading `We found great matches for you`. It reads `We found your matches for you` when there are 2 or fewer, and `No therapists available` when there are none.
- Sub: `Based on your answers. Pick the therapist you’d like to see. You’ll choose a time next.`
- Show 3 cards; `Show more therapists` adds 3 more. Each card has:
  - photo and name;
  - a `Top match` badge on the best one when it matched at least one topic;
  - matched topics as `✓ Anxiety and worry` chips, or up to 4 of the therapist's tags if nothing matched;
  - `Next available: Wed 28 Oct, 5:00pm`, `Checking availability…` or `Limited availability`.
- Button `Continue with {First}` (`Continue with this therapist` before one is picked).

> **Hub notes:**
> - The "earliest time" bonus needs each candidate's earliest slot: use `useNextAvailable`'s core search per therapist type + calendar (cached; bounded concurrency). 48 individual therapists → fetch progressively (score without the bonus first, then re-rank as times arrive, without reordering cards the client is looking at) — decide during build.
> - The exact decay curve of the "up to +1.5" bonus isn't given in the website copy; copy the formula from the website code when building (Q23).

## 7. Payment, discounts and booking

### 7.1 What happens, in order
1. The client continues from review with all three consents ticked. Fire `booking_payment_initiated`.
2. On entering Pay, **create one PaymentIntent** with:
   - amount in cents, `eur`;
   - appointment type id and name;
   - slot datetime, calendar id and therapist name;
   - first name, last name, email, phone;
   - the notes from §4.5;
   - `couponCode` if one was entered.
3. Mount the Stripe Payment Element with the intent's client secret.
4. If the backend says the client is eligible for the **welcome offer** (TENOFF), show the welcome modal (§7.2).
5. On Pay:
   1. re-check the slot (§5);
   2. `elements.submit()`;
   3. `stripe.confirmPayment({ redirect: 'if_required', return_url: current page })`.
   - Status `succeeded` or `requires_capture` → book.
   - Status `requires_action` → wait for verification.
6. **Book the appointment** in Acuity with the payment intent id, the intake fields (§4.6) and the plan.
   - If the intent was **authorised only** (`requires_capture`), **capture it after the booking succeeds**.
   - If booking fails, **cancel the intent** instead.
7. Go to Done. Clear the saved flow state.

> **Hub notes (single session, verified):**
> - Step 2 = `supabase.functions.invoke('create-payment-intent', { body: { appointmentTypeID, appointmentTypeName, appointmentTypePrice, datetime, calendarID, calendarName, firstName, lastName, email, phone, notes, intakeFormFields: JSON.stringify([...]), timezone, couponCode, useReferralCredit? } })`. The amount is computed by the backend from `appointmentTypePrice` (send the Acuity type's `price`).
> - Step 6 = `supabase.functions.invoke('confirm-payment-and-book', { body: { paymentIntentId } })`. It reads all booking data from the intent's metadata, books Acuity, captures/cancels/refunds as needed, sends the confirmation email, redeems referral credit, and is idempotent (`alreadyBooked`). Response: `{ success, appointment: { id, datetime, … }, receiptUrl }`, or a pending message when the payment is still finalising, or `{ error }`.
> - Steps 6's capture/cancel are therefore **backend** behaviour (C4); the frontend only reads the result.
> - `fullyCovered: true` from step 2 → `book-with-credit` with the same booking fields (no card).
> - `packageCertificate` from step 2 → `redeem-package-code`, then `book-with-package`.

### 7.2 Discounts
- **One PaymentIntent per checkout.** Re-pricing after a code or the welcome offer must update the **same** intent, by passing its id back in.
  - If the backend returns `updatedExistingIntent: true` with the same id, call `elements.fetchUpdates()`.
  - If it returns a new intent, remount the card form and cancel the old intent.
- **Stale intents:** if the client goes back and changes the plan, slot or who, cancel the unpaid intent.
- **Welcome offer modal:**
  - title: the backend label, e.g. `€10 off your first session`;
  - text: `As a first-time client, use code TENOFF to save on this booking.`;
  - buttons `Apply discount` / `No thanks`.
  - Show it once per checkout. Never decide eligibility in the frontend.

> **Hub notes:** not supported by the hub backend today (C5, C6). Plan: build the frontend so it works in both modes. With today's backend, a new code → new intent → remount the Payment Element; the old intent is simply never confirmed (it can't be charged). When the backend adds `paymentIntentId` in / `updatedExistingIntent` out and a cancel action, switch to `elements.fetchUpdates()`. The welcome modal stays hidden until the backend returns an eligibility label (Q12, Q13).

### 7.3 Messages
| Situation | Message |
|---|---|
| Code accepted | `Code applied: you pay €85.00 (was €95.00).` |
| Code rejected: expired | `That code has expired, so the full price applies.` |
| Code rejected: new clients only | `This code is for new clients only, so the full price applies.` |
| Code rejected: not for this session | `This code can’t be used for this session, so the full price applies.` |
| Code rejected: other | `That code couldn’t be applied, so the full price applies.` |
| Card form not ready | `Payment not ready`: `The payment form is still loading. Please wait a moment and try again.` |
| Slot check failed (network) | `Couldn’t check availability`: `Please check your connection and try again. You have not been charged.` |
| Slot taken before paying | `That time was just taken`: `Sorry, someone booked this time moments ago. You have not been charged. Please choose another time.` Button `Choose another time`. |
| Slot taken after charging | same title, `…Your payment will be refunded in full. Please choose another time.` |
| Card declined or Stripe error | `Payment not completed`: the Stripe message, or `Your payment didn’t go through. Please try again.` |
| Still processing | `Your payment is still processing. Please wait a moment.` |
| Charged, but booking failed | `Payment received, booking not confirmed`: `Your payment went through but we couldn’t confirm the time with your therapist. Our team will contact you to arrange your session or a full refund. Please don’t book again.` |
| Booking failed, not charged | `Booking not completed`: the reason, then `You have not been charged.` |
| Charged, network failure while booking | Go to Done anyway: the booking may well exist. Log it for the team. |

All messages appear in a centred modal with an icon, never `alert()`.

> **Hub notes — mapping `couponRejected` codes from `create-payment-intent`:**
> | Code(s) | Message |
> |---|---|
> | `promo_expired`, `acuity_expired` | expired |
> | `promo_restricted` (also returned for Stripe codes limited to first-time transactions) | new clients only — **but** the same code is used for other customer restrictions, so confirm the wording (Q12) |
> | `acuity_not_applicable`, `promo_minimum`, `below_minimum`, `promo_currency` | not for this session |
> | `unknown_code`, `promo_inactive`, `promo_no_discount`, `coupon_no_discount`, `coupon_invalid`, `coupon_not_found`, `not_earned`, `not_signed_in`, `validation_error`, `server_unavailable`, `acuity_unsupported`, `acuity_package_code` | other |
>
> The hub currently uses shadcn toasts for errors; the wizard uses a centred `Dialog` as the brief says.

### 7.4 Redirect payment methods
Some methods (e.g. Revolut Pay) leave the page and come back with `payment_intent_client_secret` in the URL:
- Before confirming, save the flow state.
- On return, restore it, check the intent status, then book as in 7.1. Show `Finalising your booking…`.
- If the payment didn't complete: `Payment not completed`: `Your payment wasn’t completed. Please try again.`

> **Hub notes (C16):** add a wizard marker to `return_url` (e.g. `/book?…&wizard_return=1`) and make `usePaymentRedirectReturn` skip URLs with that marker, exactly as it skips `SETTLEMENT_RETURN_PARAM`. The wizard then restores its state, reads the intent with `stripe.retrievePaymentIntent(clientSecret)` and calls `confirm-payment-and-book` (single) or `confirm-package-payment` + `book-with-package` (bundle). Note `redirect_status` in the URL as today's handler does.

## 8. Errors and edge cases
- **Therapist can't be found from the link, or is not accepting, hidden, inactive or offering nothing:** blocked intro (§3.0) with `Find me a therapist`, which leads to matching.
- **Therapist lookup** accepts the table id, the profile slug (last part of their profile URL) or the name.
- **No times in 12 months:** see §3.2.
- **Page refreshed mid-flow:** restore the answers if the session is under 45 minutes old.
  - Restore to Date & time, never to review or pay: the slot must be picked again from fresh availability.
  - Restoring a step that no longer exists in the flow starts at the intro.
- **Browser Back** moves one step back (each step is a history entry). Back on Done does nothing.
- **Changing "who"** clears topics, plan, slot and payment. **Changing therapist** clears slot and payment.
- **Youth:**
  - the parent/guardian consent replaces the over-18 one;
  - the contact and over-18 intake fields aren't sent;
  - copy refers to "them" and "your child".

> **Hub notes:** the hub's link param `therapist` may also be a **calendar id** (§10.3), so lookup order is: table `id` → `calendarid` → slug from `url` → name. For youth send 13686405 (0.4). Unknown/blocked therapist → matching, which needs the client to be logged in (it is, via `ProtectedRoute`).

## 9. Analytics (GTM `dataLayer`)

Every event carries `booking_flow` and `therapist` (name or null). The website uses `booking_flow: 'quiz_v2_time_first'`; **use `'hub_quiz'` in the hub** so the two can be compared.

| Event | When | Extra data |
|---|---|---|
| `booking_page_view` | flow opened | `step_name`, `entry_therapist` |
| `booking_step_view` | every step shown | `step_name`, `step` (number) |
| `booking_plan_selected` | plan row tapped | `package_id` (`from: 'bundle_screen'` when switching to single) |
| `booking_plan_confirmed` | Continue on plan | `package_id` |
| `booking_details_submitted` | details valid | `who` |
| `booking_payment_initiated` | review → pay | `package_id`, `package_title`, `package_price`, `amount`, `currency`, `selected_date`, `selected_time` |
| `booking_payment_submitted` | Pay pressed and slot still free | — |
| `booking_payment_failed` | any failure | `reason` (`slot_check_failed`, `slot_unavailable`, `stripe_form_invalid`, `stripe_confirm_error`, `unexpected_payment_status`, `acuity_booking_failed`), `detail` |
| `stripe-success-conversion` | booked | `conversion`, `booking_id`, `appointment_type_id`, `Email`, `ID`, `Type`, `AppointmentType`, `Calendar`, `Price` |
| `consultation_reserved` | booked | `client_name`, `client_email`, `payment_status`, `booking_id`, `plan`, `plan_price`, `slot_day`, `slot_time` |
| `booking_completed` | booked | `booking_id`, `package_id`, `package_title`, `package_price`, `amount`, `currency`, `selected_date`, `selected_time`, `appointment_type_id`, `calendar_id`, `who` |
| `booking_referral_source` | "how did you hear" chip | `referral_source` |
| `booking_bundle_handoff` | website only | — |

The website also calls `comet('custom_event_8', {email, phone, first_name, last_name})` when details are submitted. Check whether the hub uses Comet.

Analytics must never block or break booking: wrap every call in try/catch.

> **Hub notes (verified):** the hub has no GTM/`dataLayer`/Comet (C10). Build a tiny `track(event, data)` helper that pushes to `window.dataLayer` when it exists and never throws; it is a no-op until GTM is added to `index.html` (Q11). Comet: not used in the hub — skip unless Q11 says otherwise.

## 10. Mapping onto the hub

### 10.1 What the hub already has (verify each before writing new code)
| Need | Existing hub code |
|---|---|
| Therapists, calendars, appointment types | `src/hooks/useAcuity.ts`: `useAcuityCalendars`, `useAcuityAppointmentTypes` |
| Availability | `useAcuityAvailability`, `useAcuityTimes`; pooled "any therapist" in `src/hooks/usePooledAvailability.ts`; `src/hooks/useNextAvailable.ts` + `NEXT_AVAILABLE_APPOINTMENT.md` |
| Single session: pay + book | edge functions `create-payment-intent`, `confirm-payment-and-book`, `verify-payment-and-book`; `src/components/booking/PaymentForm.tsx`; `PaymentRedirectHandler.tsx` + `usePaymentRedirectReturn.ts` for redirects |
| Bundle purchase | `create-package-payment-intent` / `create-package-payment`, `confirm-package-payment`, `verify-package-payment`; `PackagePaymentForm.tsx`, `PackageBookingModal.tsx` |
| Booking with existing credits | `book-with-package`, `book-with-credit`; `useUserPackages`, `PackageCreditsCard`, `PackageSessionsCounter` |
| Prices and package categories | `src/lib/sessionBundles.ts`, `src/lib/packageCategory.ts` |
| Psychologists / assessments | `src/lib/assessments.ts`, `ASSESSMENTS_BOOKING.md`; psychiatry in `src/lib/psychiatry.ts`, `PSYCHIATRY_BOOKING.md` |
| Confirmation emails | `send-booking-confirmation`, `send-credit-used-confirmation` |
| Entry points | `BookSessionDropdown.tsx`, `MyTherapist.tsx`, `BookAgainPrompt.tsx`, `Packages.tsx` |
| Current booking UI | `BookingModal.tsx`, about 3,300 lines. Steps: type → pricing → therapist → date → time → details → confirm → payment → success |

**Build a new wizard and reuse the hooks and edge functions. Don't fork `BookingModal.tsx`.**

> **Hub notes (verified table):**
> | Need | Verified location / behaviour |
> |---|---|
> | Therapist rows | `fettleschema.therapists_duplicate` (full columns in 0.3); today only `src/hooks/useTherapistImages.ts` reads it (5 columns). |
> | Availability fetchers | `fetchDates`, `fetchTimes`, `resolveSlotCalendar` exported from `src/hooks/useNextAvailable.ts`; edge function `acuity` actions `get-appointment-types`, `get-availability` (`appointmentTypeId`, `month`, `calendarId`), `get-times` (`appointmentTypeId`, `date`, `calendarId`), `get-calendars`, `get-appointments` (signed-in, own email only). |
> | Single pay + book | `create-payment-intent` (auto-capture; codes; referral credit; bundle-code detection), `confirm-payment-and-book` (books, capture/cancel/refund, email, idempotent). `verify-payment-and-book` = old Checkout `session_id` flow. `PaymentForm.tsx` saves `fettleRedirectPayment` before confirming. |
> | Bundle purchase | `create-package-payment-intent` `{ packageId, firstName, lastName, email, phone }`; `confirm-package-payment` `{ paymentIntentId }` → `{ success, package: { id, name, sessions, remaining, … } }`; it **cannot** book a slot. |
> | Booking with package credits | `book-with-package` `{ packageId (user_packages row id), appointmentTypeID, datetime, calendarID, firstName, lastName, email, phone, notes, intakeFormFields (array), timezone }`; uses the Acuity certificate when linked. |
> | Referral credit | `book-with-credit` = fully covered by referral credit (C2). |
> | Package credits list | `useActivePackages()` in `src/hooks/useUserPackages.ts`; category per bundle via `getPackageCategory(package_id)` (unknown product id → usable for any therapy session, never for assessments). |
> | Credits UI | `src/components/sessions/PackageCreditsCard.tsx`, `src/components/dashboard/PackageSessionsCounter.tsx`. |
> | Entry points | `BookSessionDropdown.tsx`, `MyTherapist.tsx` (2×), `BookAgainPrompt.tsx`, `src/pages/Sessions.tsx`, `src/pages/GetStarted.tsx`, `src/pages/Psychiatry.tsx`; `/packages` (bundle funnel + packages modal). |
> | Formatting | `formatEuro` in `sessionBundles.ts`; `formatNextAvailable` in `useNextAvailable.ts` (browser-local format, not Dublin — don't reuse for the wizard's Irish-time labels). |

### 10.2 Differences because clients are logged in
- **Details:** prefill from the profile.
  - When name, email and phone are all present, show one compact row (`Booking for Sarah Byrne · sarah@… · 087… · Edit`) instead of the form.
  - Partner name (couples), young person's name (youth) and the optional note stay as inputs.
  - Details already in the profile don't need the step at all; see Q3.
- **History question:** most hub users are existing clients, so this question is odd for them (Q2). Options:
  - skip it for clients with past sessions;
  - or ask `Is this your first session with {First}?`
  - The answer still feeds the recommended plan (§4.4).
- **Package credits:**
  - If the client has unused sessions for this service, Payment shows `Use 1 of your 3 remaining sessions` preselected, with €0 due and no card form.
  - Book with `book-with-package` / `book-with-credit`. They can still choose to pay instead.
- **Plans:** clients who already bought bundles before may not need the recommendation text. Keep the plan rows.
- **Unpaid sessions:** if the hub's unpaid-sessions banner applies, decide whether to block new bookings until they are settled (Q7).

> **Hub notes:**
> - Phone is not in `profiles` (C8): the compact row needs a phone from the latest Acuity appointment; if none, show the phone input.
> - "Unused sessions for this service" = `useActivePackages()` filtered by `getPackageCategory(package_id) === who` (unknown category counts, as in `BookingModal`'s `categoryPackages`). Psychologist consultations never use package credits. Book with **`book-with-package`** (C2).
> - Referral credit (`useReferrals()` balance) and the "Use referral credit" toggle exist in `BookingModal`; keep it at Payment for single sessions (Q18).
> - Today there is no rule that blocks booking while sessions are unpaid (only the banner and the Sessions page), so Q7's default "follow the hub's current rule" = don't block.

### 10.3 Route and entry points
- Add a page route **`/book`** inside `ProtectedRoute` + `CustomerOnly`.
- Query params:
  - `therapist` (calendar id or therapist id)
  - `service` (`individual` / `couples` / `youth`)
  - `type` (assessment key)
  - `slot` (ISO datetime, to deep-link a time, e.g. from "next available")
- Point `BookSessionDropdown`, `MyTherapist`, `BookAgainPrompt` and "next available" at `/book` with the right params.
- Keep `BookingModal` for anything not migrated yet.

> **Hub notes:**
> - Add the route next to the others in `src/App.tsx`: `<Route path="/book" element={<ProtectedRoute><CustomerOnly><Book /></CustomerOnly></ProtectedRoute>} />`.
> - `BundleFunnelResume` (mounted in `App.tsx`) redirects signed-in clients with a pending bundle intent to `/get-started` except on a skip list; add `/book` to its skip list so the wizard is never interrupted.
> - `type` values: `depression`, `anxiety`, `ocd` (map to the screening type ids).
> - `MyTherapist`/`BookAgainPrompt` know the therapist by **calendar id** → `/book?therapist={calendarId}`.

### 10.4 Bundles in the hub (replaces the website hand-off)
When the client chooses a bundle at Payment:
1. **Buy the package** with the existing package payment functions.
2. **Book the chosen slot using 1 credit** from it (`book-with-package`).
3. The Done screen shows `You’re booked` plus `2 sessions left in your bundle`.

**Two things to settle with the backend owner:**
- Can `confirm-package-payment` book the slot in the same call, or does it need two calls?
- If the package is paid but the slot is taken: keep the credits, send the client back to Date & time with `That time was just taken. Your bundle is saved — choose another time.`, then book with a credit.

> **Hub notes (verified):**
> - **Answer to the first question: two calls today.** `confirm-package-payment` only takes `{ paymentIntentId }` and returns the new `package.id`; then call `book-with-package` with that `packageId`. A one-call version would be a backend change (Q4).
> - Flow: `create-package-payment-intent { packageId: bundle.id, … }` → Payment Element → `confirmPayment` → `confirm-package-payment { paymentIntentId }` → `book-with-package { packageId: package.id, … slot … }` → Done (`{sessions − 1} sessions left in your bundle`).
> - If `book-with-package` fails because the slot is taken, the package already exists with all credits: show the brief's message, go to Date & time, and book the new slot with `book-with-package` (no second payment). This works with today's backend.
> - Redirect wallets for bundles: same marker + guard as §7.4 (today's global handler would otherwise send the client to `/packages`).

### 10.5 Website → hub hand-off (optional, later)
Bundle buyers on the website currently land on `/packages` without their chosen time. A small improvement:
- the website could link to `/packages?therapist=…&slot=…`;
- `/packages` could show "You chose Wed 28 Oct at 5:00pm with Lisa" and book it after purchase.

This needs a change on both sides; agree it first (Q6).

> **Hub note:** `/packages` already understands `?bundle={3|6|9}&therapy={topic}` (bundle funnel → `/get-started`, `src/lib/bundleFunnel.ts`). A later `therapist`/`slot` hand-off can extend the same intent (localStorage, 7-day TTL) and open `/book` at review with the bundle preselected.

## 11. Design and layout

Match the website's look. Map it onto the hub's Tailwind theme where tokens exist.

### Colours
| Token | Value |
|---|---|
| orange | `#ff7300` (hover `#e86600`; tints `#ffe4cc`, `#fff5ec`) |
| yellow | `#ffce00` |
| green | `#01a652` (tint `#e8f7ee`) |
| blue | `#0061ef` |
| page background | `#fdf5eb` |
| card | white |
| ink | `#2d2c2b` (secondary `#4a4846`) |
| muted text | `#6b6a68` |
| faint text | `#a9a39b` |
| lines | `#ebe2d6`, `#f4eee6` |
| red | `#d92d20` (tint `#fef3f2`) |
| card shadow | `0 1px 2px rgba(45,44,43,.05), 0 16px 48px -16px rgba(45,44,43,.16)` |

### Type and buttons
- **Font:** Nunito (400–900).
  - Headings: 900 weight, `clamp(26px, 3.1vw, 34px)`, 26px on phones.
  - Sub-text: 17px muted (16px on phones).
  - Eyebrows: 12.5px, 900 weight, uppercase, letter-spacing .09em, orange.
- **Buttons:** pill-shaped (radius 999px), 16px × 30px padding, 800 weight. Primary is orange. Disabled is faded but still visible.
- **Focus ring:** 3px `rgba(255,115,0,.45)`.

### Layout
- Two columns on desktop: the step card plus a 340px summary column, with a 32px gap and max width 1160px.
- At ≤1000px the summary moves under the step card.
- **Spacing scale (desktop):**
  - step card padding 48px × 56px, radius 28px;
  - eyebrow → heading 14px; heading → sub 12px;
  - sub → body 32px; body → actions 40px; hint under buttons 20px.
- **Option rows:** padding 18px × 22px, radius 18px, 1.5px border. The selected row gets an orange border, a light orange background and a filled orange tick.
- **Plan rows:** padding 22px × 24px, radius 20px. The badge sits on the top border, 62px from the left.
- **Time pills:** 12px × 8px padding, pill shape, tabular numbers. Grouped in a grid.

### Phones (≤760px)
- Page padding 16px × 14px.
- Step card padding 32px × 20px.
- The phase labels are hidden: show only the progress bar and the therapist's mini avatar.
- **Sticky action bar** at the bottom of the card, with a white fade above it. The primary button is full width.
- Single-column form.
- The intro photo is centred at 112px.
- Plan prices wrap under the plan name.
- The segmented control is full width with equal buttons.
- Grids use `minmax(0,1fr)` so nothing overflows. **No horizontal scroll at 360px.**

### Motion
- Steps slide in from the right going forward, and from the left going back.
- Respect `prefers-reduced-motion`.

> **Hub notes (C11):**
> - Hub tokens: `--primary: 24 80% 55%`, `--background: 35 40% 97%`, `--success: 145 60% 45%`, `--radius: 1rem`; fonts DM Sans (body) + Sora (`--font-heading`), loaded from Google Fonts in `src/index.css`; dark mode tokens under `.dark`.
> - Recommended (pending Q10): scope the website tokens and Nunito to the wizard only (CSS variables on a `.booking-wizard` root), and give each a dark-mode value, so the rest of the hub is unchanged.
> - The wizard page sits inside `DashboardLayout` (sidebar + announcement bar) like other customer pages; the two-column layout and 1160px max width apply inside its content area.
> - No animation library in the hub: use CSS transitions/keyframes (`tailwindcss-animate` is available via shadcn).

## 12. State, navigation and accessibility
- **State:**
  - therapist, who, consultation type, topics, history, time-of-day filter, details, slot, plan, coupon, consents, payment intent;
  - save it to sessionStorage on every change, and restore it as in §8.
- **Navigation:**
  - each step pushes a history entry, and browser Back goes to the previous step;
  - the in-page ‹ button does the same; it is hidden on the intro and Done.
- **Keyboard:**
  - Enter = Continue when Continue is enabled. This includes Enter inside the details inputs, which submits the details step.
  - Enter does nothing special in the note text area or on focused buttons and links.
  - Enter in the discount-code input applies the code.
- **Accessibility:**
  - Option buttons use `aria-pressed` (plan rows also `role="radio"` / `aria-checked`).
  - Move focus to each new step's heading. Not on the details step, which focuses the first field on desktop.
  - The step container is `aria-live="polite"`.
  - Calendar days have labels like `Wednesday, 28 October, 3 times`.
  - Buttons are at least 44px tall.
  - Error text sits under each field.

> **Hub notes:**
> - Use one sessionStorage key for the wizard (e.g. `fettle:book-wizard`) with a `savedAt` timestamp for the 45-minute rule; wrap every read/write in try/catch (pattern in `src/lib/bundleFunnel.ts`). Never store card data; the intent's client secret is stored only for the redirect return.
> - History entries: keep the step in the URL (`/book?…&step=slot`) with `navigate(…, { replace: false })`, so React Router's Back works and a refresh lands on a restorable step.

## 13. Decisions to confirm before coding
| # | Question | Suggested default |
|---|---|---|
| Q1 | Replace `BookingModal` everywhere now, or start with one entry point? | Start with "Book again / My therapist" and individual therapy, then roll out. |
| Q2 | History question for returning hub clients? | Skip it for clients with past sessions; ask it for clients with none. |
| Q3 | Details step when the profile is complete? | Show the compact "Booking for …" row with Edit, not the full form. |
| Q4 | Bundles: buy + book the chosen slot in one go (§10.4)? Who owns the edge functions? | Yes, one go. Needs the backend owner's confirmation. |
| Q5 | Include assessments (psychologists) and psychiatry in the new wizard now? | Psychologist consultations yes (same as the website); psychiatry stays on its current flow. |
| Q6 | Pass the website's chosen time into `/packages` (§10.5)? | Later, separate change. |
| Q7 | Block new bookings while the client has unpaid sessions? | Follow the hub's current rule; don't change it here. |
| Q8 | Done screen: stay on Done, or go to `/booking-success`? | Reuse `/booking-success` if it already does confirmations; otherwise the Done screen above. |
| Q9 | Analytics flow name | `hub_quiz` |

> **Hub notes on these defaults (verified):** Q4 — "one go" works for the client with **two backend calls** today (§10.4); the edge functions were written by Ernest (backend owner). Q7 — the current rule is "don't block". Q8 — `/booking-success` is for the old Checkout flow (C9), so use the Done screen.

## 14. Acceptance checklist
- [ ] The order matches Alex's list: who → date & time → history → details → payment.
- [ ] No step auto-advances; every question has a Continue button that is disabled until answered.
- [ ] No "first session" wording before the history question.
- [ ] Individual, couples, youth and psychologist all work, plus matching with no therapist.
- [ ] A therapist with one service skips "who"; `service` in the link skips it when offered.
- [ ] Not-accepting / hidden therapist → blocked intro → matching.
- [ ] No times in 12 months → "Find another therapist".
- [ ] Time-of-day filter, earliest card, month navigation (this month + 11), Irish time labels.
- [ ] Psychologist: no weekends, first day = today + 3.
- [ ] Recommended plan follows §4.4; the 9-session plan is behind "more"; only the selected plan shows features.
- [ ] Edit from review returns to review.
- [ ] All three consents required; youth shows the parent/guardian consent.
- [ ] Discount code: valid, expired, new-clients-only, not-applicable messages; the welcome offer appears only when the backend says so; one PaymentIntent repriced, never two charges.
- [ ] Slot re-checked before charging; taken slot → back to Date & time, with the right charged/not-charged message.
- [ ] `requires_capture` intents are captured after booking and cancelled if booking fails.
- [ ] Redirect payment methods resume and book after returning.
- [ ] Client with credits books with €0 and no card. Bundle purchase also books the chosen slot.
- [ ] Intake fields 10466116 / 9292394 / 9292405 / 10104284 and the booking notes reach Acuity.
- [ ] GTM events fire with `booking_flow: 'hub_quiz'`.
- [ ] Refresh mid-flow restores answers without a held slot; browser Back works.
- [ ] Desktop 1320px, tablet 768px, phones 390px and 360px: no horizontal scroll, sticky action bar, balanced spacing.
- [ ] Stripe **test mode** end to end:
  - `4242 4242 4242 4242` succeeds;
  - `4000 0027 6000 3184` runs 3-D Secure;
  - `4000 0000 0000 9995` is declined.
- [ ] Unit tests for the pure logic: which services a therapist offers, the name lists, the recommended plan, the time-of-day grouping, the psychologist date rules and the matching score.

**Added from the hub verification:**
- [ ] Youth bookings send 13686405; psychologist bookings send 9291898 (0.4).
- [ ] Couples notes include the partner name; notes never exceed 500 characters.
- [ ] Bookings use the therapist's own Acuity type and `calendarid` (0.3), and the intake fields appear on the Acuity appointment.
- [ ] Wizard redirect returns are not intercepted by the global `PaymentRedirectHandler` (C16), and `/get-started` never hijacks `/book`.
- [ ] Bundle codes typed in the discount field are linked and booked with a credit (`packageCertificate`).
- [ ] Referral credit option behaves as in `BookingModal` (Q18), incl. `fullyCovered` → `book-with-credit`.
- [ ] After booking: sessions, packages and unpaid-session caches are refreshed.
- [ ] Wizard works in the hub's dark mode (if Q10 keeps dark mode).
- [ ] `npm run build`, `npm run lint` (no new errors) and `npm test` pass.

## 15. Out of scope
- The website pages (/our-therapists, /book-a-session, the details-first `/book-a-session-v1`). They live in WordPress, not in this repo.
- Prices, therapist data, Acuity appointment types and Stripe products.
- Admin screens, emails and reminders (unless a booking function needs a field passed through).

**Also out of scope here (noted for the backend owner):** server-side price validation in `create-payment-intent` (C15); the €85/€95 rule (already done, 0.5).

---

## 16. Build plan

Branch `feature/book-wizard`; small commits in English with no AI mentions; ask before every push to `main` (or open a PR, as the team now does for features).

### Phase 0: docs
- Save this file as `docs/QUIZ_BOOKING_FLOW.md`.

### Phase 1: pure logic + unit tests (no UI)
New folder `src/lib/booking/` (each with a `*.test.ts` using Vitest):
| Module | Contents |
|---|---|
| `therapists.ts` | Row type for `therapists_duplicate`; `isSet()` (null / "" / "NULL"); `normaliseTags()`; `servicesOffered(row, publicTypeIds)` (§4.2 incl. couples tag, youth tag/teen + youth exclusion, psychologist variants); `isBookable()`; `findTherapist(param, rows)` (id → calendarid → slug → name). |
| `nameLists.ts` | The five lists of §4.3 and `matchesName()` (accents, apostrophes, case, prefix). |
| `plans.ts` | Plan metadata (tag lines, features, flags, "more") keyed by `SESSION_BUNDLES` ids + single plans; `recommendedPlan(who, history)` and reason text (§4.4). |
| `time.ts` | Dublin formatting (`5:00pm`, `Wednesday, 28 October`, `Wed 28 Oct`), part of day, 30-minute cutoff, psychologist rules (today + 3, no weekends), default day. |
| `matching.ts` | Topic chips → tags per service; `scoreTherapist()` (§6); "Not sure yet" handling. |
| `notes.ts` / `intake.ts` | §4.5 notes string (500 cap, partner name) and intake fields per service (0.4). |
| `analytics.ts` | `track()` safe `dataLayer` push with `booking_flow: 'hub_quiz'`. |
| `coupon.ts` | `couponRejected` → §7.3 message mapping. |

### Phase 2: data hooks
- `useTherapistDirectory()` — full `therapists_duplicate` rows (react-query, cached), joined with public Acuity types.
- `useTherapistSlots(typeId, calendarId, { psychologist })` — month fetch with walk-forward to 12 months, on-demand months, cleaning rules, throwing fetchers for the error state.
- `recheckSlot(typeId, calendarId, isoTime)`.

### Phase 3: wizard UI
- `src/pages/Book.tsx` (route `/book`) + `src/components/book/` steps: Intro, Who, Consultation, Topics, Matches, Slot, History, Details, Plan, Review, Pay, Done, SummaryCard, ProgressBar, StickyActions, MessageDialog.
- State: one reducer + sessionStorage persistence (45 min) + URL `step` param for Back.
- Design tokens scoped to `.booking-wizard` (pending Q10).

### Phase 4: payment paths
1. Single session: `create-payment-intent` → Payment Element → re-check slot → `confirmPayment` → `confirm-payment-and-book`.
2. Package credit: `book-with-package` (no card).
3. Referral credit fully covering: `book-with-credit`.
4. Bundle code in the discount field: `redeem-package-code` → `book-with-package`.
5. New bundle: `create-package-payment-intent` → `confirm-package-payment` → `book-with-package`; slot-taken recovery.
6. Redirect returns for 1 and 5 with the wizard marker + guard in `usePaymentRedirectReturn`.

### Phase 5: entry points (per Q1)
- First: `MyTherapist` "Book" and `BookAgainPrompt` → `/book?therapist={calendarId}`; `/get-started` and `BundleFunnelResume` skip list updated.
- Later: `BookSessionDropdown`, `Sessions.tsx`, next-available shortcuts; `BookingModal` stays for anything not migrated (psychiatry, assessments outside psychologists, rebook flows not yet moved).

### Phase 6: verification
- Preview at 1320 / 768 / 390 / 360 px, light and dark.
- Signed-out → `/login` redirect; signed-in flows up to the Pay button with ZZTest data on the live site (no real charges).
- Stripe test-mode end to end once a test environment exists (Q22).
- `npm run build`, `npm run lint`, `npm test`.

## 17. All open decisions (original + new)
| # | Question | Suggested default |
|---|---|---|
| Q1 | Replace `BookingModal` everywhere now, or start with one entry point? | Start with "Book again / My therapist" and individual therapy, then roll out. |
| Q2 | History question for returning hub clients? | Skip it for clients with past sessions; ask it for clients with none. |
| Q3 | Details step when the profile is complete? | Compact "Booking for …" row with Edit. Phone comes from the latest Acuity appointment (Q17). |
| Q4 | Bundles: buy + book the chosen slot in one go? Who owns the edge functions? | Yes for the client, using two calls (`confirm-package-payment` then `book-with-package`); backend owner Ernest. |
| Q5 | Include psychologists and psychiatry now? | Psychologist consultations yes; psychiatry stays on its current flow. |
| Q6 | Pass the website's chosen time into `/packages`? | Later, separate change. |
| Q7 | Block new bookings while the client has unpaid sessions? | No (current hub rule). |
| Q8 | Done screen or `/booking-success`? | Done screen in the wizard (`/booking-success` is the old Checkout flow). |
| Q9 | Analytics flow name | `hub_quiz` |
| Q10 | Look: website (Nunito, `#ff7300`, website palette) or hub theme (DM Sans/Sora, hub primary)? Dark mode for the wizard? | Website look scoped to the wizard, with dark-mode values. |
| Q11 | GTM container ID for the hub, and may GTM be added to `index.html`? Comet needed? | Add GTM with Fettle's container; skip Comet. Until then `track()` is a no-op. |
| Q12 | Welcome offer (TENOFF): who adds eligibility + label to the backend? Is TENOFF a Stripe first-time promotion code (the hub currently rejects those)? Wording for `promo_restricted`? | Backend owner adds it; frontend hides the modal until the backend returns it. |
| Q13 | One PaymentIntent per checkout: will the backend accept an existing `paymentIntentId` and cancel stale intents? | Interim: new intent per code change, old one never confirmed (cannot charge). |
| Q14 | `/get-started` (bundle funnel) books its first session on **topic** types with automatic therapist assignment. Keep it, or move it onto the wizard later? | Keep as is now; revisit after the wizard is live. |
| Q15 | Youth consent: the website text (`I am the parent or legal guardian…`) vs the required Acuity field 13686405 (`…completed the mandatory consent form for Fettle Youth Therapy`). Which copy? | Show the website text and send 13686405 = yes; confirm with Fettle that this satisfies the consent-form requirement. |
| Q16 | "How did you hear about Fettle?" chips differ from Acuity field 18105514 (Social Media, Google, AI Chatbots, Influencers, Friends or Family). GTM only, or also save to Acuity? | GTM only (as the website). |
| Q17 | Phone: prefill from the latest Acuity appointment, or add a `phone` column to `profiles`? | Prefill from Acuity; no migration. |
| Q18 | Keep hub-only extras at Payment: referral credit, loyalty codes, bundle codes in the discount field? | Yes, same behaviour as `BookingModal`. |
| Q19 | Calendar range: 12 months (brief) vs 3 months (current modal)? | 12 months, as the brief. |
| Q20 | Badge flags differ from `SESSION_BUNDLES.popular` (youth 3 vs youth 5 "Most popular"). | Wizard uses the brief's flags; leave `PackageBookingModal` unchanged unless Fettle wants them aligned. |
| Q21 | Lisa Kelly's couples type has no intake form in Acuity. Ask Fettle to attach "Intake Form" + "Couple's Therapy" forms to it? | Yes; meanwhile the partner name also goes in the notes. |
| Q22 | Stripe test mode: is there a test environment (test publishable key + Supabase functions with test secrets)? The local `.env` is live. | Needed before the §14 test-card checks; until then test up to the Pay button only. |
| Q23 | Exact formula for the "earliest time" bonus (§6). | Copy it from the website code when building matching. |

### 17.1 Fettle's answers (30 Oct 2026)
These replace the suggested defaults above where they differ.

| # | Answer |
|---|---|
| Q10 | Use the hub's own theme: DM Sans and Sora, the hub's orange and radius. Keep the website brief's layout and spacing. Light mode only, like the rest of the hub (this replaces the §11 colours, font and Stripe appearance). |
| Q11 | Build `track()` with every §9 event (`booking_flow: 'hub_quiz'`). The hub has no GTM, so nothing is tracked until someone adds a GTM ID later. Booking is not affected. |
| Q12 | No TENOFF and no welcome modal. Keep the hub's discount field (loyalty codes, Stripe promotion codes, Acuity coupons, bundle codes) with the same messages as `BookingModal`. |
| Q13 | Keep the hub's behaviour: a new PaymentIntent when the price changes; the old one is never confirmed, so nobody is charged twice. The backend already blocks double bookings and refunds automatically. No backend change. |
| Q15 | Youth consent 1 uses Acuity's text: `I acknowledge and agree that I have completed the mandatory consent form for Fettle Youth Therapy.` It sends 13686405 = yes. |
| Q21 | Every couples booking adds `Partner: {name}.` to the booking notes. Lisa Kelly's type still has no forms, but the therapist always gets the partner's name in the notes. |

## 18. Verification log
How each hub fact in this brief was checked (2026-10-29, read-only; no code or data was changed):
- **Code:** a clean copy of `origin/main` at `a410b0c` (69 commits newer than the local checkout), read file by file: `src/App.tsx`, `CustomerOnly.tsx`, `BookingModal.tsx`, `PackageBookingModal.tsx`, `PaymentForm.tsx`, `PackagePaymentForm.tsx`, `usePaymentRedirectReturn.ts`, `useAcuity.ts`, `useNextAvailable.ts`, `usePooledAvailability.ts`, `useTherapistImages.ts`, `useUserPackages.ts`, `AuthContext.tsx`, `BookingSuccess.tsx`, `sessionBundles.ts`, `packageCategory.ts`, `assessments.ts`, `psychiatry.ts`, `bundleFunnel.ts`, `index.css`, `tailwind.config.ts`, `index.html`, `package.json`, `src/integrations/supabase/types.ts`; edge functions `create-payment-intent`, `confirm-payment-and-book`, `create-package-payment-intent`, `confirm-package-payment`, `book-with-package`, `book-with-credit`, `verify-*`, `acuity`; commit `37f09c4`.
- **Therapists:** `GET /rest/v1/therapists_duplicate?select=*` with `Accept-Profile: fettleschema` and the public key (113 rows).
- **Appointment types:** the hub's `acuity` edge function `get-appointment-types` (names, prices, durations, calendars, form ids).
- **Intake forms:** the public Acuity scheduling pages (`app.acuityscheduling.com/schedule.php?owner=21301568&appointmentType=…`) for a per-therapist individual type (56122573), couples types (35649630, 99207008), a youth type (50988945) and a psychologist type (92852936).
- **Not verified:** anything that needs a live payment or a signed-in client (booking responses were read from the code, not exercised).
