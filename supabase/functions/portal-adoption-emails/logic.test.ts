import { describe, expect, it } from "vitest";
import {
  type AcuityAppointment,
  DAY_MS,
  buildPortalEmailSet,
  groupCustomers,
} from "../admin-customer-insights/logic.ts";
import {
  decodeEmailParam,
  encodeEmailParam,
  unsubscribeQuery,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "../_shared/unsubscribe.ts";
import {
  type Recipient,
  type SendHistory,
  EMAIL_GAP_DAYS,
  enquiryCandidates,
  enquiryRecipients,
  existingClientRecipients,
  hasEarlierSession,
  isFreeCall,
  maskEmail,
  planSends,
} from "./logic.ts";
import { renderEmail } from "./templates.ts";

const NOW = Date.parse("2026-10-12T09:30:00Z");
const LETS_TALK = "Let's Talk - Finding your Path";
const INTRO_CHAT = "Fettle Introduction Chat";
const THERAPY = "Individual Session with Jane Topkin";

let nextId = 1;
function appt(daysFromNow: number, overrides: Partial<AcuityAppointment> = {}): AcuityAppointment {
  return {
    id: nextId++,
    firstName: "Aoife",
    lastName: "Byrne",
    email: "aoife@example.com",
    phone: "087 123 4567",
    datetime: new Date(NOW + daysFromNow * DAY_MS).toISOString(),
    type: THERAPY,
    calendar: "Alex",
    canceled: false,
    labels: null,
    ...overrides,
  };
}

const NO_ACCOUNTS = buildPortalEmailSet([]);

function emptyHistory(): SendHistory {
  return {
    sent: { existing_clients: new Set(), new_enquiries: new Set() },
    lastSentAt: new Map(),
    suppressed: new Set(),
    notContinuing: new Set(),
  };
}

function recipient(campaign: Recipient["campaign"], email: string): Recipient {
  return { campaign, customerKey: `email:${email}`, email, name: null, firstName: null };
}

describe("free calls", () => {
  it.each([LETS_TALK, "Let’s Talk", INTRO_CHAT])("treats %j as a free call", (type) => {
    expect(isFreeCall(appt(0, { type }))).toBe(true);
  });

  it("doesn't treat paid sessions or paid intro calls as free calls", () => {
    expect(isFreeCall(appt(0, { type: THERAPY }))).toBe(false);
    expect(isFreeCall(appt(0, { type: "Introductory Call with Jane" }))).toBe(false);
  });
});

describe("Email 1: existing clients", () => {
  it("picks recently active customers without an account, with their first name", () => {
    const customers = groupCustomers([
      appt(-5, { firstName: "Aoife" }),
      appt(-3, { email: "has@example.com" }),
    ]);
    const list = existingClientRecipients(customers, buildPortalEmailSet(["HAS@example.com"]), NOW);
    expect(list).toEqual([
      {
        campaign: "existing_clients",
        customerKey: "email:aoife@example.com",
        email: "aoife@example.com",
        name: "Aoife Byrne",
        firstName: "Aoife",
      },
    ]);
  });

  it("leaves out people with no email and people whose last session is over 30 days ago", () => {
    const customers = groupCustomers([
      appt(-5, { email: null, phone: "087 000 0000" }),
      appt(-40, { email: "old@example.com" }),
    ]);
    expect(existingClientRecipients(customers, NO_ACCOUNTS, NOW)).toEqual([]);
  });

  it("ignores free calls, which don't count as sessions", () => {
    const customers = groupCustomers([appt(-5, { type: LETS_TALK })]);
    expect(existingClientRecipients(customers, NO_ACCOUNTS, NOW)).toEqual([]);
  });
});

describe("Email 2: new enquiries", () => {
  const candidatesFor = (appointments: AcuityAppointment[], accounts = NO_ACCOUNTS) =>
    enquiryCandidates(groupCustomers(appointments), accounts, NOW);

  it("includes a free call 2–14 days ago with nothing else booked", () => {
    expect(candidatesFor([appt(-2, { type: LETS_TALK })])).toHaveLength(1);
    expect(candidatesFor([appt(-14, { type: INTRO_CHAT })])).toHaveLength(1);
  });

  it("waits 2 days after the call and stops after 14", () => {
    expect(candidatesFor([appt(-1.5, { type: LETS_TALK })])).toEqual([]);
    expect(candidatesFor([appt(-14.5, { type: LETS_TALK })])).toEqual([]);
  });

  it("skips anyone with a paid session in the window, past or booked", () => {
    expect(candidatesFor([appt(-5, { type: LETS_TALK }), appt(-20)])).toEqual([]);
    expect(candidatesFor([appt(-5, { type: LETS_TALK }), appt(7)])).toEqual([]);
  });

  it("skips anyone with another free call booked, or an account", () => {
    expect(candidatesFor([appt(-5, { type: LETS_TALK }), appt(3, { type: LETS_TALK })])).toEqual([]);
    expect(
      candidatesFor([appt(-5, { type: LETS_TALK })], buildPortalEmailSet(["aoife@example.com"]))
    ).toEqual([]);
  });

  it("dates the email from the latest free call and lists the oldest first", () => {
    const list = candidatesFor([
      appt(-20, { type: LETS_TALK }),
      appt(-3, { type: LETS_TALK }),
      appt(-10, { type: INTRO_CHAT, email: "ciara@example.com" }),
    ]);
    expect(list.map((c) => c.customer.email)).toEqual(["ciara@example.com", "aoife@example.com"]);
    expect(enquiryRecipients(list).every((r) => r.campaign === "new_enquiries")).toBe(true);
  });

  it("ignores cancelled free calls", () => {
    expect(candidatesFor([appt(-5, { type: LETS_TALK, canceled: true })])).toEqual([]);
  });

  it("treats earlier paid sessions, or a history it can't read in full, as not new", () => {
    expect(hasEarlierSession([appt(-400, { type: LETS_TALK })], 200)).toBe(false);
    expect(hasEarlierSession([appt(-400)], 200)).toBe(true);
    expect(hasEarlierSession([appt(-400, { canceled: true })], 200)).toBe(false);
    expect(hasEarlierSession(null, 200)).toBe(true);
    expect(hasEarlierSession(Array.from({ length: 2 }, () => appt(-400, { type: LETS_TALK })), 2)).toBe(true);
  });
});

describe("planSends", () => {
  it("sends each campaign once and skips suppressed and Not continuing customers", () => {
    const history = emptyHistory();
    history.sent.existing_clients.add("a@example.com");
    history.suppressed.add("b@example.com");
    history.notContinuing.add("email:c@example.com");
    const plan = planSends(
      ["a", "b", "c", "d"].map((x) => recipient("existing_clients", `${x}@example.com`)),
      history,
      NOW,
      25
    );
    expect(plan.send.map((r) => r.email)).toEqual(["d@example.com"]);
    expect(plan.skipped).toMatchObject({ already_sent: 1, suppressed: 1, not_continuing: 1 });
  });

  it("gives Email 1 priority and never sends both emails in one run", () => {
    const plan = planSends(
      [recipient("new_enquiries", "a@example.com"), recipient("existing_clients", "a@example.com")],
      emptyHistory(),
      NOW,
      25
    );
    expect(plan.send).toEqual([recipient("existing_clients", "a@example.com")]);
    expect(plan.skipped.duplicate_in_run).toBe(1);
  });

  it(`waits ${EMAIL_GAP_DAYS} days after any portal email before sending the other one`, () => {
    const history = emptyHistory();
    history.lastSentAt.set("a@example.com", NOW - (EMAIL_GAP_DAYS - 1) * DAY_MS);
    history.lastSentAt.set("b@example.com", NOW - (EMAIL_GAP_DAYS + 1) * DAY_MS);
    const plan = planSends(
      [recipient("existing_clients", "a@example.com"), recipient("existing_clients", "b@example.com")],
      history,
      NOW,
      25
    );
    expect(plan.send.map((r) => r.email)).toEqual(["b@example.com"]);
    expect(plan.skipped.emailed_recently).toBe(1);
  });

  it("caps the run and keeps the rest for the next one", () => {
    const plan = planSends(
      ["a", "b", "c"].map((x) => recipient("existing_clients", `${x}@example.com`)),
      emptyHistory(),
      NOW,
      2
    );
    expect(plan.send).toHaveLength(2);
    expect(plan.waiting.map((r) => r.email)).toEqual(["c@example.com"]);
  });
});

describe("unsubscribe links", () => {
  it("round-trips the address and accepts only its own token", async () => {
    const email = "aoife+test@example.com";
    expect(decodeEmailParam(encodeEmailParam(email))).toBe(email);
    const token = await unsubscribeToken(email, "secret");
    expect(await verifyUnsubscribeToken(email, token, "secret")).toBe(true);
    expect(await verifyUnsubscribeToken("other@example.com", token, "secret")).toBe(false);
    expect(await verifyUnsubscribeToken(email, token, "another-secret")).toBe(false);
    expect(await verifyUnsubscribeToken(email, token.slice(1), "secret")).toBe(false);
  });

  it("builds a URL-safe query", async () => {
    const query = new URLSearchParams(await unsubscribeQuery("a@example.com", "secret"));
    expect(decodeEmailParam(query.get("e")!)).toBe("a@example.com");
    expect(query.get("t")).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a malformed address parameter", () => {
    expect(decodeEmailParam("%%%")).toBeNull();
  });
});

describe("templates", () => {
  const input = {
    firstName: "Aoife",
    ctaUrl: "https://my.fettle.ie/signup?email=aoife%40example.com&utm_content=x",
    unsubscribeUrl: "https://my.fettle.ie/unsubscribe?e=abc&t=def",
  };

  it.each(["existing_clients", "new_enquiries"] as const)("fills in %s with no tags left over", (campaign) => {
    const email = renderEmail(campaign, input);
    expect(email.html).toContain("Hi Aoife,");
    expect(email.html).toContain('href="https://my.fettle.ie/signup?email=aoife%40example.com&amp;utm_content=x"');
    expect(email.html).toContain('href="https://my.fettle.ie/unsubscribe?e=abc&amp;t=def"');
    expect(email.html).not.toMatch(/\{\{|\}\}|\$\{/);
    expect(email.html).not.toContain("my.fettle.ie/dashboard");
    expect(email.text).toContain(input.ctaUrl);
    expect(email.text).toContain(input.unsubscribeUrl);
  });

  it("uses the agreed subjects", () => {
    expect(renderEmail("existing_clients", input).subject).toBe("Your Fettle account is waiting");
    expect(renderEmail("new_enquiries", input).subject).toBe("Start your Fettle journey your way");
  });

  it("falls back to 'there' and escapes names", () => {
    expect(renderEmail("new_enquiries", { ...input, firstName: null }).html).toContain("Hi there,");
    expect(renderEmail("new_enquiries", { ...input, firstName: "<b>Al</b>" }).html).toContain(
      "Hi &lt;b&gt;Al&lt;/b&gt;,"
    );
  });

  it("gives every gradient a solid fallback colour", () => {
    for (const campaign of ["existing_clients", "new_enquiries"] as const) {
      const html = renderEmail(campaign, input).html;
      const gradients = html.match(/background:linear-gradient/g) ?? [];
      const fallbacks = html.match(/bgcolor="#[0-9a-f]{6}" style="background-color:#[0-9a-f]{6}; background:linear-gradient/g) ?? [];
      expect(gradients.length).toBeGreaterThan(0);
      expect(fallbacks).toHaveLength(gradients.length);
    }
  });

  it("masks emails for logs", () => {
    expect(maskEmail("aoife@example.com")).toBe("ao***@example.com");
  });
});
