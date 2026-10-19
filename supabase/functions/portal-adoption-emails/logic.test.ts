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
  type Campaign,
  type DeliverDeps,
  type Recipient,
  type SendHistory,
  EMAIL_GAP_DAYS,
  MAX_RECIPIENTS_CEILING,
  deliver,
  enquiryCandidates,
  enquiryRecipients,
  existingClientRecipients,
  hasEarlierSession,
  isFreeCall,
  maskEmail,
  planSends,
  readConfig,
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

const BOTH = new Set<Campaign>(["existing_clients", "new_enquiries"]);

const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

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
      25,
      BOTH
    );
    expect(plan.send.map((r) => r.email)).toEqual(["d@example.com"]);
    expect(plan.skipped).toMatchObject({ already_sent: 1, suppressed: 1, not_continuing: 1 });
  });

  it("gives Email 1 priority and never sends both emails in one run", () => {
    const plan = planSends(
      [recipient("new_enquiries", "a@example.com"), recipient("existing_clients", "a@example.com")],
      emptyHistory(),
      NOW,
      25,
      BOTH
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
      25,
      BOTH
    );
    expect(plan.send.map((r) => r.email)).toEqual(["b@example.com"]);
    expect(plan.skipped.emailed_recently).toBe(1);
  });

  it("caps the run and keeps the rest for the next one", () => {
    const plan = planSends(
      ["a", "b", "c"].map((x) => recipient("existing_clients", `${x}@example.com`)),
      emptyHistory(),
      NOW,
      2,
      BOTH
    );
    expect(plan.send).toHaveLength(2);
    expect(plan.waiting.map((r) => r.email)).toEqual(["c@example.com"]);
  });
});

describe("readConfig", () => {
  it("is a dry run with Email 1 only and a cap of 25 when nothing is set", () => {
    expect(readConfig(envOf({}))).toEqual({
      live: false,
      campaigns: new Set(["existing_clients"]),
      maxRecipients: 25,
    });
  });

  it("goes live only on exactly \"true\"", () => {
    expect(readConfig(envOf({ PORTAL_EMAILS_LIVE: "true" })).live).toBe(true);
    for (const value of ["TRUE", "1", "yes", " true", ""]) {
      expect(readConfig(envOf({ PORTAL_EMAILS_LIVE: value })).live).toBe(false);
    }
  });

  it("runs only existing_clients with the launch settings", () => {
    expect(
      readConfig(envOf({
        PORTAL_EMAILS_LIVE: "true",
        PORTAL_EMAILS_CAMPAIGNS: "existing_clients",
        PORTAL_EMAILS_MAX_RECIPIENTS: "25",
      }))
    ).toEqual({ live: true, campaigns: new Set(["existing_clients"]), maxRecipients: 25 });
  });

  it.each(["", " ", ",", "existing_clients", " Existing_Clients ", "existing_clients,typo"])(
    "keeps new_enquiries off for PORTAL_EMAILS_CAMPAIGNS=%j",
    (value) => {
      const { campaigns } = readConfig(envOf({ PORTAL_EMAILS_CAMPAIGNS: value }));
      expect([...campaigns]).toEqual(["existing_clients"]);
    }
  );

  it("sends nothing when only unknown campaigns are listed", () => {
    expect(readConfig(envOf({ PORTAL_EMAILS_CAMPAIGNS: "new_enquires,all" })).campaigns.size).toBe(0);
  });

  it("still allows Email 2 when it is listed explicitly", () => {
    const { campaigns } = readConfig(envOf({ PORTAL_EMAILS_CAMPAIGNS: "existing_clients, new_enquiries" }));
    expect(campaigns).toEqual(BOTH);
  });

  it(`never lets the cap go above ${MAX_RECIPIENTS_CEILING}, and falls back to it when unreadable`, () => {
    const cap = (value: string) => readConfig(envOf({ PORTAL_EMAILS_MAX_RECIPIENTS: value })).maxRecipients;
    expect(MAX_RECIPIENTS_CEILING).toBe(25);
    expect(cap("10")).toBe(10);
    expect(cap("0")).toBe(0);
    expect(cap("250")).toBe(25);
    for (const value of ["", "abc", "-5", "2.5", "1e3"]) expect(cap(value)).toBe(25);
  });
});

