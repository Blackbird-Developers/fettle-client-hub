import { describe, expect, it } from "vitest";
import {
  type AcuityAppointment,
  DAY_MS,
  buildPortalEmailSet,
} from "../admin-customer-insights/logic.ts";
import {
  type AcuityCertificate,
  appointmentsForBundles,
  bundleEmail,
  bundleMatchKeys,
  buildBundlesView,
  dateRanges,
  isSessionBundle,
  lookupEmails,
  remainingCredits,
  segmentFor,
  uniqueCertificates,
  withFoundByEmail,
} from "./logic.ts";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const THREE_PACK = 1122832;
const SIX_PACK = 996385;
const YOUTH_FIVE = 1975510;
const days = (n: number) => new Date(NOW + n * DAY_MS).toISOString();

let nextId = 1;
function cert(overrides: Partial<AcuityCertificate> = {}): AcuityCertificate {
  const id = nextId++;
  return {
    id,
    certificate: `CODE${id}`,
    productID: SIX_PACK,
    name: "Ann Archer",
    email: "ann@example.com",
    type: "counts",
    remainingCounts: 4,
    createdDate: days(-60),
    expiration: null,
    ...overrides,
  };
}

function appt(daysFromNow: number, overrides: Partial<AcuityAppointment> = {}): AcuityAppointment {
  return {
    id: nextId++,
    firstName: "Ann",
    lastName: "Archer",
    email: "ann@example.com",
    phone: "087 123 4567",
    datetime: days(daysFromNow),
    type: "Individual Therapy Session with Jane",
    canceled: false,
    certificate: null,
    ...overrides,
  };
}

const view = (certs: AcuityCertificate[], appts: AcuityAppointment[] = [], accounts: string[] = []) =>
  buildBundlesView(certs, appts, buildPortalEmailSet(accounts), NOW);

describe("which certificates are bundles", () => {
  it("keeps counts and minutes certificates, drops coupons and money values", () => {
    expect(isSessionBundle(cert({ type: "counts" }))).toBe(true);
    expect(isSessionBundle(cert({ type: "appointments" }))).toBe(true);
    expect(isSessionBundle(cert({ type: "minutes" }))).toBe(true);
    expect(isSessionBundle(cert({ type: "coupon" }))).toBe(false);
    expect(isSessionBundle(cert({ type: "value" }))).toBe(false);
    expect(isSessionBundle(cert({ type: null, productID: THREE_PACK }))).toBe(true);
    expect(isSessionBundle(cert({ type: null, productID: 1 }))).toBe(false);
  });

  it("turns minutes into sessions by bundle type", () => {
    expect(remainingCredits(cert({ type: "minutes", remainingMinutes: 150, productID: SIX_PACK }))).toBe(3);
    expect(remainingCredits(cert({ type: "minutes", remainingMinutes: 150, productID: YOUTH_FIVE }))).toBe(2);
    expect(remainingCredits(cert({ remainingCounts: { "11": 2, "12": 3 } }))).toBe(3);
    expect(remainingCredits(cert({ remainingCounts: null }))).toBe(0);
  });
});

describe("segmentFor", () => {
  const base = {
    remaining: 3,
    used: 3,
    daysToExpiry: null,
    daysSincePurchase: 60,
    daysSinceLastSession: 10,
    hasUpcoming: false,
  };

  it("puts each bundle in one segment, most urgent first", () => {
    expect(segmentFor({ ...base, remaining: 0 })).toBe("used_up");
    expect(segmentFor({ ...base, daysToExpiry: -3 })).toBe("expired");
    expect(segmentFor({ ...base, daysToExpiry: 20 })).toBe("expiring");
    expect(segmentFor({ ...base, used: 0, daysSinceLastSession: null })).toBe("not_started");
    expect(segmentFor({ ...base, daysSinceLastSession: 45 })).toBe("stalled");
    expect(segmentFor({ ...base, remaining: 1 })).toBe("nearly_done");
    expect(segmentFor(base)).toBe("on_track");
  });

  it("gives a new bundle two weeks before calling it not started", () => {
    expect(segmentFor({ ...base, used: 0, daysSinceLastSession: null, daysSincePurchase: 5 })).toBe("on_track");
    expect(segmentFor({ ...base, used: 0, daysSinceLastSession: null, hasUpcoming: true })).toBe("on_track");
  });

  it("isn't stalled with a session booked", () => {
    expect(segmentFor({ ...base, daysSinceLastSession: 45, hasUpcoming: true })).toBe("on_track");
  });
});

