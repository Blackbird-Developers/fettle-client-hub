# Booking funnel tracking

How the website and the hub send booking-funnel events, so the admin Overview's **Booking funnel** tab can show how far people get in the booking form, where they drop off and which therapists they pick.

- **Sections 1–7** are for the website developer: the endpoint and the forwarder snippet.
- **Sections 8–10** are for hub developers: the hub side, how the tab counts, and deploying.

The website already pushes every event we need to `window.dataLayer`. The forwarder below listens to those pushes and sends a copy to our endpoint. **Nothing in the form itself has to change.**

## 1. Endpoint

```
POST https://gxeoillrmjezpehmcvrh.supabase.co/functions/v1/track-booking-funnel
```

- No auth header and no API key. The endpoint is public.
- Only these origins are accepted: `https://fettle.ie`, `https://www.fettle.ie`, `https://my.fettle.ie`. Any other origin gets `403`.
- Send the body as **`text/plain`** containing JSON. `navigator.sendBeacon` with a `Blob` of type `text/plain` works across origins; `application/json` doesn't.
- Answers:

  | Status | Meaning |
  |---|---|
  | `204` | Accepted. Unknown events in the batch are silently skipped. |
  | `400` | Bad body. The JSON body has an `error` field: `invalid_json`, `invalid_session_id`, `invalid_flow`, `no_events` or `too_many_events`. |
  | `413` | The body is over 32 KB. |
  | `429` | Rate limited: more than 300 events per minute from one IP. |

- **The endpoint isn't deployed yet.** We'll tell you when it's live. Until then, requests fail, and the forwarder ignores the failures.

## 2. Payload

```json
{
  "session_id": "fs_k3j9x2m1q8w7",
  "flow": "website",
  "is_test": false,
  "context": {
    "device": "mobile",
    "page": "/book-a-session/",
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "brand"
  },
  "events": [
    {
      "event_id": "ev_9f8e7d6c5b4a",
      "event": "booking_step_view",
      "ts": 1762258800000,
      "booking_flow": "quiz_v2_time_first",
      "step_name": "slot",
      "step": 3,
      "therapist": "Lisa Kelly"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `session_id` | Random, 8–64 characters of `A–Z a–z 0–9 _ -`. Kept for one visit; see section 3. |
| `flow` | Always `website` from the site. The hub sends `hub`. |
| `is_test` | `true` for `?mock=1` and `/book-a-session-v1/`. The dashboard leaves these out. |
| `context.device` | `mobile`, `tablet` or `desktop`. |
| `context.page` | Path only. The server strips any query string anyway. |
| `context.utm_*` | From the landing URL, if present. |
| `events` | 1–25 events. |
| `event_id` | Random and unique per event, same format as `session_id`. A beacon that's sent twice is stored once. |
| `event` | One of the names in section 4. Anything else is skipped. |
| `ts` | Epoch milliseconds (or an ISO string). If it's more than a day off from server time, it's replaced with server time. |

The server keeps only these event fields: `booking_flow`, `page_variant`, `step_name`, `step`, `therapist`, `therapist_id`, `entry_therapist`, `who`, `package_id`, `booking_id`, `amount`, `reason`, `referral_source`, `page`. **Everything else is dropped on the server**, including `Email`, `client_name`, `client_email` and phone numbers. Even so, please don't send them.

## 3. Session ID

- Make one on the first event and keep it in `sessionStorage`. The same tab carries it from /our-therapists to /book-a-session.
- Make a new one after **45 minutes** without events. That matches how long the form keeps answers after a refresh.
- **Bundles:** add it to the hand-off link: `https://my.fettle.ie/packages?fs=<session_id>`. The hub reads `fs` and reports the bundle purchase under the same session, so it counts as a conversion instead of a drop-off.

## 4. Events to forward

| Event | Where | Filter |
|---|---|---|
| `booking_page_redirect` | /our-therapists | Has no `booking_flow`. Forward it from /our-therapists only. |
| `booking_page_view`, `booking_step_view`, `booking_time_selected`, `booking_plan_selected`, `booking_plan_confirmed`, `booking_details_submitted`, `booking_payment_initiated`, `booking_payment_submitted`, `booking_payment_failed`, `booking_completed`, `booking_referral_source`, `booking_bundle_handoff` | /book-a-session | Only when `booking_flow` starts with `quiz_v2`. Events from /book-now, /free-consultation and the "Explore Pathways" quiz use the same names but have no `booking_flow`, so they're left out. |

Don't forward `stripe-success-conversion` or `consultation_reserved`. `booking_completed` already marks a booking.

