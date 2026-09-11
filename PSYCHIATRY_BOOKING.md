# Psychiatry in the Fettle Client Hub

**Source page:** [fettle.ie/psychiatry](https://fettle.ie/psychiatry/)
**Status:** In development on `feature/psychiatry-tab`

## What clients can do

- **Psychiatry tab** (`/psychiatry`, sidebar, marked "New"): an in-hub version
  of the fettle.ie psychiatry page. It covers:
  - the consultation and its live "Earliest available" slot
  - the client's upcoming psychiatry appointments
  - the pathway with pricing
  - conditions treated and a pre-consultation checklist
  - who online psychiatry suits, with a shortcut to Assessments for clients
    without a diagnosis
  - FAQs and crisis lines
- **Book New Session → Psychiatry**: a new entry in the shared dropdown on
  Dashboard, Sessions and the package cards, with a "Next available" hint.

## Pathway

| Stage | Booked via | Price |
|---|---|---|
| Initial consultation (60 min video) | Hub / Acuity `95879530` "Psychiatry Medication Appointment" | **€450** (live Acuity price) |
| Follow-up medication review (30 min, ~1 month) | Arranged by the psychiatrist | €220 (display-only) |
| Second follow-up (30 min, if needed) | Arranged by the psychiatrist | €220 (display-only) |
| Repeat prescriptions (~every 3 months) | Arranged by the psychiatrist | €50 (display-only) |

`95879530` is the type the fettle.ie psychiatry widget books. Prices and
wording follow the website. Only the consultation can be booked in the hub.

## Booking flow

1. **Consultation** step: the bookable consultation card (duration, price,
   clickable next-available hint), the later stages shown locked, a reminder
   to have the diagnosis report ready, and a crisis note.
2. Date → time → details → confirm → pay → success. There is **no therapist
   step**: availability is pooled across the type's calendars and Acuity
   assigns the psychiatrist (same as assessments).
3. From the Psychiatry tab, "Book consultation" skips step 1. "Earliest
   available" jumps straight to details with the slot selected.

**Details step:** the same intake as the fettle.ie psychiatry widget:
- reason (4 paid reasons; "not sure" links to the free 20-minute call, since
  hub checkout only handles paid types)
- date of birth (must be 18+)
- GP (optional), current medication (optional)
- emergency contact name and phone
- where they heard about Fettle
- phone (required for psychiatry)
- a required "not an emergency service" confirmation, alongside over-18,
  contact consent and terms

These are written to the Acuity appointment notes in the website's format
(`Reason: … | DOB: … | GP: … | Current medication: … | Emergency contact: … |
Hear about: … | Notes: …`). Intake fields `18105514` (heard about) and
`9291898` (terms) are sent, as on the website. Notes reach checkout through
Stripe metadata (500-character limit), so the details step blocks answers
longer than that.

**Payment:** card only. Package credits, coupons and referral credit are
hidden and stripped from the request (`isClinicalCategory` in
`BookingModal.tsx`).

## Key files

| File | Role |
|---|---|
| `src/lib/psychiatry.ts` | Bookable type ID, later-stage pricing, `isPsychiatryAppointment` |
| `src/pages/Psychiatry.tsx` | The Psychiatry tab |
| `src/components/booking/BookingModal.tsx` | `SessionCategory 'psychiatry'` branch |
| `src/components/booking/BookSessionDropdown.tsx` | Psychiatry menu entry |
| `src/hooks/useNextAvailable.ts` | `psychiatry` category matcher |
| `src/components/layout/Sidebar.tsx`, `src/App.tsx` | Nav item and protected route |

No edge function or migration changes. Pooled bookings already fall back to
the Acuity-assigned clinician's name in `confirm-payment-and-book`.

## Open questions for the Fettle team

1. **Calendar pool:** Acuity type `95879530` is offered on these calendars:
   - Dr. Maria Grazio Rubeo (14458100)
   - Dr. Zai Edworthy (14263454)
   - Fabiola Honorio Neto (14081738)
   - "Preliminary Availability Calendar" (13216804)

   Pooled booking can assign any of them. Confirm they should all take
   psychiatry consultations.
2. **Legacy psychiatry types:** Acuity's "Psychiatry" category still has:
   - Psychiatry Assessment 56229647 (€450)
   - Psychiatry Appointment 57165366 (€450)
   - Follow Up Consultation 56229698 (**€200**; the website says €220)
   - a private payment-plan type 63878915

   They aren't bookable in the hub but are recognised in a client's history.
3. **In-hub follow-ups:** follow-ups and repeat prescriptions could be made
   bookable for clients who already have a completed psychiatry consultation,
   once the Acuity follow-up type and price are confirmed.

## QA checklist

- [ ] Sidebar shows Psychiatry (desktop and mobile sheet); `/psychiatry` requires login
- [ ] Tab shows €450 / 60 min from Acuity, an "Earliest available" slot, and upcoming psychiatry appointments
- [ ] "Book consultation" opens the modal on the date step; "Earliest available" opens on details
- [ ] Dropdown → Psychiatry opens the consultation step; locked stages and notes read correctly
- [ ] No coupon, referral credit or package credit options at confirm; fee label reads "Consultation fee"
- [ ] One real end-to-end booking: €450 charge, Acuity appointment with an assigned psychiatrist, confirmation email (then cancel/refund)
- [ ] "No diagnosis yet? Book an assessment" opens the assessments flow
- [ ] Regression: Individual and Assessment bookings still reach the payment step
