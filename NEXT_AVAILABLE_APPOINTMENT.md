# Next Available Appointment

Surfaces the earliest bookable Acuity slot across the Fettle Client Hub so
clients can see and book the soonest option without digging through calendars.

## Summary

- Dynamic "next available" data sourced live from Acuity availability (no
  hardcoded dates).
- Shown in three places: a prominent dashboard banner, hints inside the
  "Book a Session" dropdown, and an "earliest available" shortcut inside the
  booking modal.
- Clicking the dashboard banner resolves the exact therapist for that slot and
  drops the user straight onto the details/checkout step — no changes to the
  payment path itself.
- All logic lives in one reusable hook so it isn't duplicated across components.

## New files

### `src/hooks/useNextAvailable.ts`
Reusable hook + helpers — the single source of truth for earliest-availability
logic.

- `useNextAvailable(category, options)` — returns `{ slot, loading, error,
  noAvailability, refetch }` for a booking category (`individual` | `couples` |
  `youth` | `assessment`).
  - Filters Acuity appointment types by category (mirrors `BookingModal`'s
    category → name-prefix mapping).
  - Fans out lightweight dates-only availability calls across the category's
    types in parallel, walks the earliest days first, then fetches times and
    returns the single earliest **future** slot.
  - Checks the current month, then next month. Filters out past times so an
    end-of-day "today" correctly rolls over to the next day.
  - Cached via react-query (`staleTime` 5 min) so multiple placements share one
    result and the dashboard isn't slowed by repeated calls.
  - Options: `enabled` (lazy-load, e.g. only when a dropdown opens),
    `calendarId` (scope to one therapist), `typeFilter` (override the matcher).
- `resolveSlotCalendar(appointmentTypeId, calendarIds, isoDate)` — pooled
  availability tells us the earliest time but not which therapist owns it, so
  this probes the type's calendars and returns the one with the earliest
  bookable time. Run on demand (on click) to keep the dashboard fast.
- `formatNextAvailable(iso)` — Ireland-friendly format, e.g.
  `1:00pm, Friday 17 July` (uses the viewer's local timezone, correct for
  Ireland users).
- `formatNextAvailableShort(iso)` — compact variant for tight spaces, e.g.
  `6:00pm, Mon 20 Jul`.
- `matchesCategory(type, category)` — exported category → type matcher.

### `src/components/dashboard/NextAvailableBanner.tsx`
Prominent dashboard banner: `Next available appointment: [date/time]`.

- Uses `useNextAvailable('individual')`.
- On click: shows a brief "Finding therapist…" state, calls
  `resolveSlotCalendar` to find the therapist, then opens the booking modal
  straight at the **details/checkout** step with type + therapist + date + time
  preselected. Falls back to the therapist step if resolution fails.
- Handles loading (skeleton), error ("Availability unavailable right now"), and
  no-availability ("No immediate availability — check the calendar for later
  dates") states.

## Modified files

### `src/pages/Dashboard.tsx`
- Renders `<NextAvailableBanner />` between the welcome header and the quick
  stats.

### `src/components/booking/BookSessionDropdown.tsx`
- Added a `NextAvailableHint` that shows `Next available: <date>` under each of
  Individual / Couple's / Youth, loaded lazily only when the menu opens
  (`enabled={menuOpen}`), using the compact date format.
- Widened the dropdown (`w-64` → `w-72`) and let the hint wrap instead of
  clipping, so longer dates fit.

### `src/components/booking/BookingModal.tsx`
- New props: `preselectedType` and `preselectedTimeISO` — let callers preselect
  a slot and skip ahead (used by the banner to jump to checkout).
- "Earliest available" one-tap chip above the calendar on the date step, scoped
  to the selected therapist; tapping it fills the date/time and jumps to
  details.
- **Bug fix (pre-existing):** the wizard only reset after a successful booking,
  so closing mid-flow left stale state and reopening for another category
  dropped the user back onto the last step. Reset logic is now extracted into
  `resetWizardState()` and run on every open via a `useLayoutEffect` (before
  paint, no flicker). Every entry point (dropdown, Sessions page, MyTherapist
  rebook, banner) now starts clean.

## Payment path

Unchanged. The feature only affects how a user *enters* the modal; from the
details step onward (confirm → payment) the code is identical — same
`create-payment-intent`, `book-with-package`, `book-with-credit`, Stripe
`PaymentForm`, coupon and referral-credit logic.

## Notes / future

- The `assessment` category matcher is pre-wired (matches type names containing
  "assessment") for the sibling assessment-booking task; callers can override
  via the `typeFilter` option once the convention is firm.
- The dashboard banner uses the `individual` category as the single prominent
  slot; this can be changed or extended to show the soonest across categories.
