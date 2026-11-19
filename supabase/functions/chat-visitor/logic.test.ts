import { describe, expect, it } from "vitest";
import {
  ALERT_GAP_MS,
  MAX_MESSAGE_LENGTH,
  RateLimiter,
  alertEmail,
  allowedOrigins,
  email,
  line,
  parseRequest,
  randomHex,
  safeEqual,
  sha256Hex,
  shouldAlert,
  text,
  url,
} from "./logic.ts";

const ID = "3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b";
const SECRET = "a".repeat(48);
const CLIENT_ID = "m_1234567890ab";

describe("allowedOrigins", () => {
  it("has the website by default and adds extras without trailing slashes", () => {
    const origins = allowedOrigins(" http://localhost:8787/ , https://staging.fettle.ie");
    expect(origins.has("https://fettle.ie")).toBe(true);
    expect(origins.has("https://www.fettle.ie")).toBe(true);
    expect(origins.has("http://localhost:8787")).toBe(true);
    expect(origins.has("https://staging.fettle.ie")).toBe(true);
    expect(allowedOrigins(undefined).has("http://localhost:8787")).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("blocks over the limit and resets after the window", () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.take("ip", 0)).toBe(true);
    expect(limiter.take("ip", 10)).toBe(true);
    expect(limiter.take("ip", 20)).toBe(false);
    expect(limiter.take("other", 20)).toBe(true);
    expect(limiter.take("ip", 1000)).toBe(true);
  });
});

describe("cleaners", () => {
  it("text trims, drops control characters and keeps new lines", () => {
    expect(text("  hi\u0000 there\r\nagain  ", 100)).toBe("hi there\nagain");
    expect(text("   ", 100)).toBeNull();
    expect(text(42, 100)).toBeNull();
    expect(text("abcdef", 3)).toBe("abc");
  });

  it("line collapses white space", () => {
    expect(line(" Sarah \n  Byrne ", 100)).toBe("Sarah Byrne");
  });

  it("email lower-cases and rejects non-emails", () => {
    expect(email(" Sarah@Example.com ")).toBe("sarah@example.com");
    expect(email("not an email")).toBeNull();
    expect(email(null)).toBeNull();
  });

  it("url keeps http(s) only and drops the fragment", () => {
    expect(url("https://fettle.ie/pricing/?a=1#top")).toBe("https://fettle.ie/pricing/?a=1");
    expect(url("javascript:alert(1)")).toBeNull();
    expect(url("nope")).toBeNull();
  });
});

describe("parseRequest", () => {
  it("accepts a start with page context", () => {
    const res = parseRequest({
      action: "start",
      body: "  Hello  ",
      client_id: CLIENT_ID,
      name: "Sarah",
      email: "SARAH@example.com",
      page_url: "https://fettle.ie/pricing/",
      page_title: "Pricing",
      referrer: "https://www.google.com/",
      extra: "ignored",
    });
    expect(res).toEqual({
      ok: true,
      request: {
        action: "start",
        body: "Hello",
        clientId: CLIENT_ID,
        name: "Sarah",
        email: "sarah@example.com",
        pageUrl: "https://fettle.ie/pricing/",
        pageTitle: "Pricing",
        referrer: "https://www.google.com/",
      },
    });
  });

  it("rejects empty and over-long messages and bad client ids", () => {
    expect(parseRequest({ action: "start", body: "  ", client_id: CLIENT_ID })).toEqual({
      ok: false,
      error: "empty_message",
    });
    expect(
      parseRequest({ action: "start", body: "x".repeat(MAX_MESSAGE_LENGTH + 1), client_id: CLIENT_ID }),
    ).toEqual({ ok: false, error: "message_too_long" });
    expect(parseRequest({ action: "start", body: "hi", client_id: "no" })).toEqual({
      ok: false,
      error: "invalid_client_id",
    });
  });

  it("needs a well-formed conversation id and secret for send, history and identify", () => {
    for (const action of ["send", "history", "identify"]) {
      expect(parseRequest({ action, conversation_id: "1", secret: SECRET, body: "hi", client_id: CLIENT_ID })).toEqual({
        ok: false,
        error: "invalid_credentials",
      });
      expect(parseRequest({ action, conversation_id: ID, secret: "short", body: "hi", client_id: CLIENT_ID })).toEqual({
        ok: false,
        error: "invalid_credentials",
      });
    }
  });

  it("parses send and history", () => {
    expect(
      parseRequest({ action: "send", conversation_id: ID, secret: SECRET, body: "hi", client_id: CLIENT_ID }),
    ).toEqual({
      ok: true,
      request: { action: "send", conversationId: ID, secret: SECRET, body: "hi", clientId: CLIENT_ID },
    });
    expect(parseRequest({ action: "history", conversation_id: ID, secret: SECRET, read: true })).toEqual({
      ok: true,
      request: { action: "history", conversationId: ID, secret: SECRET, markRead: true },
    });
    expect(parseRequest({ action: "history", conversation_id: ID, secret: SECRET })).toMatchObject({
      request: { markRead: false },
    });
  });

  it("identify needs a name or a valid email", () => {
    expect(parseRequest({ action: "identify", conversation_id: ID, secret: SECRET })).toEqual({
      ok: false,
      error: "nothing_to_save",
    });
    expect(parseRequest({ action: "identify", conversation_id: ID, secret: SECRET, email: "nope" })).toEqual({
      ok: false,
      error: "invalid_email",
    });
    expect(
      parseRequest({ action: "identify", conversation_id: ID, secret: SECRET, email: "a@b.ie" }),
    ).toMatchObject({ ok: true, request: { name: null, email: "a@b.ie" } });
  });

  it("rejects unknown actions and non-objects", () => {
    expect(parseRequest({ action: "delete" })).toEqual({ ok: false, error: "unknown_action" });
    expect(parseRequest([])).toEqual({ ok: false, error: "invalid_body" });
    expect(parseRequest(null)).toEqual({ ok: false, error: "invalid_body" });
  });
});

describe("tokens", () => {
  it("randomHex gives the right length and differs each time", () => {
    const a = randomHex(24);
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(randomHex(24)).not.toBe(a);
  });

  it("sha256Hex matches a known digest", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("safeEqual compares whole strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("staff alerts", () => {
  const NOW = Date.parse("2026-11-19T12:00:00Z");

  it("alerts for a first message and after a long silence only", () => {
    expect(shouldAlert(null, NOW)).toBe(true);
    expect(shouldAlert(new Date(NOW - ALERT_GAP_MS).toISOString(), NOW)).toBe(true);
    expect(shouldAlert(new Date(NOW - 60_000).toISOString(), NOW)).toBe(false);
  });

  it("escapes visitor text in the email", () => {
    const mail = alertEmail({
      isNew: true,
      visitorName: "<b>Sam</b>",
      visitorEmail: null,
      pageUrl: "https://fettle.ie/pricing/",
      body: "<script>alert(1)</script>",
      inboxUrl: "https://my.fettle.ie/admin/inbox?c=1",
    });
    expect(mail.subject).toBe("New live chat from <b>Sam</b>");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).toContain("https://my.fettle.ie/admin/inbox?c=1");
  });

  it("names a returning visitor by email, or generically", () => {
    const base = { isNew: false, visitorName: null, pageUrl: null, body: "hi", inboxUrl: "x" };
    expect(alertEmail({ ...base, visitorEmail: "a@b.ie" }).subject).toBe("a@b.ie replied in live chat");
    expect(alertEmail({ ...base, visitorEmail: null }).subject).toBe("A website visitor replied in live chat");
  });
});
