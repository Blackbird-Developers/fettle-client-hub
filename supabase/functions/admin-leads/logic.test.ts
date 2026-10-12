import { describe, expect, it } from "vitest";
import {
  type AcuityAppointment,
  DAY_MS,
  buildPortalEmailSet,
  groupCustomers,
} from "../admin-customer-insights/logic.ts";
import {
  BOOKED_IN_LABEL_ID,
  LEAD_LOOKBACK_DAYS,
  buildLeadsView,
  evaluateLeadHistory,
  isBookedIn,
  isLetsTalk,
  isNoShow,
  isQuoted,
  leadCandidates,
  leadStatus,
} from "./logic.ts";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const LETS_TALK = "Let's Talk - Finding your Path";
const THERAPY = "Individual Session with Jane Topkin";

const NO_SHOW = [{ id: 1, name: "No Show" }];
const QUOTED = [{ id: 2, name: "Quoted " }];
const BOOKED_IN = [{ id: BOOKED_IN_LABEL_ID, name: "Booked in " }];

let nextId = 1;
function appt(daysFromNow: number, overrides: Partial<AcuityAppointment> = {}): AcuityAppointment {
  return {
    id: nextId++,
    firstName: "Aoife",
    lastName: "Byrne",
    email: "aoife@example.com",
    phone: "087 123 4567",
    datetime: new Date(NOW + daysFromNow * DAY_MS).toISOString(),
    type: LETS_TALK,
    calendar: "Alex",
    canceled: false,
    labels: null,
    ...overrides,
  };
}

const candidatesFor = (appointments: AcuityAppointment[]) =>
  leadCandidates(groupCustomers(appointments), NOW);

describe("labels and types", () => {
  it.each(["No Show", "no-show", "Noshow ", " NO SHOW", "No Shows"])("matches %j as a no-show", (name) => {
    expect(isNoShow(appt(-1, { labels: [{ id: 9, name }] }))).toBe(true);
  });

  it("matches Quoted with Acuity's trailing space, any case", () => {
    expect(isQuoted(appt(-1, { labels: [{ id: 9, name: "Quoted " }] }))).toBe(true);
    expect(isQuoted(appt(-1, { labels: [{ id: 9, name: "QUOTED" }] }))).toBe(true);
    expect(isQuoted(appt(-1, { labels: [{ id: 9, name: "Quote sent" }] }))).toBe(false);
  });

  it("matches Booked in by id even if it's renamed", () => {
    expect(isBookedIn(appt(-1, { labels: [{ id: BOOKED_IN_LABEL_ID, name: "Converted" }] }))).toBe(true);
    expect(isBookedIn(appt(-1, { labels: [{ id: 5, name: "Booked in " }] }))).toBe(true);
  });

  it("copes with missing labels", () => {
    expect(isNoShow(appt(-1, { labels: undefined }))).toBe(false);
    expect(isQuoted(appt(-1, { labels: [{ id: 3 }] }))).toBe(false);
  });

  it("recognises every Let's Talk variant", () => {
    expect(isLetsTalk(appt(0, { type: "Let's Talk - Finding your Path (Courtney)" }))).toBe(true);
    expect(isLetsTalk(appt(0, { type: "Let’s Talk" }))).toBe(true);
    expect(isLetsTalk(appt(0, { type: "LETS TALK" }))).toBe(true);
    expect(isLetsTalk(appt(0, { type: THERAPY }))).toBe(false);
  });
});

describe("leadCandidates", () => {
  it("includes a Let's Talk no-show", () => {
    const [lead] = candidatesFor([appt(-3, { labels: NO_SHOW })]);
    expect(lead.source).toBe("no_show");
  });

  it("ignores a no-show on another appointment type", () => {
    expect(candidatesFor([appt(-3, { type: THERAPY, labels: NO_SHOW })])).toEqual([]);
  });

  it("includes a quote on any appointment type", () => {
    const [lead] = candidatesFor([appt(-3, { type: "Fettle Introduction Chat", labels: QUOTED })]);
    expect(lead.source).toBe("quoted");
  });

  it("ignores Let's Talk calls with no label, future calls and cancelled ones", () => {
    expect(
      candidatesFor([
        appt(-3),
        appt(2, { labels: NO_SHOW }),
        appt(-4, { labels: NO_SHOW, canceled: true }),
      ])
    ).toEqual([]);
  });

  it(`leaves out events older than ${LEAD_LOOKBACK_DAYS} days`, () => {
    expect(candidatesFor([appt(-(LEAD_LOOKBACK_DAYS + 1), { labels: QUOTED })])).toEqual([]);
    expect(candidatesFor([appt(-(LEAD_LOOKBACK_DAYS - 1), { labels: QUOTED })])).toHaveLength(1);
  });

  it("drops a no-show once a later call went ahead", () => {
    expect(candidatesFor([appt(-10, { labels: NO_SHOW }), appt(-5)])).toEqual([]);
  });

  it("keeps a no-show that came after a call that went ahead", () => {
    const [lead] = candidatesFor([appt(-10), appt(-5, { labels: NO_SHOW })]);
    expect(lead.source).toBe("no_show");
  });

  it("marks both when a quote and a later no-show are in the window", () => {
    const quote = appt(-20, { labels: QUOTED });
    const missed = appt(-6, { labels: NO_SHOW });
    const [lead] = candidatesFor([quote, missed]);
    expect(lead.source).toBe("both");
    expect(lead.lead.id).toBe(missed.id);
  });

  it("treats a rebooked call that ended in a quote as quoted only", () => {
    const [lead] = candidatesFor([appt(-12, { labels: NO_SHOW }), appt(-4, { labels: QUOTED })]);
    expect(lead.source).toBe("quoted");
  });

  it("gives one row per customer", () => {
    const leads = candidatesFor([
      appt(-12, { labels: NO_SHOW }),
      appt(-8, { labels: NO_SHOW }),
      appt(-3, { email: "other@example.com", labels: QUOTED }),
    ]);
    expect(leads.map((l) => l.customer.key).sort()).toEqual([
      "email:aoife@example.com",
      "email:other@example.com",
    ]);
  });
});