describe("launch: Email 1 only", () => {
  const launch = readConfig(envOf({
    PORTAL_EMAILS_LIVE: "true",
    PORTAL_EMAILS_CAMPAIGNS: "existing_clients",
    PORTAL_EMAILS_MAX_RECIPIENTS: "25",
  }));

  it("drops new_enquiries recipients even if they reach the planner", () => {
    const plan = planSends(
      [recipient("existing_clients", "a@example.com"), recipient("new_enquiries", "b@example.com")],
      emptyHistory(),
      NOW,
      launch.maxRecipients,
      launch.campaigns
    );
    expect(plan.send).toEqual([recipient("existing_clients", "a@example.com")]);
    expect(plan.waiting).toEqual([]);
    expect(plan.skipped.campaign_disabled).toBe(1);
  });

  it("sends 25 of a 121-person backlog and leaves the rest for later runs", () => {
    const backlog = Array.from({ length: 121 }, (_, i) => recipient("existing_clients", `c${i}@example.com`));
    const plan = planSends(backlog, emptyHistory(), NOW, launch.maxRecipients, launch.campaigns);
    expect(plan.send).toHaveLength(25);
    expect(plan.waiting).toHaveLength(96);
    expect(plan.send[0].email).toBe("c0@example.com");
  });

  it("skips suppressed (unsubscribed, bounced, complained) and already-sent addresses", () => {
    const history = emptyHistory();
    history.suppressed.add("unsub@example.com");
    history.sent.existing_clients.add("done@example.com");
    const plan = planSends(
      ["unsub", "done", "new"].map((x) => recipient("existing_clients", `${x}@example.com`)),
      history,
      NOW,
      launch.maxRecipients,
      launch.campaigns
    );
    expect(plan.send.map((r) => r.email)).toEqual(["new@example.com"]);
    expect(plan.skipped).toMatchObject({ suppressed: 1, already_sent: 1 });
  });
});

describe("deliver", () => {
  // In-memory stand-in for email_sends (unique per campaign + email) and Resend.
  function fakeDeps(options: { failSendFor?: string; taken?: string[] } = {}) {
    const rows = new Map<string, { key: string; status: "claimed" | "sent"; messageId?: string }>();
    const keys = new Set((options.taken ?? []).map((email) => `existing_clients:${email}`));
    const sentTo: string[] = [];
    let nextRow = 1;
    const deps: DeliverDeps = {
      async claim(r) {
        const key = `${r.campaign}:${r.email}`;
        if (keys.has(key)) return null;
        keys.add(key);
        const id = `row${nextRow++}`;
        rows.set(id, { key, status: "claimed" });
        return id;
      },
      async send(r) {
        if (r.email === options.failSendFor) throw new Error("Resend 500");
        sentTo.push(r.email);
        return `msg-${sentTo.length}`;
      },
      async release(id) {
        keys.delete(rows.get(id)!.key);
        rows.delete(id);
      },
      async markSent(id, messageId) {
        rows.set(id, { ...rows.get(id)!, status: "sent", messageId });
      },
      log: () => {},
    };
    return { deps, rows, sentTo };
  }
  const list = (...emails: string[]) => emails.map((e) => recipient("existing_clients", e));

  it("sends nothing and claims nothing in a dry run", async () => {
    const { deps, rows, sentTo } = fakeDeps();
    const result = await deliver(list("a@example.com", "b@example.com"), false, deps);
    expect(result).toEqual({ sent: 0, failures: [], alreadyClaimed: 0 });
    expect(sentTo).toEqual([]);
    expect(rows.size).toBe(0);
  });

  it("claims, sends and records each email when live", async () => {
    const { deps, rows, sentTo } = fakeDeps();
    const result = await deliver(list("a@example.com", "b@example.com"), true, deps);
    expect(result.sent).toBe(2);
    expect(sentTo).toEqual(["a@example.com", "b@example.com"]);
    expect([...rows.values()].map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("never sends an email another run has already claimed", async () => {
    const { deps, sentTo } = fakeDeps({ taken: ["a@example.com"] });
    const result = await deliver(list("a@example.com", "b@example.com"), true, deps);
    expect(sentTo).toEqual(["b@example.com"]);
    expect(result).toMatchObject({ sent: 1, alreadyClaimed: 1 });
  });

  it("sends only once when the same list is delivered twice", async () => {
    const { deps, sentTo } = fakeDeps();
    await deliver(list("a@example.com"), true, deps);
    const second = await deliver(list("a@example.com"), true, deps);
    expect(sentTo).toEqual(["a@example.com"]);
    expect(second).toMatchObject({ sent: 0, alreadyClaimed: 1 });
  });

  it("releases the claim when Resend fails, so a later run can retry", async () => {
    const { deps, rows, sentTo } = fakeDeps({ failSendFor: "a@example.com" });
    const result = await deliver(list("a@example.com", "b@example.com"), true, deps);
    expect(result).toMatchObject({ sent: 1, failures: ["a***@example.com"] });
    expect(sentTo).toEqual(["b@example.com"]);
    expect([...rows.values()].map((r) => r.key)).toEqual(["existing_clients:b@example.com"]);
  });

  it("counts a claim error as a failure and sends nothing for it", async () => {
    const { deps, sentTo } = fakeDeps();
    deps.claim = async () => {
      throw new Error("database down");
    };
    const result = await deliver(list("a@example.com"), true, deps);
    expect(result).toEqual({ sent: 0, failures: ["a***@example.com"], alreadyClaimed: 0 });
    expect(sentTo).toEqual([]);
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
