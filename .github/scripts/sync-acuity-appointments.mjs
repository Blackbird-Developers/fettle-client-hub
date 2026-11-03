// Keeps the acuity_appointments copy up to date by calling the
// acuity-appointments-mirror edge function one step at a time (see its
// index.ts). One call for everything would run past the edge-function time
// limit, so:
//   1. plan     — the date ranges for this run
//   2. range    — per refresh range: re-copy the last 60 days and next 180
//   3. prune    — remove refresh-window rows Acuity no longer returns
//   4. state    — mark the data as refreshed
//   5. range    — per history range (until the full history is copied)
//   6. details  — look up who made each new booking, a batch at a time
//   7. sources  — match main-account bookings to website / hub payments
//   8. state    — save this run's counts
//
// Run by .github/workflows/admin-snapshots.yml with FUNCTION_URL and
// CRON_SECRET set. PRIVACY: responses carry only counts, dates and
// appointment ids, and this script prints counts, timings and statuses only.

const FUNCTION_URL = process.env.FUNCTION_URL;
const CRON_SECRET = process.env.CRON_SECRET;
/** Longer than Supabase lets the function run, so its own error comes back. */
const CALL_TIMEOUT_MS = 170_000;
const ATTEMPTS = 3;

if (!FUNCTION_URL || !CRON_SECRET) {
  console.error("FUNCTION_URL and CRON_SECRET must be set");
  process.exit(1);
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

// POSTs one step, retrying failed calls (gateway errors, timeouts). Bad
// requests (4xx) aren't retried.
async function callStep(label, payload) {
  for (let attempt = 1; ; attempt++) {
    const started = Date.now();
    let status = "no response";
    try {
      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: { "x-cron-secret": CRON_SECRET, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      status = String(response.status);
      if (response.ok) {
        const data = await response.json();
        console.log(`${label}: ok in ${seconds(Date.now() - started)}`);
        return data;
      }
      // Our own errors are short, data-free messages; gateway pages aren't printed.
      const text = await response.text();
      let message = "";
      try {
        message = JSON.parse(text).error ?? "";
      } catch {
        // not JSON (e.g. a gateway error page)
      }
      status += message ? ` (${String(message).slice(0, 200)})` : "";
      if (response.status >= 400 && response.status < 500) {
        throw Object.assign(new Error(`${label}: ${status}`), { final: true });
      }
    } catch (error) {
      if (error.final) throw error;
      if (error.name === "TimeoutError") status = "timed out";
      else if (status === "no response") status += ` (${error.message})`;
    }
    console.log(`${label}: attempt ${attempt} failed after ${seconds(Date.now() - started)} — ${status}`);
    if (attempt >= ATTEMPTS) throw new Error(`${label} failed ${ATTEMPTS} times`);
    await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt));
  }
}

const started = Date.now();
const summary = {
  refreshed: 0,
  removed: 0,
  backfillRanges: 0,
  backfilled: 0,
  detailsChecked: 0,
  detailsFailed: 0,
  detailsRemaining: null,
  sourcesChecked: 0,
  sourcesRemaining: null,
  incompleteDates: 0,
  acuityRequests: 0,
};

try {
  // 1. Plan.
  const plan = await callStep("plan", { step: "plan" });
  console.log(
    `  ${plan.refreshRanges.length} refresh ranges, ${plan.backfillRanges.length} history ranges`
  );

  // 2. Refresh the rolling window.
  const seenIds = [];
  let refreshIncomplete = 0;
  for (const [minDate, maxDate] of plan.refreshRanges) {
    const part = await callStep(`refresh ${minDate} to ${maxDate}`, { step: "range", minDate, maxDate });
    seenIds.push(...part.ids);
    summary.refreshed += part.saved;
    summary.acuityRequests += part.acuityRequests;
    refreshIncomplete += part.incompleteDates.length;
    console.log(`  ${part.saved} appointments (${part.cancelled} cancelled), ${part.acuityRequests} Acuity requests`);
  }
  summary.incompleteDates += refreshIncomplete;

  // 3. Prune — only after a complete refresh, or a missed day would look deleted.
  if (refreshIncomplete === 0) {
    const pruned = await callStep("prune", {
      step: "prune",
      minDate: plan.refreshWindow.minDate,
      maxDate: plan.refreshWindow.maxDate,
      seenIds,
    });
    summary.removed += pruned.removed;
    console.log(`  ${pruned.checked} rows checked, ${pruned.removed} removed`);
  } else {
    console.log(`  prune skipped: ${refreshIncomplete} incomplete dates`);
  }

  // 4. The boards show this as "Data last updated".
  await callStep("mark refreshed", { step: "state", refreshed: true });

  // 5. Copy history, newest first.
  for (const [minDate, maxDate] of plan.backfillRanges) {
    const part = await callStep(`history ${minDate} to ${maxDate}`, {
      step: "range",
      minDate,
      maxDate,
      backfill: true,
    });
    summary.backfillRanges++;
    summary.backfilled += part.saved;
    summary.acuityRequests += part.acuityRequests;
    summary.incompleteDates += part.incompleteDates.length;
  }
  if (plan.backfillRanges.length > 0) {
    console.log(`  ${summary.backfilled} history appointments copied`);
  }

  // 6. Who made each booking.
  for (let i = 0; i < plan.maxDetailSteps; i++) {
    const part = await callStep(`details batch ${i + 1}`, { step: "details", limit: plan.detailsPerStep });
    summary.detailsChecked += part.checked;
    summary.detailsFailed += part.failed;
    summary.detailsRemaining = part.remaining;
    summary.acuityRequests += part.acuityRequests;
    console.log(`  ${part.checked} checked, ${part.failed} failed, ${part.remaining} still to check`);
    // Stop when the queue is empty, or when nothing got through (Acuity trouble).
    if (part.remaining === 0 || part.checked + part.removed === 0) break;
  }

  // 7. Where main-account bookings came from. Skipped by a copy of the
  // function deployed before this step (its plan doesn't offer it). A Stripe
  // problem is recorded but doesn't fail the run: the copy itself is fine.
  if (plan.sourcesPerStep) {
    try {
      for (let i = 0; i < plan.maxSourceSteps; i++) {
        const part = await callStep(`sources batch ${i + 1}`, { step: "sources", limit: plan.sourcesPerStep });
        summary.sourcesChecked += part.checked;
        summary.sourcesRemaining = part.remaining;
        console.log(`  ${part.checked} matched, ${part.paymentsRead ?? 0} payments read, more to do: ${part.remaining > 0}`);
        if (part.remaining === 0 || part.checked === 0) break;
      }
    } catch (error) {
      summary.sourcesError = String(error.message).slice(0, 200);
      console.log(`  sources stopped: ${summary.sourcesError}`);
    }
  }

  // 8. Save the counts.
  summary.durationMs = Date.now() - started;
  await callStep("save summary", { step: "state", summary });
  console.log(`Done in ${seconds(summary.durationMs)}: ${JSON.stringify(summary)}`);
} catch (error) {
  // Error messages are data-free (see callStep).
  await callStep("save error", { step: "state", error: String(error.message).slice(0, 500) }).catch(() => {});
  console.error(error.message);
  process.exit(1);
}
