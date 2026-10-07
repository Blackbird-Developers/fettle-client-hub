// Pure logic for the admin-customer-insights edge function: appointment-type
// classification, customer matching/deduplication, the admin views and
// their A–E scores. No Deno or network imports, so the same file runs inside
// the edge function and under Vitest (logic.test.ts).

export interface AcuityAppointment {
  id: number;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  datetime: string;
  type?: string | null;
  appointmentTypeID?: number | null;
  calendar?: string | null;
  canceled?: boolean | null;
}

export const DAY_MS = 86_400_000;

/** "Recently active" = a completed session within this many days. */
export const ACTIVE_WINDOW_DAYS = 30;

/** Periods offered by the progression view's filter. */
export const PROGRESSION_PERIODS = [7, 14, 30] as const;

// ---------------------------------------------------------------------------
// Appointment types
// ---------------------------------------------------------------------------

// Classified by type NAME rather than ID: historical appointments can use
// types that were since archived, and Fettle names types consistently.
// Per Fettle, therapy, intro calls, assessments and psychiatry all count as
// sessions in both views; the kind is kept so the UI can show it.
//   therapy    — therapy sessions (individual, couples, youth, teen,
//                discovery, insurance, business 1:1, Alone clients)
//   intro      — paid introductory calls (a half session with a therapist)
//   assessment — assessments, screenings and psychiatry
//   excluded   — matching, internal calls, demos, Pilates, coaching, test
//                types, and the free 20-minute consultations ("Fettle
//                Introduction Chat", "Let's Talk"), which Fettle will
//                revisit in stage 2 of the portal; never counted
//   unknown    — anything unrecognised; ignored and surfaced as a data issue
export type SessionKind = "therapy" | "intro" | "assessment" | "excluded" | "unknown";

const EXCLUDED_TYPE_PATTERNS = [
  /introduction chat/i,
  /let.?s talk/i,
  /matching service/i,
  /internal call/i,
  /\bdemo\b/i,
  /fettle for business introduction/i,
  /pilates/i,
  /coaching/i,
  /weight loss/i,
  /\(testing\)/i,
];

const INTRO_TYPE_PATTERNS = [/introductory call/i];

const ASSESSMENT_TYPE_PATTERNS = [
  /assessment/i,
  /screening/i,
  /psychiatr/i,
  /follow up consultation/i,
  /medication appointment/i,
  /recovery.*programme/i,
];

const THERAPY_TYPE_PATTERNS = [/therapy/i, /counselling/i, /\bsession\b/i];

export function classifyAppointmentType(type: string | null | undefined): SessionKind {
  const name = (type ?? "").trim();
  if (!name) return "unknown";
  if (EXCLUDED_TYPE_PATTERNS.some((p) => p.test(name))) return "excluded";
  if (INTRO_TYPE_PATTERNS.some((p) => p.test(name))) return "intro";
  if (ASSESSMENT_TYPE_PATTERNS.some((p) => p.test(name))) return "assessment";
  if (THERAPY_TYPE_PATTERNS.some((p) => p.test(name))) return "therapy";
  return "unknown";
}

/** Counts as a session in both views. */
export function isSession(appt: AcuityAppointment): boolean {
  const kind = classifyAppointmentType(appt.type);
  return kind === "therapy" || kind === "intro" || kind === "assessment";
}