describe("buildBundlesView", () => {
  it("works out used, remaining and utilisation, with sessions booked with the code", () => {
    const c = cert({ productID: SIX_PACK, remainingCounts: 4, certificate: "ab12" });
    const { rows } = view(
      [c],
      [appt(-20, { certificate: "AB12" }), appt(-5, { certificate: "AB12" }), appt(9, { certificate: "AB12" })],
      ["ann@example.com"]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      bundleName: "6 Session Bundle",
      totalCredits: 6,
      usedCredits: 2,
      remainingCredits: 4,
      utilisation: 33,
      daysSinceLastSession: 5,
      nextSessionAt: days(9),
      sessionsMatchedBy: "code",
      portalStatus: "has_account",
      purchasedSource: "acuity",
      segment: "on_track",
      key: "email:ann@example.com",
      phone: "087 123 4567",
    });
  });

  it("falls back to the customer's sessions by email, and to the first session as purchase date", () => {
    const { rows } = view([cert({ createdDate: null })], [appt(-40)]);
    expect(rows[0]).toMatchObject({ sessionsMatchedBy: "email", purchasedAt: null, segment: "stalled" });

    const coded = view([cert({ createdDate: null, certificate: "X1" })], [appt(-3, { certificate: "x1" })]);
    expect(coded.rows[0]).toMatchObject({ purchasedSource: "first_session", purchasedAt: days(-3) });
  });

  it("shows unknown products with remaining credits only", () => {
    const { rows, skipped } = view([cert({ productID: 42, name: "Old bundle", remainingCounts: 2 })]);
    expect(rows[0]).toMatchObject({
      bundleName: "Unknown bundle (Old bundle)",
      knownProduct: false,
      totalCredits: null,
      usedCredits: null,
      utilisation: null,
    });
    expect(skipped.unknownProducts).toBe(1);
  });

  it("drops coupons, long-finished and long-expired bundles, and counts them", () => {
    const { rows, skipped } = view([
      cert({ type: "coupon" }),
      cert({ remainingCounts: 0 }), // used up, no recent session
      cert({ remainingCounts: 2, expiration: days(-400) }),
      cert({ remainingCounts: 2, expiration: days(-10), email: "bo@example.com" }),
    ]);
    expect(skipped).toMatchObject({ notSessionBundles: 1, oldUsedUp: 1, oldExpired: 1 });
    expect(rows.map((r) => r.segment)).toEqual(["expired"]);
  });

  it("keeps recently used-up bundles as renewal opportunities", () => {
    const c = cert({ productID: THREE_PACK, remainingCounts: 0, certificate: "U1" });
    const { rows } = view([c], [appt(-12, { certificate: "U1" })]);
    expect(rows[0]).toMatchObject({ segment: "used_up", utilisation: 100 });
  });

  it("orders by segment, flags customers with several bundles and adds up the header numbers", () => {
    const expiring = cert({ remainingCounts: 3, expiration: days(10), email: "cy@example.com" });
    const stalled = cert({ remainingCounts: 4, email: "ann@example.com" });
    const second = cert({ productID: THREE_PACK, remainingCounts: 3, email: "ann@example.com", createdDate: days(-2) });
    const result = view([stalled, second, expiring], [appt(-45)]);

    expect(result.rows.map((r) => r.segment)).toEqual(["expiring", "stalled", "on_track"]);
    expect(result.rows.find((r) => r.id === stalled.id)!.otherBundles).toBe(1);
    expect(result.rows.find((r) => r.id === expiring.id)!.otherBundles).toBe(0);
    expect(result.counts).toMatchObject({ expiring: 1, stalled: 1, on_track: 1 });
    expect(result.totals).toMatchObject({ activeBundles: 3, unusedCredits: 10, expiringSoon: 1, stalled: 1 });
    // (50% + 33% + 0%) / 3
    expect(result.totals.averageUtilisation).toBe(28);
  });

  it("ignores cancelled appointments", () => {
    const { rows } = view([cert({ certificate: "C1" })], [appt(-3, { certificate: "C1", canceled: true })]);
    expect(rows[0].sessionsMatchedBy).toBeNull();
  });
});

