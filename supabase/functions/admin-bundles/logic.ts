// Pure logic for the admin-bundles edge function: turns Acuity certificates
// (session bundles) and appointments into the Bundles dashboard rows, with a
// segment per bundle. No Deno or network imports, so the same file runs in
// the edge function and under Vitest (logic.test.ts).
//
// In Acuity a bundle is a certificate: a code with credits left
// (remainingCounts, or remainingMinutes for minute-based ones). Acuity only
// says what's LEFT, so the total comes from the product mapping below; an
// unknown product has no total, and shows remaining credits only.
// Discount coupons and money-value gift certificates are left out.

import {
  type AcuityAppointment,
  type PortalStatus,
  DAY_MS,
  addDays,
  appointmentTime,
  daysSince,
  isCompleted,
  isSession,
  isUpcoming,
  matchPortalAccount,
  normalizeEmail,
} from "../admin-customer-insights/logic.ts";

export type BundleCategory = "individual" | "youth" | "couples";

/** Session bundles sold by Fettle (Acuity product id → bundle). */
export const BUNDLE_PRODUCTS: Record<string, { name: string; sessions: number; category: BundleCategory }> = {
  "1122832": { name: "3 Session Bundle", sessions: 3, category: "individual" },
  "996385": { name: "6 Session Bundle", sessions: 6, category: "individual" },
  "1197875": { name: "9 Session Bundle", sessions: 9, category: "individual" },
  "1370588": { name: "Youth Bundle 3 x 60min", sessions: 3, category: "youth" },
  "1975510": { name: "Youth Bundle 5 x 60min", sessions: 5, category: "youth" },
  "2000708": { name: "Couples 3 x 60 min", sessions: 3, category: "couples" },
  "1967869": { name: "Couples 5 x 60 min", sessions: 5, category: "couples" },
};

/** Minutes per session, for minute-based certificates (as redeem-package-code). */
const SESSION_MINUTES: Record<BundleCategory, number> = { individual: 50, youth: 60, couples: 60 };

/** Thresholds for the segments (Assumptions in the plan; Fettle can change them). */
export const EXPIRING_WITHIN_DAYS = 30;
export const NOT_STARTED_AFTER_DAYS = 14;
export const STALLED_AFTER_DAYS = 30;
/** Used-up bundles are listed when their last session was this recent (renewal window). */
export const USED_UP_RECENT_DAYS = 90;
/** Expired bundles with credits are listed for this long after expiry. */
export const EXPIRED_RECENT_DAYS = 180;

export interface AcuityCertificate {
  id: number;
  certificate: string;
  productID?: number | null;
  /** The product's title (e.g. "Bundle 6 x 50min Individual Therapy Sessions"), not the buyer. */
  name?: string | null;
  /** Often blank in Acuity, even on a certificate its email search returns. */
  email?: string | null;
  /**
   * Not from Acuity: the (normalised) emails whose /certificates?email=
   * search returned this certificate, added by the certificates step so a
   * bundle with a blank email can still be tied to its customer.
   */
  foundByEmails?: string[] | null;
  type?: string | null;
  remainingCounts?: number | Record<string, number> | null;
  remainingMinutes?: number | null;
  remainingValue?: number | null;
  createdDate?: string | null;
  expiration?: string | null;
}

export type BundleSegment =
  | "expiring"
  | "not_started"
  | "stalled"
  | "nearly_done"
  | "on_track"
  | "used_up"
  | "expired";

/** Tab order on the page: what needs a call first. */
export const SEGMENT_ORDER: BundleSegment[] = [
  "expiring",
  "not_started",
  "stalled",
  "nearly_done",
  "on_track",
  "used_up",
  "expired",
];