/** Type names that couldn't be classified, with how often they occurred. */
export function summarizeUnknownTypes(
  appointments: AcuityAppointment[]
): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const appt of appointments) {
    if (classifyAppointmentType(appt.type) !== "unknown") continue;
    const name = (appt.type ?? "").trim() || "(no type)";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export function appointmentTime(appt: AcuityAppointment): number {
  return Date.parse(appt.datetime);
}

/** Completed = not cancelled and the appointment time is in the past. */
export function isCompleted(appt: AcuityAppointment, now: number): boolean {
  return !appt.canceled && appointmentTime(appt) < now;
}

export function isUpcoming(appt: AcuityAppointment, now: number): boolean {
  return !appt.canceled && appointmentTime(appt) >= now;
}

/** Whole days elapsed from `from` until `now`. */
export function daysSince(from: number, now: number): number {
  return Math.floor((now - from) / DAY_MS);
}

/** YYYY-MM-DD (UTC) for a timestamp — the date format Acuity filters take. */
export function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return toDateString(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
}

// ---------------------------------------------------------------------------
// Customer identity, deduplication and portal matching
// ---------------------------------------------------------------------------

/** Trimmed, lower-cased email, or null when blank or not email-shaped. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = (raw ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : null;
}

// Digits-only phone used ONLY as a fallback dedupe key for appointments that
// have no email. Irish national numbers (leading 0) are rewritten to 353… so
// "087 123 4567" and "+353 87 123 4567" collapse together.
export function phoneKey(raw: string | null | undefined): string | null {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `353${digits.slice(1)}`;
  return digits.length >= 7 ? digits : null;
}

export function customerKey(appt: AcuityAppointment): string {
  const email = normalizeEmail(appt.email);
  if (email) return `email:${email}`;
  const phone = phoneKey(appt.phone);
  if (phone) return `phone:${phone}`;
  return `appointment:${appt.id}`;
}

export interface Customer {
  key: string;
  /** Normalised email, or null when no appointment carried a usable one. */
  email: string | null;
  name: string | null;
  phone: string | null;
  /** Non-cancelled appointments, oldest first. */
  appointments: AcuityAppointment[];
}

// Groups non-cancelled appointments into customers. Appointments are
// deduplicated by Acuity id; name and phone come from the most recent
// appointment that has them.
export function groupCustomers(appointments: AcuityAppointment[]): Customer[] {
  const seen = new Set<number>();
  const valid = appointments
    .filter((appt) => {
      if (appt.canceled || Number.isNaN(appointmentTime(appt)) || seen.has(appt.id)) {
        return false;
      }
      seen.add(appt.id);
      return true;
    })
    .sort((a, b) => appointmentTime(a) - appointmentTime(b));

  const byKey = new Map<string, Customer>();
  for (const appt of valid) {
    const key = customerKey(appt);
    let customer = byKey.get(key);
    if (!customer) {
      customer = {
        key,
        email: normalizeEmail(appt.email),
        name: null,
        phone: null,
        appointments: [],
      };
      byKey.set(key, customer);
    }
    customer.appointments.push(appt);

    // Later appointments overwrite, so the most recent details win.
    const name = [appt.firstName, appt.lastName]
      .map((part) => (part ?? "").trim())
      .filter(Boolean)
      .join(" ");
    if (name) customer.name = name;
    const phone = (appt.phone ?? "").trim();
    if (phone) customer.phone = phone;
  }
  return [...byKey.values()];
}

export type PortalStatus = "has_account" | "no_account" | "no_email";

export function buildPortalEmailSet(emails: (string | null | undefined)[]): Set<string> {
  const set = new Set<string>();
  for (const email of emails) {
    const normalized = normalizeEmail(email);
    if (normalized) set.add(normalized);
  }
  return set;
}

