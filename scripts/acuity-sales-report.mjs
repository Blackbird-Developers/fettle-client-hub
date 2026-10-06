#!/usr/bin/env node
// ============================================================
// Acuity sales report — "Let's Talk - Finding your Path" with Alex Hamm.
//
// Art, 6 Oct 2026: appointments booked in with Alex for the day, filtered to the
// ones carrying the "Booked in" label, to count sales made via Acuity. Sessions
// booked from inbound calls are marked with a second label by whoever books them.
//
// Usage (from the repo root):
//   node scripts/acuity-sales-report.mjs                 today
//   node scripts/acuity-sales-report.mjs --days 7        last 7 days
//   node scripts/acuity-sales-report.mjs --from 2026-09-01 --to 2026-09-30
//   node scripts/acuity-sales-report.mjs --csv           machine-readable
//
// Credentials come from .env.local (gitignored). ⚠️ NOT .env — that file IS
// tracked in this repo, so a secret put there would be pushed to GitHub.
// ============================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------- constants
//
// ⚠️ READ BACK FROM THE LIVE ACCOUNT, NEVER TYPED FROM MEMORY. The session is
// called "Let's Talk - Finding your Path" — it does NOT contain "with Alex
// Hamm", which is how it was described. "With Alex" is the CALENDAR, not the
// name, and there is a separate "(Courtney)" variant of the same session, so
// filtering on type alone mixes two therapists' bookings.
const APPOINTMENT_TYPE_ID = 84348293; // Let's Talk - Finding your Path
const ALEX_CALENDAR_ID = 12862331; // Alex Hamm — alex@fettle.ie

// ⚠️ MATCHED BY ID, NOT BY NAME, AND THAT IS DELIBERATE. The label is literally
// "Booked in " WITH A TRAILING SPACE (as is "Quoted "), so a name comparison
// against "Booked in" matches nothing and the report silently reads zero sales.
// The id is stable and survives a rename. 190 uses account-wide over 90 days.
const BOOKED_IN_LABEL_ID = 23047490;

// The inbound-call marker, matched by NAME because it does not exist yet — Alex
// creates it in Acuity and starts using it, and this picks it up the moment he
// does, with no code change. Trimmed and lowercased, because every other label
// in this account has stray whitespace.
const INBOUND_LABEL_NAMES = ["phone", "inbound", "inbound call", "call"];

const API = "https://acuityscheduling.com/api/v1";

// ---------------------------------------------------------------- credentials
function credentials() {
  let env = "";
  try {
    env = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    bail(
      "No .env.local found.\n" +
        "  Add ACUITY_USER_ID and ACUITY_API_KEY to it (Acuity -> Integrations -> API).\n" +
        "  Do NOT put them in .env — that file is tracked in git.",
    );
  }
  const read = (k) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "").trim();
  const id = read("ACUITY_USER_ID");
  const key = read("ACUITY_API_KEY");
  if (!id || !key) bail("ACUITY_USER_ID / ACUITY_API_KEY are missing from .env.local.");
  return "Basic " + Buffer.from(`${id}:${key}`).toString("base64");
}

function bail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- dates
const iso = (d) => d.toISOString().slice(0, 10);

function window(argv) {
  const arg = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : null;
  };
  const from = arg("from");
  const to = arg("to");
  if (from) return { from, to: to ?? from };
  const days = Number(arg("days") ?? 0);
  const today = new Date();
  if (days > 0) {
    const start = new Date(today.getTime() - (days - 1) * 86400000);
    return { from: iso(start), to: iso(today) };
  }
  return { from: iso(today), to: iso(today) };
}

