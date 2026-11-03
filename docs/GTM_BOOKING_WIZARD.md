# Booking wizard: Google Tag Manager events

This is for whoever looks after the Fettle GTM containers. It lists every event the client hub's booking wizard (`/book`) pushes to `window.dataLayer`, what each one contains, and what you need to know to set up tags for them.

## 1. Before you start

- **The hub has no GTM container switched on yet.** The events below are already pushed to `window.dataLayer`, but nothing reads them. To start tracking:
  1. Send the hub developers the container ID (`GTM-XXXXXXX`) to use. It can be the website's container or a new one just for the hub.
  2. They set it as `VITE_GTM_ID` in the hub's Vercel settings and redeploy. No code change is needed.
  3. After that, GTM loads on every hub page and the events below show up in GTM Preview mode.
- `/book` needs a login, so you need a hub client account to test in Preview mode.
- The hub is a single-page app. Moving between wizard steps does **not** reload the page. Use the `booking_step_view` event (or a History Change trigger) for step tracking, not Page View triggers.
- If a tag fails, booking is not affected. The code catches every analytics error.

## 2. Fields on every event

| Field | Value |
|---|---|
| `event` | The event name (see section 3). |
| `booking_flow` | Always `hub_quiz`. The website's wizard uses `quiz_v2_time_first`, so this field tells the two apart if both send to the same GA4 property. |
| `therapist` | The therapist's name, e.g. `Lisa Kelly`, or `null` before a therapist has been chosen. |

Set these up once as Data Layer Variables (version 2) and reuse them in every tag.

## 3. Events

Listed in the order a client normally meets them.

| Event | When it fires | Extra fields |
|---|---|---|
| `booking_page_view` | Once, when the wizard opens. | `step_name`, `entry_therapist` |
| `booking_step_view` | Every time a step is shown, including going back. | `step_name`, `step` |
| `booking_plan_selected` | The client taps a plan (single session, a bundle, or "use my bundle credit"). | `package_id` |
| `booking_plan_confirmed` | The client presses Continue on the plan step. | `package_id` |
| `booking_details_submitted` | The details form (name, email, phone) is valid and the client continues. | `package_id` (always `null`), `who` |
| `booking_payment_initiated` | The client leaves the review step for payment. | `package_id`, `package_title`, `package_price`, `amount`, `currency`, `selected_date`, `selected_time` |
| `booking_payment_submitted` | The client presses Pay (or Book, for credits) and the time is still free. | none |
| `booking_payment_failed` | Anything stops the payment or booking. | `reason`, `detail` |
| `stripe-success-conversion` | The booking is confirmed. | see below |
| `consultation_reserved` | The booking is confirmed. | see below |
| `booking_completed` | The booking is confirmed. | see below |
| `booking_referral_source` | On the confirmation screen, the client taps a "How did you hear about Fettle?" option. | `referral_source` |

The three "booking is confirmed" events always fire together, in that order, once per booking. **Use only one of them as the conversion**, or each booking counts three times. `booking_completed` is the cleanest choice for GA4. `stripe-success-conversion` uses the same field names as the website (`conversion`, `Email`, `ID`, `Type`, `AppointmentType`, `Calendar`, `Price`), so existing website tags built on those fields can be reused.

### Fields on the "booking is confirmed" events

**`booking_completed`**

| Field | Example | Notes |
|---|---|---|
| `booking_id` | `1543210987` | Acuity appointment ID. Can be `null` in the rare case the payment went through but the booking confirmation could not be read back (the team checks these by hand). |
| `package_id` | `single-individual` | See section 4. |
| `package_title` | `Single session` | |
| `package_price` | `95` | Plan list price in euro. |
| `amount` | `85.5` | What the client actually paid, in euro, after discounts. `0` when paid with bundle or referral credit. |
| `currency` | `EUR` | Always EUR. |
| `selected_date` | `2026-11-12` | Session date, Dublin time. |
| `selected_time` | `5:00pm` | Session time, Dublin time. |
| `appointment_type_id` | `12345678` | Acuity appointment type. |
| `calendar_id` | `87654321` | Acuity calendar (therapist). |
| `who` | `individual` | See section 4. |

**`stripe-success-conversion`**: `conversion` (amount paid), `booking_id`, `appointment_type_id`, `Email`, `ID` (same as `booking_id`), `Type` (same as `who`), `AppointmentType` (Acuity type name), `Calendar` (therapist name), `Price` (amount paid).