// The single place portal matching happens. Email is the only automatic
// match key — names are never used. Stronger rules (e.g. verified phone)
// can be added here without touching the views.
export function matchPortalAccount(
  customer: Pick<Customer, "email">,
  portalEmails: Set<string>
): PortalStatus {
  if (!customer.email) return "no_email";
  return portalEmails.has(customer.email) ? "has_account" : "no_account";
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type Grade = "A" | "B" | "C" | "D" | "E";

export interface GradeDefinition {
  grade: Grade;
  label: string;
}

export const GRADE_ORDER: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

export const ADOPTION_LEGEND: GradeDefinition[] = [
  { grade: "A", label: "Last session 0–14 days ago, nothing booked" },
  { grade: "B", label: "Last session 15–30 days ago, nothing booked" },
  { grade: "C", label: "Last session 0–14 days ago, next session booked" },
  { grade: "D", label: "Last session 15–30 days ago, next session booked" },
  { grade: "E", label: "No email on record — can't be matched or invited" },
];

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** "first", "second", … for session numbers; "#N" beyond the list. */
export function sessionOrdinal(n: number): string {
  return ORDINALS[n - 1] ?? `#${n}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Legend for the "session N → N+1" view, e.g. for N = 1: "First session
// 14+ days ago, no second session".
export function progressionLegend(fromSession: number): GradeDefinition[] {
  const from = capitalize(sessionOrdinal(fromSession));
  const next = sessionOrdinal(fromSession + 1);
  return [
    { grade: "A", label: `${from} session 14+ days ago, no ${next} session` },
    { grade: "B", label: `${from} session 7–13 days ago, no ${next} session` },
    { grade: "C", label: `${from} session under 7 days ago, no ${next} session` },
    { grade: "D", label: `${capitalize(next)} session booked, not yet happened` },
    { grade: "E", label: `${capitalize(next)} session already completed` },
  ];
}

function legendLabel(legend: GradeDefinition[], grade: Grade): string {
  return legend.find((d) => d.grade === grade)!.label;
}

export function scoreAdoption(input: {
  portalStatus: PortalStatus;
  daysSinceLastSession: number;
  hasUpcomingSession: boolean;
}): Grade {
  if (input.portalStatus === "no_email") return "E";
  const recent = input.daysSinceLastSession <= 14;
  if (!input.hasUpcomingSession) return recent ? "A" : "B";
  return recent ? "C" : "D";
}

export type NextSessionStatus = "completed" | "booked" | "none";

export function scoreProgression(input: {
  nextSessionStatus: NextSessionStatus;
  daysSinceFromSession: number;
}): Grade {
  if (input.nextSessionStatus === "completed") return "E";
  if (input.nextSessionStatus === "booked") return "D";
  if (input.daysSinceFromSession >= 14) return "A";
  if (input.daysSinceFromSession >= 7) return "B";
  return "C";
}

// ---------------------------------------------------------------------------
// View 1: recently active customers without a portal account
// ---------------------------------------------------------------------------

export interface AdoptionRow {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  lastSessionAt: string;
  daysSinceLastSession: number;
  nextSessionAt: string | null;
  portalStatus: PortalStatus;
  grade: Grade;
  gradeReason: string;
}

export interface AdoptionView {
  rows: AdoptionRow[];
  totals: {
    activeCustomers: number;
    withAccount: number;
    withoutAccount: number;
    noEmail: number;
    noPhone: number;
  };
}

export function buildAdoptionView(
  customers: Customer[],
  portalEmails: Set<string>,
  now: number
): AdoptionView {
  const windowStart = now - ACTIVE_WINDOW_DAYS * DAY_MS;
  const rows: AdoptionRow[] = [];
  const totals = { activeCustomers: 0, withAccount: 0, withoutAccount: 0, noEmail: 0, noPhone: 0 };

  for (const customer of customers) {
    const sessions = customer.appointments.filter(isSession);
    const recent = sessions.filter(
      (appt) => isCompleted(appt, now) && appointmentTime(appt) >= windowStart
    );
    if (recent.length === 0) continue;

    totals.activeCustomers++;
    if (!customer.phone) totals.noPhone++;
    const portalStatus = matchPortalAccount(customer, portalEmails);
    if (portalStatus === "has_account") {
      totals.withAccount++;
      continue;
    }
    if (portalStatus === "no_account") totals.withoutAccount++;
    else totals.noEmail++;

    const last = recent[recent.length - 1];
    const next = sessions.find((appt) => isUpcoming(appt, now)) ?? null;
    const daysSinceLastSession = daysSince(appointmentTime(last), now);
    const grade = scoreAdoption({
      portalStatus,
      daysSinceLastSession,
      hasUpcomingSession: next !== null,
    });

    rows.push({
      key: customer.key,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      lastSessionAt: last.datetime,
      daysSinceLastSession,
      nextSessionAt: next?.datetime ?? null,
      portalStatus,
      grade,
      gradeReason: legendLabel(ADOPTION_LEGEND, grade),
    });
  }

  rows.sort(
    (a, b) =>
      GRADE_ORDER[a.grade] - GRADE_ORDER[b.grade] ||
      a.daysSinceLastSession - b.daysSinceLastSession
  );
  return { rows, totals };
}

// ---------------------------------------------------------------------------
// View 2: session-to-session progression (session N → N+1)
// ---------------------------------------------------------------------------

/** The "from" session of each progression view: 1 = Session 1–2, … 4 = Session 4–5. */
export const PROGRESSION_RANGES = [1, 2, 3, 4] as const;

export interface ProgressionCandidate {
  customer: Customer;
  /** Earliest completed session inside the active window. */
  firstInWindow: AcuityAppointment;
  firstInWindowAt: number;
}

// Everyone with a completed session in the last 30 days. Which session NUMBER
// that was needs their earlier history (evaluateHistory).
export function progressionCandidates(
  customers: Customer[],
  now: number
): ProgressionCandidate[] {
  const windowStart = now - ACTIVE_WINDOW_DAYS * DAY_MS;
  const candidates: ProgressionCandidate[] = [];
  for (const customer of customers) {
    const first = customer.appointments.find(
      (appt) =>
        isSession(appt) &&
        isCompleted(appt, now) &&
        appointmentTime(appt) >= windowStart
    );
    if (first) {
      candidates.push({ customer, firstInWindow: first, firstInWindowAt: appointmentTime(first) });
    }
  }
  return candidates;
}

// `earlierSessions` = sessions before the first one in the window. Exact when
// verified; when unverified it's only what we could see (a lower bound), and
// rows are numbered from it but flagged and left out of the rates.
export type HistoryCheck =
  | { status: "verified"; earlierSessions: number }
  | {
      status: "unverified";
      reason: "no_email" | "history_truncated" | "lookup_failed";
      earlierSessions: number;
    };

/** One Acuity history query by the customer's email. */
export interface HistoryLookup {
  appointments: AcuityAppointment[] | null; // null when the request failed
  limit: number;
}

// Counts the customer's sessions before `firstInWindowAt`. `lookup` is null
// when there's no email to search by. Acuity's email search ignores case, so
// one lookup per customer covers every spelling. The count is only exact
// when the lookup didn't hit its result limit (a full page may hide older
// history).
export function evaluateHistory(
  lookup: HistoryLookup | null,
  firstInWindowAt: number
): HistoryCheck {
  if (!lookup) return { status: "unverified", reason: "no_email", earlierSessions: 0 };
  if (lookup.appointments === null) {
    return { status: "unverified", reason: "lookup_failed", earlierSessions: 0 };
  }

  const seen = new Set<number>();
  let earlierSessions = 0;
  for (const appt of lookup.appointments) {
    if (seen.has(appt.id)) continue;
    seen.add(appt.id);
    if (!appt.canceled && isSession(appt) && appointmentTime(appt) < firstInWindowAt) {
      earlierSessions++;
    }
  }
  if (lookup.appointments.length >= lookup.limit) {
    return { status: "unverified", reason: "history_truncated", earlierSessions };
  }
  return { status: "verified", earlierSessions };
}

export const UNVERIFIED_REASON_LABELS: Record<
  Extract<HistoryCheck, { status: "unverified" }>["reason"],
  string
> = {
  no_email: "No email on record — earlier history can't be looked up",
  history_truncated: "Too much history to confirm the session number",
  lookup_failed: "Acuity history lookup failed",
};

export interface ProgressionRow {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** The view's "from" session (session N). */
  fromSessionAt: string;
  /** Acuity appointment type name, e.g. "Introductory Call with …". */
  fromSessionType: string | null;
  daysSinceFromSession: number;
  /** Session N+1. */
  nextSessionStatus: NextSessionStatus;
  nextSessionAt: string | null;
  nextSessionType: string | null;
  portalStatus: PortalStatus;
  /** "verified" = session number confirmed from full history. */
  historyStatus: "verified" | "unverified";
  historyNote: string | null;
  /** Null when the session number couldn't be verified. */
  grade: Grade | null;
  gradeReason: string | null;
}

export interface ProgressionView {
  /** Session N of "session N → N+1". */
  fromSession: number;
  rows: ProgressionRow[];
  totals: {
    verified: number;
    unverified: number;
  };
}

// Customers whose session `fromSession` was completed in the active window,
// and whether session `fromSession + 1` is completed, booked or not booked.
// Session numbers count every non-cancelled session ever (earlier history +
// the window), oldest first.
export function buildProgressionView(
  candidates: ProgressionCandidate[],
  history: Map<string, HistoryCheck>,
  portalEmails: Set<string>,
  now: number,
  fromSession: number
): ProgressionView {
  const legend = progressionLegend(fromSession);
  const rows: ProgressionRow[] = [];
  const totals = { verified: 0, unverified: 0 };

  for (const { customer, firstInWindowAt } of candidates) {
    const check: HistoryCheck = history.get(customer.key) ?? {
      status: "unverified",
      reason: "lookup_failed",
      earlierSessions: 0,
    };

    // Sessions from the first in-window one onwards; index i is session
    // number earlierSessions + 1 + i.
    const sessions = customer.appointments.filter(
      (appt) => isSession(appt) && !appt.canceled && appointmentTime(appt) >= firstInWindowAt
    );
    const index = fromSession - check.earlierSessions - 1;
    const from = index >= 0 ? sessions[index] : undefined;
    // Session N was before the window, or hasn't happened yet.
    if (!from || !isCompleted(from, now)) continue;

    if (check.status === "verified") totals.verified++;
    else totals.unverified++;

    const next = sessions[index + 1] ?? null;
    const nextSessionStatus: NextSessionStatus = !next
      ? "none"
      : isCompleted(next, now)
        ? "completed"
        : "booked";

    const daysSinceFromSession = daysSince(appointmentTime(from), now);
    const grade =
      check.status === "verified"
        ? scoreProgression({ nextSessionStatus, daysSinceFromSession })
        : null;

    rows.push({
      key: customer.key,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      fromSessionAt: from.datetime,
      fromSessionType: from.type?.trim() || null,
      daysSinceFromSession,
      nextSessionStatus,
      nextSessionAt: next?.datetime ?? null,
      nextSessionType: next?.type?.trim() || null,
      portalStatus: matchPortalAccount(customer, portalEmails),
      historyStatus: check.status,
      historyNote: check.status === "unverified" ? UNVERIFIED_REASON_LABELS[check.reason] : null,
      grade,
      gradeReason: grade ? legendLabel(legend, grade) : null,
    });
  }

  // Graded rows first (A→E, longest-waiting first), unverified rows last.
  rows.sort((a, b) => {
    const ga = a.grade ? GRADE_ORDER[a.grade] : 99;
    const gb = b.grade ? GRADE_ORDER[b.grade] : 99;
    return ga - gb || b.daysSinceFromSession - a.daysSinceFromSession;
  });
  return { fromSession, rows, totals };
}

// ---------------------------------------------------------------------------
// Fetching helpers (network is injected, so these stay testable)
// ---------------------------------------------------------------------------

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export type RangeFetcher = (minDate: string, maxDate: string) => Promise<AcuityAppointment[]>;

// Acuity's /appointments has no pagination — only a `max` cap — so a response
// of exactly `limit` rows may have been cut off. Fetch in date chunks and
// split any full chunk in half until it fits. A single day that is still full
// can't be split further: its date is reported in `incompleteDates`.
export async function fetchAppointmentsInWindows(
  fetchRange: RangeFetcher,
  minDate: string,
  maxDate: string,
  options: { limit: number; chunkDays: number; concurrency: number }
): Promise<{ appointments: AcuityAppointment[]; incompleteDates: string[] }> {
  const incompleteDates: string[] = [];

  async function fetchRangeFully(from: string, to: string): Promise<AcuityAppointment[]> {
    const page = await fetchRange(from, to);
    if (page.length < options.limit) return page;
    if (from === to) {
      incompleteDates.push(from);
      return page;
    }
    const spanDays = Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS
    );
    const mid = addDays(from, Math.floor(spanDays / 2));
    const [left, right] = await Promise.all([
      fetchRangeFully(from, mid),
      fetchRangeFully(addDays(mid, 1), to),
    ]);
    return [...left, ...right];
  }

  const chunks: [string, string][] = [];
  for (let start = minDate; start <= maxDate; start = addDays(start, options.chunkDays)) {
    const end = addDays(start, options.chunkDays - 1);
    chunks.push([start, end < maxDate ? end : maxDate]);
  }

  const pages = await mapWithConcurrency(chunks, options.concurrency, ([from, to]) =>
    fetchRangeFully(from, to)
  );

  const byId = new Map<number, AcuityAppointment>();
  for (const appt of pages.flat()) byId.set(appt.id, appt);
  return { appointments: [...byId.values()], incompleteDates: incompleteDates.sort() };
}