describe("building in steps", () => {
  it("keeps only appointments a bundle can use, and gives the same view", () => {
    const certs = [
      cert({ certificate: "c1", email: "ann@example.com" }),
      cert({ certificate: "C2", email: null }),
      cert({ certificate: "COUPON", type: "coupon", email: "carl@example.com" }),
    ];
    const appts = [
      appt(-3, { certificate: "C1 " }),
      appt(-10, { certificate: "C2", email: "bo@example.com" }),
      appt(-5, { email: "ANN@example.com" }),
      appt(-4, { email: "carl@example.com" }),
      appt(-2, { email: "someone@example.com", certificate: "OTHER" }),
    ];

    const keys = bundleMatchKeys(certs);
    expect(keys).toEqual({ codes: ["C1", "C2"], emails: ["ann@example.com"] });

    const kept = appointmentsForBundles(appts, keys);
    expect(kept.map((a) => a.id)).toEqual([appts[0].id, appts[1].id, appts[2].id]);
    expect(view(certs, kept)).toEqual(view(certs, appts));
  });

  it("looks up each email as written and in lower case, once", () => {
    const appts = [
      appt(-1, { email: " Ann@Example.com " }),
      appt(-2, { email: "ann@example.com" }),
      appt(-3, { email: "not-an-email" }),
      appt(-4, { email: null }),
    ];
    expect(lookupEmails(appts, ["bo@example.com", null])).toEqual([
      "Ann@Example.com",
      "ann@example.com",
      "bo@example.com",
    ]);
  });

  it("lists a certificate found through two emails once", () => {
    const one = cert({ id: 500 });
    expect(uniqueCertificates([one, { ...one }, cert({ id: 501 })]).map((c) => c.id)).toEqual([500, 501]);
  });

  it("keeps every email that found a certificate", () => {
    const one = cert({ id: 502, email: null });
    const merged = uniqueCertificates([
      withFoundByEmail(one, " Ann@Example.com "),
      withFoundByEmail(one, "bo@example.com"),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].foundByEmails).toEqual(["ann@example.com", "bo@example.com"]);
  });
});

describe("who a bundle belongs to", () => {
  it("uses the bundle's own email first", () => {
    expect(bundleEmail(cert({ email: " Ann@Example.com ", foundByEmails: ["bo@example.com"] }))).toBe(
      "ann@example.com"
    );
  });

  it("falls back to the one email whose search found it", () => {
    expect(bundleEmail(cert({ email: null, foundByEmails: ["ann@example.com"] }))).toBe("ann@example.com");
    expect(bundleEmail(cert({ email: "", foundByEmails: ["Ann@Example.com", "ann@example.com"] }))).toBe(
      "ann@example.com"
    );
  });

  it("leaves it unidentified when two customers' searches found it", () => {
    expect(bundleEmail(cert({ email: null, foundByEmails: ["ann@example.com", "bo@example.com"] }))).toBeNull();
    expect(bundleEmail(cert({ email: null }))).toBeNull();
  });

  it("identifies a not-started bundle with a blank email from its other bookings", () => {
    const blank = withFoundByEmail(
      cert({ email: null, name: "Bundle 6 x 50min Individual Therapy Sessions", remainingCounts: 6, createdDate: days(-20) }),
      "ann@example.com"
    );
    const letsTalk = appt(-30, { type: "Let's Talk - Finding your Path", phone: "086 555 0000" });
    const keys = bundleMatchKeys([blank]);
    expect(keys.emails).toEqual(["ann@example.com"]);

    const [row] = view([blank], appointmentsForBundles([letsTalk], keys)).rows;
    expect(row).toMatchObject({
      name: "Ann Archer",
      email: "ann@example.com",
      phone: "086 555 0000",
      segment: "not_started",
      sessionsMatchedBy: null,
    });
  });

  it("never shows the product title as the customer's name", () => {
    const [row] = view([cert({ email: null, name: "Bundle 3 x 50min Zoom Sessions" })]).rows;
    expect(row).toMatchObject({ name: null, email: null, phone: null });
  });

  it("takes the name from the Hub account when Acuity has none", () => {
    const [row] = buildBundlesView(
      [cert({ email: "cara@example.com" })],
      [],
      buildPortalEmailSet(["cara@example.com"]),
      NOW,
      new Map([["cara@example.com", "Cara Dunne"]])
    ).rows;
    expect(row).toMatchObject({ name: "Cara Dunne", portalStatus: "has_account" });
  });

  it("splits a date window into consecutive ranges", () => {
    expect(dateRanges("2026-10-01", "2026-10-30", 14)).toEqual([
      ["2026-10-01", "2026-10-14"],
      ["2026-10-15", "2026-10-28"],
      ["2026-10-29", "2026-10-30"],
    ]);
    expect(dateRanges("2026-10-01", "2026-10-01", 14)).toEqual([["2026-10-01", "2026-10-01"]]);
  });
});