**`consultation_reserved`**: `client_name`, `client_email`, `payment_status`, `booking_id`, `plan` (same as `package_id`), `plan_price`, `slot_day`, `slot_time`.

### Personal data warning

`stripe-success-conversion` (`Email`) and `consultation_reserved` (`client_name`, `client_email`) contain the client's name and email. **Do not send these fields to GA4**: Google's terms forbid it, and this is health-related data. Only map them into tags that are allowed to receive them (for example, hashed enhanced conversions), and check with Fettle first.

## 4. Field values

**`step_name`** (and `step`, the step's position in this client's flow, starting at 1). Not every client sees every step, so the same `step_name` can have a different `step` number for different clients. Report on `step_name`.

| `step_name` | Step |
|---|---|
| `intro` | Welcome screen |
| `who` | Who the sessions are for |
| `consultation` | Psychologist consultation type |
| `topics` | What the client wants help with (matching) |
| `matches` | Suggested therapists |
| `slot` | Pick a day and time |
| `history` | Has the client had therapy before |
| `details` | Name, email, phone |
| `plan` | Single session or bundle |
| `review` | Review and consents |
| `pay` | Payment |
| `done` | Confirmation |

**`who`**: `individual`, `couples`, `youth` or `psychologist`.

**`entry_therapist`**: the `therapist` value from the link the client came in on (a therapist ID, calendar ID, slug or name), or `null` when they did not come from a therapist link.

**`package_id`**

| Value | Plan |
|---|---|
| `single-individual` | Individual single session (€95) |
| `single-couples` | Couples single session (€135) |
| `single-youth` | Youth single session (€125) |
| `1122832` | Individual 3-session bundle (€271.50) |
| `996385` | Individual 6-session bundle (€528) |
| `1197875` | Individual 9-session bundle (€765) |
| `1370588` | Youth 3-session bundle (€325) |
| `1975510` | Youth 5-session bundle (€550) |
| `2000708` | Couples 3-session bundle (€345) |
| `1967869` | Couples 5-session bundle (€575) |
| `credit` | Paid with a session from a bundle the client already owns |
| `null` | Psychologist consultations (they have no plan step) |

Prices are the current list prices and can change; the live price is always in `package_price`.

**`payment_status`** (on `consultation_reserved`): `package_credit` (bundle session), `referral_credit` (referral credit), or the Stripe payment status for card and wallet payments (normally `succeeded`).

**`reason`** (on `booking_payment_failed`)

| `reason` | Meaning | `detail` |
|---|---|---|
| `slot_check_failed` | Could not check the time was still free. | Error text |
| `slot_unavailable` | Someone else took the time. | `before_charge` or `after_charge` (refunded automatically) |
| `stripe_form_invalid` | Card details incomplete or invalid. | Stripe's message |
| `stripe_confirm_error` | Stripe declined or could not confirm the payment. | Stripe's message |
| `unexpected_payment_status` | The payment came back in a state other than success. | The Stripe status |
| `acuity_booking_failed` | The payment step was fine but Acuity would not take the booking. | Error text |

**`referral_source`**: `Google`, `Social media`, `Friend or family`, `GP or healthcare provider`, `Insurance provider` or `Other`. Only sent to GTM; it is not saved anywhere else.

## 5. Suggested GA4 setup

1. One **GA4 Event** tag with a Custom Event trigger matching `^booking_` (regex), event name `{{Event}}`, and the fields above as event parameters (leaving out the personal data ones). That covers the funnel with one tag.
2. Mark `booking_completed` as a key event (conversion), with `amount` as the value and `currency` as the currency.
3. For a funnel report: `booking_page_view` → `booking_step_view` with `step_name = slot` → `details` → `plan` → `review` → `booking_payment_submitted` → `booking_completed`.
4. Filter or segment on `booking_flow = hub_quiz` if the website sends to the same property.

## 6. Checking it works

1. Open GTM Preview mode on the hub, log in as a test client and go to `/book`.
2. You should see `booking_page_view` then `booking_step_view` straight away, and one `booking_step_view` per step after that.
3. Use a bundle credit or referral credit on a test account to reach `booking_completed` without a card payment. For card payments, ask the developers for a Stripe test-mode environment.