If you later add `booking_no_availability` (no times in 12 months) or `booking_therapist_unavailable` (not taking bookings, or wrong id), the endpoint already accepts them. The "Earliest time" shortcut doesn't need to fire `booking_time_selected`, because the dashboard uses `step_view` for the slot step.

## 5. Forwarder snippet

Put this in the site's own JS (not in GTM, so ad blockers don't block it), on /our-therapists and /book-a-session. Load it **before** the wizard's first `dataLayer.push`.

```html
<script>
(function () {
  var ENDPOINT = "https://gxeoillrmjezpehmcvrh.supabase.co/functions/v1/track-booking-funnel";
  var IDLE_MS = 45 * 60 * 1000;
  // Set to true if Fettle decides this needs analytics consent (see section 6).
  var REQUIRE_CONSENT = false;

  var KEEP = ["booking_flow", "page_variant", "step_name", "step", "therapist", "therapist_id",
    "entry_therapist", "who", "package_id", "booking_id", "amount", "reason", "referral_source"];
  var WIZARD_EVENTS = {
    booking_page_view: 1, booking_step_view: 1, booking_time_selected: 1, booking_plan_selected: 1,
    booking_plan_confirmed: 1, booking_details_submitted: 1, booking_payment_initiated: 1,
    booking_payment_submitted: 1, booking_payment_failed: 1, booking_completed: 1,
    booking_referral_source: 1, booking_bundle_handoff: 1, booking_no_availability: 1,
    booking_therapist_unavailable: 1
  };

  function rid(prefix) {
    var a = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return prefix + Array.prototype.map.call(a, function (b) { return (b % 36).toString(36); }).join("");
  }

  function sessionId() {
    try {
      var now = Date.now();
      var s = JSON.parse(sessionStorage.getItem("fettle_funnel") || "null");
      if (!s || now - s.last > IDLE_MS) s = { id: rid("fs_") };
      s.last = now;
      sessionStorage.setItem("fettle_funnel", JSON.stringify(s));
      return s.id;
    } catch (e) { return rid("fs_"); }
  }
  // For the bundle hand-off link: "https://my.fettle.ie/packages?fs=" + window.fettleFunnelSession()
  window.fettleFunnelSession = sessionId;

  function device() {
    var w = window.innerWidth || 1024;
    return w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop";
  }

  var params = new URLSearchParams(location.search);
  var isTest = params.get("mock") === "1" || location.pathname.indexOf("/book-a-session-v1") === 0;

  function consentOk() {
    if (!REQUIRE_CONSENT) return true;
    try { return !!(window.cookiehub && window.cookiehub.hasConsented("analytics")); } catch (e) { return false; }
  }

  var queue = [];
  var timer = null;

  function flush() {
    timer = null;
    if (!queue.length) return;
    var batch = queue.splice(0, 25);
    var body = JSON.stringify({
      session_id: sessionId(),
      flow: "website",
      is_test: isTest,
      context: {
        device: device(),
        page: location.pathname,
        utm_source: params.get("utm_source"),
        utm_medium: params.get("utm_medium"),
        utm_campaign: params.get("utm_campaign")
      },
      events: batch
    });
    try {
      var blob = new Blob([body], { type: "text/plain" });
      if (!(navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob))) {
        fetch(ENDPOINT, { method: "POST", body: body, keepalive: true,
          headers: { "Content-Type": "text/plain" } }).catch(function () {});
      }
    } catch (e) {}
    if (queue.length) flush();
  }

  function forward(ev) {
    try {
      if (!ev || typeof ev !== "object" || !ev.event) return;
      var onTherapists = location.pathname.indexOf("/our-therapists") === 0;
      var ok = (ev.event === "booking_page_redirect" && onTherapists) ||
        (WIZARD_EVENTS[ev.event] && typeof ev.booking_flow === "string" && ev.booking_flow.indexOf("quiz_v2") === 0);
      if (!ok || !consentOk()) return;
      var out = { event_id: rid("ev_"), event: ev.event, ts: Date.now() };
      for (var i = 0; i < KEEP.length; i++) {
        if (ev[KEEP[i]] !== undefined && ev[KEEP[i]] !== null) out[KEEP[i]] = ev[KEEP[i]];
      }
      queue.push(out);
      if (ev.event === "booking_completed" || ev.event === "booking_bundle_handoff" || ev.event === "booking_page_redirect") {
        flush(); // the page may be about to change
      } else if (!timer) {
        timer = setTimeout(flush, 1000);
      }
    } catch (e) {}
  }

  window.dataLayer = window.dataLayer || [];
  for (var i = 0; i < window.dataLayer.length; i++) forward(window.dataLayer[i]);
  var push = window.dataLayer.push;
  window.dataLayer.push = function () {
    for (var j = 0; j < arguments.length; j++) forward(arguments[j]);
    return push.apply(window.dataLayer, arguments);
  };
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
})();
</script>
```

