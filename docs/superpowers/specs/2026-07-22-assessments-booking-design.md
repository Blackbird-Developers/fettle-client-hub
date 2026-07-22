# Assessments booking in the Fettle Client Hub — design

**ClickUp task:** [Fettle Hub: Add assessment booking flow](https://app.clickup.com/t/86carvnz3)
**Date:** 2026-07-22

## Context

The hub books therapy through Acuity (Supabase edge function `acuity` proxying the
Acuity API) with Stripe payment via `create-payment-intent` →
`confirm-payment-and-book` (or `verify-payment-and-book` for redirect payment
methods). Booking categories today: `individual`, `couples`, `youth`.

### What exists in Acuity (verified against the live account)

Acuity has a first-class **“Assessments” category** of appointment types, pooled
across three assessment-clinician calendars (14263454, 14081738, 13216804):

| Type | ID | Price | Duration |
|---|---|---|---|
| OCD Assessment Screening | 92852936 | €89 | 45 min |
| Anxiety Assessment Screening | 92853020 | €89 | 45 min |
| Depression Assessment Screening | 92853161 | €89 | 45 min |
| Bipolar Assessment Screening | 93758632 | €89 | 45 min |
| Mental Health Assessment Screening | 95879451 | €89 | 45 min |
| Addiction Assessment Screening | 94856237 | €89 | 30 min |
| Full OCD / Anxiety / Depression / Mental Health Assessment | 93759134 / 94070389 / 94070403 / 95879488 | €750 | 90 min |
| Post OCD / Anxiety / Depression Assessment Follow-Up | 94365786 / 94365810 / 94365860 | €210 | 60 min |

These IDs match the Acuity links on the public fettle.ie assessment pages
(`ocd.html` → 92852936, `anxietyassesment.html` → 92853020,
`depressionassesment.html` → 92853161, `addiction2.html` → 94856237).

**ADHD and Autism assessments are NOT in Acuity.** They run on partner systems
(ADHD Now via a Semble booking API; AutismCare via its own AWS backend). The hub
links out to the public pages for these two instead of integrating foreign APIs:
`https://fettle.ie/adhd-assessment/` and `https://fettle.ie/autism-assesments/`.

## Approaches considered

1. **Extend `SessionCategory` with `'assessment'` (chosen).** Reuses the entire
   existing wizard, hooks, and payment functions. Filtering keys off Acuity’s
   `category === 'Assessments'` — the reliable identifier the task asks for,
   with no hardcoded ID lists to maintain (new assessment types appear
   automatically).
2. Separate `AssessmentBookingModal` — would duplicate a 2,000-line wizard for a
   flow that differs only in filtering, step order, and payment gating. Rejected.
3. Link out to Acuity `schedule.php` pages — fails the acceptance criteria
   (native payment flow, hub refresh, consistent UI). Rejected.

## Design

### Entry point
`BookSessionDropdown` gets an **Assessments** item (ClipboardCheck icon) between
Youth Therapy and Session Bundles, with the same `NextAvailableHint`
(`category="assessment"` — `useNextAvailable` already supports this category).

### Type selection (curated, tiered)
- `SessionCategory` becomes `'individual' | 'couples' | 'youth' | 'assessment'`.
- The picker shows exactly six assessments (client decision, 2026-07-22), in
  order: ADHD, Autism, OCD, Anxiety, Depression, Addiction — driven by the
  `ASSESSMENTS` config in `src/lib/assessments.ts` (Acuity screening type IDs
  verified live; they match the fettle.ie page links).
- **Only the stage-1 consultation is bookable** (live Acuity price/duration —
  that is what the client is charged). Later stages are display-only and
  mirror the fettle.ie pricing tables (client request, 2026-07-22): OCD /
  Anxiety / Depression show “Consultation + screening €89” → locked “Full
  clinical assessment €650 — Booked only after your initial consultation, if
  recommended by your psychologist.” → locked “Aftercare therapy From
  €80/session — Available once your clinical assessment is complete.”
  Addiction is a single bookable stage (site sells it at €140/1hr — see
  pricing-mismatch note below).
- ADHD and Autism render **last**, under a “With our partners” divider, as
  external cards (ADHD Now / AutismCare) with their website stage pricing
  (€89 / €695 / €495 and €89 / €1,199 / €599) linking to fettle.ie.
- **Addiction price override (client decision, 2026-07-22):** the website
  sells the addiction assessment at €140 while its Acuity type (94856237)
  lists €89/30min — the same behaviour as the fettle.ie widget, which books
  this Acuity type but charges €140 through its own Stripe flow. The hub now
  does likewise via `priceOverride: '140.00'` in `src/lib/assessments.ts`
  (shown in the picker, the fee box, and passed to `create-payment-intent`).
  The Acuity record still says 30 min, so the hub displays a 30-minute
  duration and Acuity blocks 30 minutes of calendar. Remaining Acuity-side
  mismatch: “Full … Assessment” types are €750 vs €650 on the website
  (display-only in the hub).
- `matchesCategory('assessment')` in `useNextAvailable` matches only the
  curated screening IDs so the “next available” hint reflects what is actually
  bookable. Bipolar/Mental-Health screenings and the Psychiatry Appointment in
  Acuity's Assessments category are intentionally excluded.

### Step flow
`type → date → time → details → confirm → payment → success` — the therapist
step is skipped. Selecting an assessment sets `selectedCalendar = null`, so
availability/times are **pooled** across the assessment calendars and Acuity
auto-assigns a clinician at booking time (`confirm-payment-and-book` already
treats `calendarID` as optional). Back buttons and the progress indicator
reflect the shorter flow.

### Details & intake
Standard adult intake fields (over-18 10466116, contact consent 9292394, terms
9292405) — same as individual sessions. `confirm-payment-and-book` already
adapts if Acuity rejects a field for this type (drops/adds and retries), so a
mismatch cannot fail a paid booking.

### Payment
Card payment only for assessments:
- Package credits can never match (`getPackageCategory` only returns therapy
  categories), so the credits UI stays hidden automatically.
- Loyalty coupon input and referral-credit toggle are hidden for assessments —
  these are therapy-loyalty mechanics; simplest safe default, easy to revisit.
- `create-payment-intent` is category-agnostic (charges Acuity’s price for the
  type, Stripe metadata carries the assessment’s name) — no changes needed.

### Confirmation / emails
Success screen and emails name the assessment via `appointmentTypeName` (already
flows through metadata). One server fix: with pooled booking `calendarName`
metadata is empty, so `confirm-payment-and-book` / `verify-payment-and-book`
fall back to the **Acuity-assigned clinician** (`appointment.calendar`) for the
“therapist” line in the success payload and confirmation email.

### Non-changes / regression safety
Individual, couples, youth, package, rebooking, and next-available flows keep
their exact current code paths — assessment behaviour is added behind
`sessionCategory === 'assessment'` branches only. Sessions page needs no change
(it renders `appointment.type` verbatim, e.g. “OCD Assessment Screening”).

## QA / acceptance mapping
- Start assessment booking from hub → dropdown entry (all placements: Dashboard,
  Sessions, package cards use the same component).
- Types listed clearly → Acuity Assessments category + partner link-outs.
- Correct availability/slots → pooled dates/times for the selected type.
- Correct appointment + payment → existing PI flow with type’s Acuity price.
- Success names the assessment → metadata `appointmentTypeName` + server fallback.
- Hub refresh → existing `onBookingComplete` / query invalidation path.
- Desktop & mobile QA after deploy (user tests live on the preview branch).
