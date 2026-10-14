// Builds the admin Bundles snapshot by calling the admin-bundles edge
// function one step at a time (see its index.ts): certificates, then each
// date range's appointments, then save. One call for everything runs past
// the edge-function time limit; each step stays well inside it.
//
// Run by .github/workflows/admin-snapshots.yml with FUNCTION_URL and
// CRON_SECRET set. PRIVACY: step responses hold client data — this script
// only ever prints counts, timings and statuses, never a response body.

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

const start = await callStep("certificates", { step: "certificates" });
console.log(
  `  ${start.certificates.length} certificates, ${start.match.codes.length} bundle codes, ` +
    `${start.ranges.length} date ranges (Acuity took ${seconds(start.durationMs)})`
);

const appointments = [];
const incompleteDates = [];
let acuityRequests = start.acuityRequests;
let windowAppointments = 0;
for (const [minDate, maxDate] of start.ranges) {
  const part = await callStep(`appointments ${minDate} to ${maxDate}`, {
    step: "appointments",
    minDate,
    maxDate,
    match: start.match,
  });
  appointments.push(...part.appointments);
  incompleteDates.push(...part.incompleteDates);
  acuityRequests += part.acuityRequests;
  windowAppointments += part.windowAppointments;
  console.log(
    `  ${part.windowAppointments} appointments, ${part.appointments.length} kept, ` +
      `${part.acuityRequests} Acuity requests (${seconds(part.durationMs)})`
  );
}

const saved = await callStep("save", {
  step: "save",
  certificates: start.certificates,
  appointments,
  incompleteDates,
  diagnostics: { windowAppointments, acuityRequests, durationMs: Date.now() - started },
});
console.log(
  `Saved ${saved.rows} bundles (${saved.totals.activeBundles} active) in ${seconds(Date.now() - started)}; ` +
    `${acuityRequests} Acuity requests, ${incompleteDates.length} incomplete dates`
);
