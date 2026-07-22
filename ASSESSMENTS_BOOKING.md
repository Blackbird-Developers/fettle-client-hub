# Assessments Booking in the Fettle Client Hub

**ClickUp:** [Fettle Hub: Add assessment booking flow](https://app.clickup.com/t/86carvnz3)
**PRs:** [#6](https://github.com/Blackbird-Developers/fettle-client-hub/pull/6) (initial feature) · [#8](https://github.com/Blackbird-Developers/fettle-client-hub/pull/8) (flow restructure, availability hints, dashboard cleanup)
**Status:** Live on [my.fettle.ie](https://my.fettle.ie) (frontend via Vercel; `confirm-payment-and-book` edge function redeployed 2026-07-22)

## What clients can do

Logged-in hub clients can book assessments directly from **Book New Session →
Assessments** (available on the Dashboard, Sessions page, and package cards —
all share the same dropdown). The dropdown entry shows a live "Next available"
hint like the therapy categories.

## The six assessments

| Assessment | Booked via | Stage 1 (bookable) | Later stages (display-only) |
|---|---|---|---|
| OCD | Hub / Acuity `92852936` | Consultation + screening **€89** | Full clinical assessment €650 · Aftercare therapy from €80/session |
| Anxiety | Hub / Acuity `92853020` | Consultation + screening **€89** | Full clinical assessment €650 · Aftercare therapy from €80/session |
| Depression | Hub / Acuity `92853161` | Consultation + screening **€89** | Full clinical assessment €650 · Aftercare therapy from €80/session |
| Addiction | Hub / Acuity `94856237` | Addiction assessment **€140 · 60 min** (overrides, see below) | — |
| ADHD | Partner → [fettle.ie/adhd-assessment](https://fettle.ie/adhd-assessment/) (ADHD Now) | €89 | Full Assessment €695 · Diagnosis & Report €495 |
| Autism | Partner → [fettle.ie/autism-assesments](https://fettle.ie/autism-assesments/) (AutismCare) | €89 | Assessment & Diagnosis €1,199 · Report & Support Plan €599 |

Stage structure, prices, and conditional wording mirror the fettle.ie
assessment pages. Only the stage-1 consultation is bookable in the hub — later
stages are shown locked ("Booked only after your initial consultation, if
recommended by your psychologist." / "Available once your clinical assessment
is complete.") and are arranged by the clinical team after the consultation.

## Booking flow (two steps + the usual wizard)

1. **Choose assessment** — six compact cards (name, live "⚡ Next available"
   hint, "From €X"). ADHD/Autism list last under a "With our partners"
   divider.
2. **Pricing options** — the chosen assessment's staged pricing: the bookable
   initial consultation on top, locked later stages below. Partner
   assessments show their three stages and a **Continue with ADHD Now /
   AutismCare** button that opens the fettle.ie page.
3. Date → time → details → confirm → pay → success, as with therapy sessions.
   There is **no therapist step**: availability is pooled across the three
   assessment-clinician calendars and Acuity assigns the clinician at booking
   time. The confirmation email and success screen name the assessment and
   the assigned clinician.

## Earliest-available shortcuts

Every option card in the type-selection step — Individual/Couples/Youth
session types **and** the assessment cards — shows the earliest available slot
for that specific service. **Clicking the hint jumps straight to the details
step with that slot preselected**: for therapy types the hub first resolves
which therapist owns the pooled slot (brief "Opening…" spinner); assessments
stay pooled and let Acuity assign the clinician. Results are react-query
cached (5 min). The old "next available appointment" banner on the main
dashboard was removed in favour of these in-context hints (PR #8).

## Payment

Same production pipeline as therapy sessions: `create-payment-intent` →
embedded Stripe form → `confirm-payment-and-book` (books Acuity first, keeps
payment only on success, auto-refunds on failure; redirect methods go through
`verify-payment-and-book`). Assessment-specific rules:

- **Card only** — package credits, loyalty coupons, and referral credit are
  hidden and stripped from the request.
- **Addiction override** — the Acuity record lists €89/30 min, but the
  website sells €140/1 hr through its own widget (which books the same Acuity
  type). The hub matches the website via `priceOverride: '140.00'` and
  `durationOverride: 60` in `src/lib/assessments.ts`. The client is charged
  €140. Note: Acuity still blocks only 30 min of clinician calendar.

## Key files

| File | Role |
|---|---|
| `src/lib/assessments.ts` | Curated assessment config: names, Acuity type IDs, stage pricing/notes, partner links, price/duration overrides |
| `src/components/booking/BookingModal.tsx` | `SessionCategory 'assessment'` branch: assessment + pricing steps, pooled flow, payment gating |
| `src/components/booking/NextAvailableTypeHint.tsx` | Clickable per-type "next available" hint used on all option cards |
| `src/components/booking/BookSessionDropdown.tsx` | Assessments menu entry + category-level next-available hint |
| `src/hooks/useNextAvailable.ts` | `assessment` category matches only the bookable screening type IDs; `resolveSlotCalendar` finds the therapist owning a pooled slot |
| `supabase/functions/confirm-payment-and-book/index.ts` | Falls back to the Acuity-assigned clinician's name in the email/success payload for pooled bookings |
| `docs/superpowers/specs/2026-07-22-assessments-booking-design.md` | Original design doc |

## QA checklist

- [ ] Picker shows all six assessments with correct "From" pricing (Addiction €140)
- [ ] Choosing an assessment shows its pricing step; locked stages read correctly; ADHD/Autism "Continue with partner" opens fettle.ie
- [ ] Consultation → dates/times load (pooled, no therapist step); Addiction shows 60 min
- [ ] Clicking a card's "Next available" hint lands on details with the right therapist/slot (therapy) or pooled slot (assessment)
- [ ] One real end-to-end booking: correct charge, Acuity appointment created, confirmation email names the assessment + clinician, dashboard refreshes (then cancel/refund)
- [ ] Dashboard no longer shows the next-available banner
- [ ] Mobile-width pass on picker, pricing step, and checkout
- [ ] Regression: normal Individual booking to payment step; rebook with previous therapist

## Open decisions (not required by the task)

1. **Unlocking later stages in-hub** — currently the clinical team arranges
   stage 2+ off-platform (same as the website). Options if in-hub unlocking
   is wanted: auto-unlock when a completed screening exists in the client's
   Acuity history, or a clinician-set recommendation flag (truer to the
   clinical intent, needs a small admin surface).
2. **Acuity record reconciliation** — the Addiction type (€89/30 min) and the
   "Full … Assessment" types (€750 vs €650 on the website) don't match the
   site's pricing. Aligning them in the Acuity admin would let the hub drop
   its overrides and would make Acuity block the true appointment length.