Notes:
- If GTM replaces `dataLayer.push` after this runs, the wrapper still works: GTM wraps the existing function and calls it.
- Each event is tracked independently and every error is caught, so a failure here can never break the form.

## 6. Consent (open, for Fettle)

The forwarder stores no cookies and no personal data: just a random per-visit ID in `sessionStorage`. Fettle has to decide one of these:

- **Treat it as necessary/first-party analytics** (`REQUIRE_CONSENT = false`). The counts are complete. The privacy policy has to mention it.
- **Only send after CookieHub analytics consent** (`REQUIRE_CONSENT = true`). The counts will be lower, by however many people decline or ignore the banner.

Separately: in testing, GA cookies were set before any banner click. Someone should check CookieHub's opt-in settings.

## 7. Testing on live

1. Open `https://fettle.ie/book-a-session/?t=319&mock=1` and go through to Done.
2. In DevTools → Network, filter `track-booking-funnel`. You should see beacons answered with `204`.
3. We check that the rows arrived with `is_test = true`.

## 8. The hub side

- **`src/lib/booking/funnel.ts`** is the hub's copy of the forwarder. The wizard's `track()` (`src/lib/booking/analytics.ts`) passes every event to it, so `/book` sends `flow: "hub"` with `booking_flow: "hub_quiz"`. `stripe-success-conversion` and `consultation_reserved` are not sent, because they carry personal data.
- **Bundle hand-off:** `src/main.tsx` calls `captureFunnelSessionFromUrl()` before routing, so `?fs=` survives a redirect to `/login`. A bundle bought afterwards is reported as `booking_bundle_purchased` under the website's session.
- **Bundle purchases** are reported from each place that confirms one: `PackagePaymentForm`, `usePaymentRedirectReturn` and the wizard's `confirmBundlePayment`. The `event_id` is `bp_<PaymentIntent id>`, so a purchase is stored once even if two of them run.
- Local dev runs are sent with `is_test: true`. Vercel preview origins aren't allowed, so previews send nothing.

## 9. How the Booking funnel tab counts

The tab is `src/components/admin/analytics/FunnelBoard.tsx`. Its data comes from `admin-analytics?action=funnel`. The counting is in `supabase/functions/admin-analytics/funnel.ts`, with tests.

- **A visit** is one funnel session (see section 3). It's dated by its first event, in Dublin time. Test runs are always left out.
- **Steps:**
  1. Opened the booking page
  2. Pressed Let's begin
  3. Date & time
  4. About you
  5. Your details
  6. Choose a plan
  7. Review
  8. Payment form
  9. Pressed Pay
  10. Booked
- **Each visit counts up to the furthest step it reached.** Steps it never saw count as passed, so skipped steps never look like drop-offs:
  - "Who it's for" for one-service therapists
  - the plan for psychologists
  - "About you" for returning hub clients
  - Review and Pay for website bundle buyers, who pay in the hub
- **Booked** means a session was booked, or a bundle was bought after the website hand-off. A bundle bought from the hub's Packages screen without a booking form isn't counted in the funnel.
- **Book Now clicks** come from /our-therapists, credited to the card clicked. They aren't a step, because many visitors land on the booking page directly.
- **Therapist columns** other than clicks use the last therapist the visit named, so matched visitors count for the therapist they picked.
- **Biggest drop** is the step with the highest % lost from the step before it.
- **Filters** are kept in the URL (`fflow`, `fpath`, `fservice`, `ftherapist`, `fdevice`), so a filtered view can be shared as a link. The tab shows at most one year.

## 10. Deploying

1. Run `supabase/migrations/20261104120000_booking_funnel_events.sql` on its own in the SQL editor (not `db push`). It's safe to re-run.
2. `supabase functions deploy track-booking-funnel`. `config.toml` already sets `verify_jwt = false` for it.
3. `supabase functions deploy admin-analytics`. It imports `../admin-customer-insights` and `./funnel.ts`, so use the CLI.
4. Optional: set `FUNNEL_EXTRA_ORIGINS` (comma-separated) to accept more origins, e.g. `http://localhost:8080` for local testing.
5. Test with `https://fettle.ie/book-a-session/?t=319&mock=1`. Rows should arrive in `booking_funnel_events` with `is_test = true`, and they won't show on the tab.

Old events delete themselves: about 1 request in 100 removes events older than 13 months.