// ---------------------------------------------------------------- api
async function get(auth, path) {
  const resp = await fetch(`${API}${path}`, { headers: { Authorization: auth } });
  const text = await resp.text();
  if (resp.status === 401) bail("Acuity rejected the credentials (401). Check .env.local.");
  if (resp.status >= 400) throw new Error(`Acuity ${resp.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Acuity returned non-JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * ⚠️ `scheduledBy` IS NOT ON THE LIST RESPONSE. It only appears when an
 * appointment is fetched on its own, so identifying who booked something costs
 * one extra call each. Measured on this account: of 29 of Alex's sessions over
 * 45 days, 11 carried `art@blackbird.marketing` and 18 were empty —
 * `alex@fettle.ie` NEVER appears, because that is his calendar address and not
 * an Acuity login. Which is exactly why the inbound marker is a label.
 */
async function withScheduledBy(auth, appointments) {
  const out = [];
  for (const a of appointments) {
    let scheduledBy = "";
    try {
      const full = await get(auth, `/appointments/${a.id}`);
      scheduledBy = (full?.scheduledBy ?? "").trim();
    } catch {
      // A failed enrichment must not lose the sale from the report — the row is
      // still a sale, we just cannot say who booked it.
      scheduledBy = "(lookup failed)";
    }
    out.push({ ...a, scheduledBy });
    await new Promise((r) => setTimeout(r, 120)); // gentle on the API
  }
  return out;
}

// ---------------------------------------------------------------- main
const argv = process.argv.slice(2);
const asCsv = argv.includes("--csv");
const { from, to } = window(argv);
const auth = credentials();

// Confirm WHICH account before reporting anything. There is an Acuity key for a
// different client on this machine, and a report built from the wrong account
// would look perfectly plausible.
const me = await get(auth, "/me");
if (!String(me.schedulingPage ?? "").includes("fettle")) {
  bail(
    `These credentials are not Fettle's.\n` +
      `  account: ${me.email} / ${me.schedulingPage}\n` +
      `  Refusing to report, rather than produce a believable report from the wrong client.`,
  );
}

const list = await get(
  auth,
  `/appointments?appointmentTypeID=${APPOINTMENT_TYPE_ID}` +
    `&calendarID=${ALEX_CALENDAR_ID}&minDate=${from}&maxDate=${to}&max=1000`,
);

const labelIds = (a) => (a.labels ?? []).map((l) => l.id);

// WARNING: `date` IS A DISPLAY STRING, NOT A DATE. Acuity formats it per the
// account's own dateFormat - this account returns "October 5, 2026" - so it
// cannot be sorted, compared or padded into a column. `datetime` is the ISO one.
const isoDay = (a) => String(a.datetime ?? "").slice(0, 10) || String(a.date ?? "");
const hhmm = (a) => {
  const t = String(a.datetime ?? "");
  return t.length >= 16 ? t.slice(11, 16) : String(a.time ?? "");
};
const labelNames = (a) => (a.labels ?? []).map((l) => String(l.name).trim());

// A cancelled appointment is not a sale, whatever it is labelled.
const live = list.filter((a) => !a.canceled);
const sales = live.filter((a) => labelIds(a).includes(BOOKED_IN_LABEL_ID));
const enriched = await withScheduledBy(auth, sales);

const isInbound = (a) =>
  labelNames(a).some((n) => INBOUND_LABEL_NAMES.includes(n.toLowerCase()));

if (asCsv) {
  console.log("date,time,name,email,inbound,scheduled_by,labels");
  for (const a of enriched) {
    const cells = [
      isoDay(a),
      hhmm(a),
      `${a.firstName} ${a.lastName}`,
      a.email,
      isInbound(a) ? "yes" : "no",
      a.scheduledBy || "",
      labelNames(a).join(" | "),
    ];
    console.log(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
  }
  process.exit(0);
}

const inbound = enriched.filter(isInbound);
const adminBooked = enriched.filter((a) => a.scheduledBy && a.scheduledBy !== "(lookup failed)");

console.log(`\nLet's Talk - Finding your Path — Alex Hamm`);
console.log(`${from === to ? from : `${from} to ${to}`}   (account: ${me.schedulingPage})\n`);
console.log(`  appointments on the calendar   ${list.length}${list.length - live.length ? `  (${list.length - live.length} cancelled)` : ""}`);
console.log(`  SALES — labelled "Booked in"   ${sales.length}`);
console.log(`     of which marked inbound     ${inbound.length}`);
console.log(`     booked by a signed-in user  ${adminBooked.length}`);
console.log(`     client self-booked          ${enriched.length - adminBooked.length}`);

if (enriched.length) {
  console.log(`\n  ${"date".padEnd(12)}${"time".padEnd(7)}${"inbound".padEnd(9)}labels`);
  for (const a of [...enriched].sort((x, y) => isoDay(x).localeCompare(isoDay(y)))) {
    console.log(
      `  ${isoDay(a).padEnd(12)}${hhmm(a).padEnd(7)}` +
        `${(isInbound(a) ? "yes" : "-").padEnd(9)}${labelNames(a).join(" | ")}`,
    );
  }
}

// Say what is NOT counted, every time. A sales figure that quietly omits a
// channel is worse than one that names the gap.
if (!inbound.length) {
  console.log(
    `\n  Note: no appointment in this range carries an inbound label` +
      ` (${INBOUND_LABEL_NAMES.join(" / ")}).` +
      `\n  Inbound-call bookings are only separable once whoever books them adds that` +
      `\n  label in Acuity — scheduledBy cannot identify Alex (see the note in this file).`,
  );
}
console.log();