export const SEGMENT_LABELS: Record<BundleSegment, { label: string; rule: string; action: string }> = {
  expiring: {
    label: "Expiring soon",
    rule: `Credits left and the bundle expires within ${EXPIRING_WITHIN_DAYS} days`,
    action: "Call to book before credits are lost",
  },
  not_started: {
    label: "Not started",
    rule: `No sessions used, bought ${NOT_STARTED_AFTER_DAYS} or more days ago`,
    action: "Help them book a first session or match a therapist",
  },
  stalled: {
    label: "Stalled",
    rule: `Credits left, no session in ${STALLED_AFTER_DAYS}+ days and nothing booked`,
    action: "Re-engagement call or email",
  },
  nearly_done: {
    label: "Nearly done",
    rule: "1 credit left",
    action: "Offer to renew",
  },
  on_track: {
    label: "On track",
    rule: `A session in the last ${STALLED_AFTER_DAYS} days, or one booked`,
    action: "No action",
  },
  used_up: {
    label: "Used up",
    rule: `No credits left, last session within ${USED_UP_RECENT_DAYS} days`,
    action: "Renewal opportunity",
  },
  expired: {
    label: "Expired with credits",
    rule: `Past expiry with credits unused (last ${EXPIRED_RECENT_DAYS} days)`,
    action: "Fettle decides: extend or write off",
  },
};

/** Session bundles only: counts or minutes. Coupons and money values are dropped. */
export function isSessionBundle(cert: AcuityCertificate): boolean {
  const type = String(cert.type ?? "").toLowerCase();
  if (type === "minutes") return true;
  if (type === "counts" || type === "appointments") return true;
  // Older certificates may have no type; a known bundle product still counts.
  return !type && Boolean(cert.productID && BUNDLE_PRODUCTS[String(cert.productID)]);
}

/** Credits left, in sessions. */
export function remainingCredits(cert: AcuityCertificate): number {
  const type = String(cert.type ?? "").toLowerCase();
  const product = cert.productID ? BUNDLE_PRODUCTS[String(cert.productID)] : undefined;
  if (type === "minutes") {
    const minutes = Number(cert.remainingMinutes ?? 0);
    const perSession = SESSION_MINUTES[product?.category ?? "individual"];
    return Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes / perSession)) : 0;
  }
  const rc = cert.remainingCounts;
  if (typeof rc === "number") return Math.max(0, rc);
  if (rc && typeof rc === "object") {
    const values = Object.values(rc).map(Number).filter((n) => Number.isFinite(n));
    return values.length > 0 ? Math.max(0, ...values) : 0;
  }
  return 0;
}

const codeKey = (code: string | null | undefined) => (code ?? "").trim().toUpperCase();

/** Marks a certificate with the email whose search returned it. */
export function withFoundByEmail(cert: AcuityCertificate, email: string): AcuityCertificate {
  const normalized = normalizeEmail(email);
  const found = new Set(cert.foundByEmails ?? []);
  if (normalized) found.add(normalized);
  return { ...cert, foundByEmails: [...found].sort() };
}

// The bundle's customer email: its own, or — when Acuity left it blank — the
// email whose search found it. Only when exactly one customer's email found
// it (spellings of one address count once), so a bundle is never given to
// the wrong person.
export function bundleEmail(cert: AcuityCertificate): string | null {
  const own = normalizeEmail(cert.email);
  if (own) return own;
  const found = new Set((cert.foundByEmails ?? []).map(normalizeEmail).filter(Boolean));
  return found.size === 1 ? [...found][0]! : null;
}

// ---------------------------------------------------------------------------
// Building in steps: the scheduled workflow fetches appointments a date range
// per call (one call for everything runs past the edge-function limit), and
// only keeps the ones buildBundlesView can use.
// ---------------------------------------------------------------------------

/** What ties an appointment to a bundle: its code, or the bundle's email. */
export interface BundleMatchKeys {
  codes: string[];
  emails: string[];
}

export function bundleMatchKeys(certificates: AcuityCertificate[]): BundleMatchKeys {
  const codes = new Set<string>();
  const emails = new Set<string>();
  for (const cert of certificates) {
    if (!isSessionBundle(cert)) continue;
    const code = codeKey(cert.certificate);
    if (code) codes.add(code);
    const email = bundleEmail(cert);
    if (email) emails.add(email);
  }
  return { codes: [...codes], emails: [...emails] };
}