describe("leadStatus", () => {
  const statusOf = (appointments: AcuityAppointment[]) => {
    const [lead] = candidatesFor(appointments);
    return leadStatus(lead.customer, lead.leadAt, NOW);
  };

  it("is open when nothing has been booked since", () => {
    expect(statusOf([appt(-5, { labels: QUOTED })]).status).toBe("open");
  });

  it("is converted by a session booked after the lead", () => {
    const result = statusOf([appt(-5, { labels: QUOTED }), appt(4, { type: THERAPY })]);
    expect(result).toMatchObject({ status: "converted", detail: THERAPY });
  });

  it("is converted by a session that already happened after the lead", () => {
    expect(statusOf([appt(-5, { labels: QUOTED }), appt(-1, { type: THERAPY })]).status).toBe("converted");
  });

  it("ignores sessions before the lead", () => {
    expect(statusOf([appt(-30, { type: THERAPY }), appt(-5, { labels: QUOTED })]).status).toBe("open");
  });

  it("is converted when the lead call itself is labelled Booked in", () => {
    expect(statusOf([appt(-5, { labels: [...QUOTED, ...BOOKED_IN] })]).status).toBe("converted");
  });

  it("is call_rebooked when a new Let's Talk is booked", () => {
    expect(statusOf([appt(-5, { labels: NO_SHOW }), appt(3)]).status).toBe("call_rebooked");
  });

  it("ignores a cancelled booking", () => {
    expect(
      statusOf([appt(-5, { labels: QUOTED }), appt(4, { type: THERAPY, canceled: true })]).status
    ).toBe("open");
  });
});

describe("evaluateLeadHistory", () => {
  it("counts earlier sessions and every no-show, without double counting", () => {
    const earlier = [appt(-200, { type: THERAPY }), appt(-150, { labels: NO_SHOW })];
    const window = [appt(-20, { labels: NO_SHOW }), appt(-5, { labels: QUOTED })];
    const [lead] = candidatesFor(window);
    const history = evaluateLeadHistory(
      { appointments: [...earlier, window[0]], limit: 200 },
      lead,
      NOW
    );
    expect(history).toEqual({ priorSessions: 1, noShows: 2, status: "verified" });
  });

  it("is unverified with no email, a failed lookup or a full page", () => {
    const [lead] = candidatesFor([appt(-5, { labels: QUOTED })]);
    expect(evaluateLeadHistory(null, lead, NOW).status).toBe("unverified");
    expect(evaluateLeadHistory({ appointments: null, limit: 200 }, lead, NOW).status).toBe("unverified");
    expect(
      evaluateLeadHistory({ appointments: [appt(-300), appt(-299)], limit: 2 }, lead, NOW).status
    ).toBe("unverified");
  });
});

describe("buildLeadsView", () => {
  it("builds rows with totals, newest lead first", () => {
    const appointments = [
      appt(-20, { labels: QUOTED, calendar: "Courtney " }),
      appt(-2, { email: "b@example.com", labels: NO_SHOW }),
      appt(-9, { email: "c@example.com", labels: QUOTED }),
      appt(5, { email: "c@example.com", type: THERAPY }),
    ];
    const candidates = candidatesFor(appointments);
    const view = buildLeadsView(
      candidates,
      new Map(),
      buildPortalEmailSet(["B@example.com"]),
      NOW
    );

    expect(view.rows.map((r) => [r.email, r.daysSinceLead, r.status])).toEqual([
      ["b@example.com", 2, "open"],
      ["c@example.com", 9, "converted"],
      ["aoife@example.com", 20, "open"],
    ]);
    expect(view.totals).toEqual({ open: 2, call_rebooked: 0, converted: 1, quoted: 2, noShow: 1 });
    expect(view.rows[0].portalStatus).toBe("has_account");
    expect(view.rows[2].owner).toBe("Courtney");
    expect(view.rows[2].historyStatus).toBe("unverified");
  });
});
