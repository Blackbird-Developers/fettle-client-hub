// Builds the admin Bundles snapshot by calling the admin-bundles edge
// function one step at a time (see its index.ts). One call for everything
// runs past the edge-function time limit, and Acuity's full certificate list
// times out, so:
//   1. plan          — date ranges, and Hub account emails
//   2. emails        — per date range: the emails on a year of appointments
//   3. certificates  — per batch of emails: their certificates
//   4. match         — the codes and emails that tie appointments to a bundle
//   5. appointments  — per date range: the appointments a bundle can use
//   6. save          — build the view and save it to admin_snapshots
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
let acuityRequests = 0;

// 1. Plan.
const plan = await callStep("plan", { step: "plan" });
console.log(
  `  ${plan.emailRanges.length} email ranges, ${plan.appointmentRanges.length} appointment ranges, ` +
    `${plan.hubEmails.length} Hub account emails`
);

// 2. Emails from a year of appointments, plus the Hub accounts'.
const emails = new Set(plan.hubEmails);
for (const [minDate, maxDate] of plan.emailRanges) {
  const part = await callStep(`emails ${minDate} to ${maxDate}`, { step: "emails", minDate, maxDate });
  part.emails.forEach((email) => emails.add(email));
  acuityRequests += part.acuityRequests;
  console.log(`  ${part.windowAppointments} appointments, ${part.emails.length} emails (${seconds(part.durationMs)})`);
}
console.log(`  ${emails.size} emails to look up`);

// 3. Certificates, a batch of emails at a time.
const allEmails = [...emails].sort();
const certificates = new Map();
for (let i = 0; i < allEmails.length; i += plan.emailsPerStep) {
  const batch = allEmails.slice(i, i + plan.emailsPerStep);
  const part = await callStep(`certificates ${i + 1}–${i + batch.length} of ${allEmails.length}`, {
    step: "certificates",
    emails: batch,
  });
  // A certificate found through emails in two batches keeps both emails
  // (the bundle's customer is the one email that found it).
  part.certificates.forEach((cert) => {
    const found = [...(certificates.get(cert.id)?.foundByEmails ?? []), ...(cert.foundByEmails ?? [])];
    certificates.set(cert.id, { ...cert, foundByEmails: [...new Set(found)].sort() });
  });
  acuityRequests += part.acuityRequests;
  console.log(`  ${part.certificates.length} certificates (${seconds(part.durationMs)})`);
}
console.log(`  ${certificates.size} certificates in all`);

// 4. What ties appointments to a bundle.
const match = await callStep("match", { step: "match", certificates: [...certificates.values()] });
console.log(`  ${match.codes.length} bundle codes, ${match.emails.length} bundle emails`);

// 5. The appointments a bundle can use.
const appointments = [];
const incompleteDates = [];
let windowAppointments = 0;
for (const [minDate, maxDate] of plan.appointmentRanges) {
  const part = await callStep(`appointments ${minDate} to ${maxDate}`, {
    step: "appointments",
    minDate,
    maxDate,
    match,
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

// 6. Save.
const saved = await callStep("save", {
  step: "save",
  certificates: [...certificates.values()],
  appointments,
  incompleteDates,
  diagnostics: { windowAppointments, acuityRequests, durationMs: Date.now() - started },
});
console.log(
  `Saved ${saved.rows} bundles (${saved.totals.activeBundles} active) in ${seconds(Date.now() - started)}; ` +
    `${acuityRequests} Acuity requests, ${incompleteDates.length} incomplete dates`
);
