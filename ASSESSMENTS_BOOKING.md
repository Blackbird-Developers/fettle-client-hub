# Assessments Booking in the Fettle Client Hub

**ClickUp:** [Fettle Hub: Add assessment booking flow](https://app.clickup.com/t/86carvnz3)
**PR:** [#6](https://github.com/Blackbird-Developers/fettle-client-hub/pull/6) — merged to `main` 2026-07-22
**Status:** Live on [my.fettle.ie](https://my.fettle.ie) (frontend via Vercel; `confirm-payment-and-book` edge function redeployed)

## What clients can do

Logged-in hub clients can book assessments directly from **Book New Session → Assessments** (available on the Dashboard, Sessions page, and package cards — all share the same dropdown). The entry shows a live "Next available" hint like the therapy categories.

## The six assessments

| Assessment | Booked via | Stage 1 (bookable) | Later stages (display-only) |
|---|---|---|---|
| OCD | Hub / Acuity `92852936` | Consultation + screening **€89** | Full clinical assessment €650 · Aftercare therapy from €80/session |
| Anxiety | Hub / Acuity `92853020` | Consultation + screening **€89** | Full clinical assessment €650 · Aftercare therapy from €80/session |
| Depression | Hub / Acuity `92853161` | Consultation + screening **€89** | Full clinical assessment €650 · Aftercare therapy from €80/session |
| Addiction | Hub / Acuity `94856237` | Addiction assessment **€140 · 60 min** (overrides, see below) | — |
| ADHD | Partner link-out → [fettle.ie/adhd-assessment](https://fettle.ie/adhd-assessment/) (ADHD Now) | €89 | Full Assessment €695 · Diagnosis & Report €495 |
| Autism | Partner link-out → [fettle.ie/autism-assesments](https://fettle.ie/autism-assesments/) (AutismCare) | €89 | Assessment & Diagnosis €1,199 · Report & Support Plan €599 |

Stage structure, prices, and conditional wording mirror the fettle.ie assessment
pages. Only the stage-1 consultation is bookable in the hub — later stages are
shown locked with notes ("Booked only after your initial consultation, if
recommended by your psychologist." / "Available once your clinical assessment
is complete.") and are arranged by the clinical team after the consultation.
ADHD and Autism run on partner booking systems (Semble / AutismCare's backend),
so their cards are informational and link out.

## Booking flow

Assessment → date → time → details → confirm → pay → success. There is **no
therapist step**: availability is pooled across the three assessment-clinician
calendars and Acuity assigns the clinician at booking time. The confirmation
email and success screen name the assessment and the assigned clinician.

## Payment

Same production pipeline as therapy sessions: `create-payment-intent` →
embedded Stripe form → `confirm-payment-and-book` (books Acuity first, keeps
payment only on success, auto-refunds on failure; redirect methods go through
`verify-payment-and-book`). Assessment-specific rules:

- **Card only** — package credits, loyalty coupons, and referral credit are
  hidden and stripped from the request.
- **Addiction override** — the Acuity record lists €89/30 min, but the website
  sells €140/1 hr through its own widget (which books the same Acuity type).
  The hub matches the website via `priceOverride: '140.00'` and
  `durationOverride: 60` in `src/lib/assessments.ts`. The client is charged
  €140. Note: Acuity still blocks only 30 min of clinician calendar.

## Key files

| File | Role |
|---|---|
| `src/lib/assessments.ts` | Curated assessment config: names, Acuity type IDs, stage pricing/notes, partner links, price/duration overrides |
| `src/components/booking/BookingModal.tsx` | `SessionCategory 'assessment'` branch: tiered picker, pooled flow, payment gating |
| `src/components/booking/BookSessionDropdown.tsx` | Assessments menu entry + next-available hint |
| `src/hooks/useNextAvailable.ts` | `assessment` category matches only the bookable screening type IDs |
| `supabase/functions/confirm-payment-and-book/index.ts` | Falls back to the Acuity-assigned clinician's name in the email/success payload for pooled bookings |
| `docs/superpowers/specs/2026-07-22-assessments-booking-design.md` | Full design doc |

## QA checklist (outstanding)

- [ ] Picker shows all six assessments with correct pricing (Addiction €140 / 60 min)
- [ ] ADHD/Autism cards open the fettle.ie pages in a new tab
- [ ] Screening → dates/times load (pooled, no therapist step)
- [ ] One real end-to-end booking: €140/€89 charged correctly, Acuity appointment created, confirmation email names the assessment + clinician, dashboard refreshes (then cancel/refund the test booking)
- [ ] Mobile-width pass on picker + checkout
- [ ] Regression: normal Individual booking to payment step; rebook with previous therapist

## Open decisions (not required by the task)

1. **Unlocking later stages in-hub** — currently the clinical team arranges
   stage 2+ off-platform (same as the website). Options if in-hub unlocking is
   wanted: auto-unlock when a completed screening exists in the client's
   Acuity history, or a clinician-set recommendation flag (truer to the
   clinical intent, needs a small admin surface).
2. **Acuity record reconciliation** — the Addiction type (€89/30 min) and the
   "Full … Assessment" types (€750 vs €650 on the website) don't match the
   site's pricing. Aligning them in the Acuity admin would let the hub drop
   its overrides and would make Acuity block the true appointment length.