// buildBundlesView only looks at sessions booked with a bundle's code, or —
// when there are none — the bundle email's own sessions; a bundle without an
// email takes it from a coded session, which is kept by code. So nothing else
// changes the result.
export function appointmentsForBundles(
  appointments: AcuityAppointment[],
  keys: BundleMatchKeys
): AcuityAppointment[] {
  const codes = new Set(keys.codes);
  const emails = new Set(keys.emails);
  return appointments.filter((appt) => {
    const code = codeKey(appt.certificate);
    if (code && codes.has(code)) return true;
    const email = normalizeEmail(appt.email);
    return email !== null && emails.has(email);
  });
}

// Acuity's full /certificates list times out for Fettle's account, so
// certificates are looked up per email (/certificates?email=). These are the
// emails to try from a set of appointments: each as written and in lower
// case, since it isn't known whether Acuity's email filter ignores case.
export function lookupEmails(appointments: AcuityAppointment[], extra: (string | null | undefined)[] = []): string[] {
  const emails = new Set<string>();
  for (const raw of [...appointments.map((appt) => appt.email), ...extra]) {
    const normalized = normalizeEmail(raw);
    if (!normalized) continue;
    emails.add((raw ?? "").trim());
    emails.add(normalized);
  }
  return [...emails].sort();
}

/** The same certificate found through two emails is listed once, with both emails. */
export function uniqueCertificates(certificates: AcuityCertificate[]): AcuityCertificate[] {
  const byId = new Map<number, AcuityCertificate>();
  for (const cert of certificates) {
    const earlier = byId.get(cert.id);
    const found = [...(earlier?.foundByEmails ?? []), ...(cert.foundByEmails ?? [])];
    byId.set(cert.id, found.length > 0 ? { ...cert, foundByEmails: [...new Set(found)].sort() } : cert);
  }
  return [...byId.values()];
}

/** Consecutive [from, to] date ranges of `days` days covering minDate–maxDate. */
export function dateRanges(minDate: string, maxDate: string, days: number): [string, string][] {
  const ranges: [string, string][] = [];
  for (let from = minDate; from <= maxDate; from = addDays(from, days)) {
    const to = addDays(from, days - 1);
    ranges.push([from, to < maxDate ? to : maxDate]);
  }
  return ranges;
}

export interface BundleRow {
  /** Certificate id, unique per row. */
  id: number;
  code: string;
  /** Customer key for the contact outcomes (same keys as the other admin pages). */
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  bundleName: string;
  /** False when the product isn't one of Fettle's known bundles. */
  knownProduct: boolean;
  totalCredits: number | null;
  usedCredits: number | null;
  remainingCredits: number;
  /** 0–100, or null without a total. */
  utilisation: number | null;
  purchasedAt: string | null;
  /** "acuity" = Acuity's created date; "first_session" = first session booked with the code. */
  purchasedSource: "acuity" | "first_session" | null;
  expiresAt: string | null;
  /** Negative once expired. */
  daysToExpiry: number | null;
  lastSessionAt: string | null;
  daysSinceLastSession: number | null;
  nextSessionAt: string | null;
  /** How sessions were tied to the bundle: by its code, or (fallback) by the customer's email. */
  sessionsMatchedBy: "code" | "email" | null;
  portalStatus: PortalStatus;
  /** Other bundles the same customer holds (for the "2 bundles" chip). */
  otherBundles: number;
  segment: BundleSegment;
}

export interface BundlesView {
  rows: BundleRow[];
  counts: Record<BundleSegment, number>;
  totals: {
    activeBundles: number;
    unusedCredits: number;
    expiringSoon: number;
    stalled: number;
    /** Mean utilisation of active bundles with a known total, 0–100, or null. */
    averageUtilisation: number | null;
  };
  /** Certificates left out, for the data-issues note. */
  skipped: { notSessionBundles: number; oldUsedUp: number; oldExpired: number; unknownProducts: number };
}

function customerKeyFor(email: string | null, cert: AcuityCertificate): string {
  return email ? `email:${email}` : `appointment:cert-${cert.id}`;
}

export function segmentFor(input: {
  remaining: number;
  used: number | null;
  daysToExpiry: number | null;
  daysSincePurchase: number | null;
  daysSinceLastSession: number | null;
  hasUpcoming: boolean;
}): BundleSegment {
  const { remaining, used, daysToExpiry, daysSincePurchase, daysSinceLastSession, hasUpcoming } = input;
  if (remaining <= 0) return "used_up";
  if (daysToExpiry !== null && daysToExpiry < 0) return "expired";
  if (daysToExpiry !== null && daysToExpiry <= EXPIRING_WITHIN_DAYS) return "expiring";
  const nothingUsed = used === 0 || (used === null && daysSinceLastSession === null);
  if (nothingUsed && !hasUpcoming && (daysSincePurchase === null || daysSincePurchase >= NOT_STARTED_AFTER_DAYS)) {
    return "not_started";
  }
  const recent = daysSinceLastSession !== null && daysSinceLastSession < STALLED_AFTER_DAYS;
  if (!recent && !hasUpcoming && !nothingUsed) return "stalled";
  if (remaining === 1) return "nearly_done";
  return "on_track";
}

export function buildBundlesView(
  certificates: AcuityCertificate[],
  appointments: AcuityAppointment[],
  portalEmails: Set<string>,
  now: number,
  /** Hub account names by normalised email, used when Acuity has no name. */
  hubNames: Map<string, string> = new Map()
): BundlesView {
  const skipped = { notSessionBundles: 0, oldUsedUp: 0, oldExpired: 0, unknownProducts: 0 };

  // Non-cancelled appointments, by certificate code and by email.
  const byCode = new Map<string, AcuityAppointment[]>();
  const byEmail = new Map<string, AcuityAppointment[]>();
  const seen = new Set<number>();
  for (const appt of [...appointments].sort((a, b) => appointmentTime(a) - appointmentTime(b))) {
    if (appt.canceled || seen.has(appt.id) || Number.isNaN(appointmentTime(appt))) continue;
    seen.add(appt.id);
    const code = codeKey(appt.certificate);
    if (code) byCode.set(code, [...(byCode.get(code) ?? []), appt]);
    const email = normalizeEmail(appt.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), appt]);
  }

  const rows: BundleRow[] = [];
  for (const cert of certificates) {
    if (!isSessionBundle(cert)) {
      skipped.notSessionBundles++;
      continue;
    }
    const product = cert.productID ? BUNDLE_PRODUCTS[String(cert.productID)] : undefined;
    if (!product) skipped.unknownProducts++;

    const remaining = remainingCredits(cert);
    const total = product ? Math.max(product.sessions, remaining) : null;
    const used = total === null ? null : total - remaining;

    // Sessions booked with this code; without any, the customer's own sessions.
    const coded = byCode.get(codeKey(cert.certificate)) ?? [];
    const email = bundleEmail(cert) ?? normalizeEmail(coded[0]?.email);
    const sessions = coded.length > 0 ? coded : (email ? (byEmail.get(email) ?? []).filter(isSession) : []);
    const matchedBy = coded.length > 0 ? "code" : sessions.length > 0 ? "email" : null;
    const past = sessions.filter((a) => isCompleted(a, now));
    const last = past[past.length - 1] ?? null;
    const next = sessions.find((a) => isUpcoming(a, now)) ?? null;

    const expiresMs = cert.expiration ? Date.parse(cert.expiration) : NaN;
    const daysToExpiry = Number.isNaN(expiresMs) ? null : Math.floor((expiresMs - now) / DAY_MS);
    const createdMs = cert.createdDate ? Date.parse(cert.createdDate) : NaN;
    const firstCoded = coded[0] ?? null;
    const purchasedAt = !Number.isNaN(createdMs)
      ? new Date(createdMs).toISOString()
      : firstCoded?.datetime ?? null;
    const purchasedSource = !Number.isNaN(createdMs) ? "acuity" : firstCoded ? "first_session" : null;
    const daysSinceLastSession = last ? daysSince(appointmentTime(last), now) : null;

    const segment = segmentFor({
      remaining,
      used,
      daysToExpiry,
      daysSincePurchase: purchasedAt ? daysSince(Date.parse(purchasedAt), now) : null,
      daysSinceLastSession,
      hasUpcoming: next !== null,
    });

    // Old history isn't actionable: drop long-finished and long-expired bundles.
    if (segment === "used_up" && (daysSinceLastSession === null || daysSinceLastSession > USED_UP_RECENT_DAYS)) {
      skipped.oldUsedUp++;
      continue;
    }
    if (segment === "expired" && daysToExpiry !== null && -daysToExpiry > EXPIRED_RECENT_DAYS) {
      skipped.oldExpired++;
      continue;
    }

    // Name and phone from the bundle's sessions, else from any of the
    // customer's bookings (a Let's Talk call, say), else the Hub account's
    // name. Never cert.name: that's the product's title.
    const named = last ?? next ?? coded[0] ?? null;
    const anyBooking = email ? [...(byEmail.get(email) ?? [])].reverse() : [];
    const name =
      fullName(named) ||
      anyBooking.map(fullName).find(Boolean) ||
      (email ? hubNames.get(email) : undefined) ||
      null;
    const phone =
      [...[...sessions].reverse(), ...anyBooking].find((a) => (a.phone ?? "").trim())?.phone?.trim() ?? null;

    rows.push({
      id: cert.id,
      code: cert.certificate,
      key: customerKeyFor(email, cert),
      name,
      email,
      phone,
      bundleName: product?.name ?? (cert.name ? `Unknown bundle (${cert.name})` : "Unknown bundle"),
      knownProduct: Boolean(product),
      totalCredits: total,
      usedCredits: used,
      remainingCredits: remaining,
      utilisation: total ? Math.round(((used ?? 0) / total) * 100) : null,
      purchasedAt,
      purchasedSource,
      expiresAt: Number.isNaN(expiresMs) ? null : new Date(expiresMs).toISOString(),
      daysToExpiry,
      lastSessionAt: last?.datetime ?? null,
      daysSinceLastSession,
      nextSessionAt: next?.datetime ?? null,
      sessionsMatchedBy: matchedBy,
      portalStatus: matchPortalAccount({ email }, portalEmails),
      otherBundles: 0,
      segment,
    });
  }

  // "2 bundles" chip: other listed bundles for the same customer.
  const perKey = new Map<string, number>();
  for (const row of rows) perKey.set(row.key, (perKey.get(row.key) ?? 0) + 1);
  for (const row of rows) row.otherBundles = (perKey.get(row.key) ?? 1) - 1;

  rows.sort((a, b) => SEGMENT_ORDER.indexOf(a.segment) - SEGMENT_ORDER.indexOf(b.segment) || withinSegment(a, b));

  const counts = Object.fromEntries(SEGMENT_ORDER.map((s) => [s, 0])) as Record<BundleSegment, number>;
  for (const row of rows) counts[row.segment]++;

  const active = rows.filter((row) => row.segment !== "used_up" && row.segment !== "expired");
  const withTotal = active.filter((row) => row.utilisation !== null);
  return {
    rows,
    counts,
    totals: {
      activeBundles: active.length,
      unusedCredits: active.reduce((sum, row) => sum + row.remainingCredits, 0),
      expiringSoon: counts.expiring,
      stalled: counts.stalled,
      averageUtilisation:
        withTotal.length > 0
          ? Math.round(withTotal.reduce((sum, row) => sum + row.utilisation!, 0) / withTotal.length)
          : null,
    },
    skipped,
  };
}

function fullName(appt: AcuityAppointment | null): string {
  return [appt?.firstName, appt?.lastName].map((part) => (part ?? "").trim()).filter(Boolean).join(" ");
}

// Within a segment, the most urgent first.
function withinSegment(a: BundleRow, b: BundleRow): number {
  switch (a.segment) {
    case "expiring":
    case "expired":
      return (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0);
    case "not_started":
      return (a.purchasedAt ?? "").localeCompare(b.purchasedAt ?? "");
    case "stalled":
      return (b.daysSinceLastSession ?? 0) - (a.daysSinceLastSession ?? 0);
    case "used_up":
      return (a.daysSinceLastSession ?? 0) - (b.daysSinceLastSession ?? 0);
    default:
      return b.remainingCredits - a.remainingCredits;
  }
}
