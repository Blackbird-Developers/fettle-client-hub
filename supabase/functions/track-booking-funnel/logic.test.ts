import { describe, expect, it } from "vitest";
import {
  MAX_BATCH,
  RateLimiter,
  allowedOrigins,
  amount,
  int,
  occurredAt,
  pagePath,
  parsePayload,
  retentionCutoff,
  text,
} from "./logic.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const SESSION = "s_abcdef123456";

const body = (events: unknown[], extra: Record<string, unknown> = {}) => ({
  session_id: SESSION,
  flow: "website",
  context: { device: "mobile", page: "https://fettle.ie/book-a-session/?t=319", utm_source: "google" },
  events,
  ...extra,
});

describe("parsePayload", () => {
  it("turns a step event into a row", () => {
    const res = parsePayload(
      body([{ event_id: "e_00000001", event: "booking_step_view", step_name: "slot", step: 2, therapist: "Lisa Kelly", therapist_id: "319", ts: NOW - 1000 }]),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.skipped).toBe(0);
    expect(res.rows[0]).toMatchObject({
      session_id: SESSION,
      flow: "website",
      event: "booking_step_view",
      step_name: "slot",
      step: 2,
      therapist: "Lisa Kelly",
      therapist_id: 319,
      device: "mobile",
      page: "/book-a-session/",
      utm_source: "google",
      occurred_at: new Date(NOW - 1000).toISOString(),
    });
  });

  it("never keeps personal data", () => {
    const res = parsePayload(
      body([{ event_id: "e_00000002", event: "booking_completed", Email: "a@b.ie", client_email: "a@b.ie", client_name: "Sarah", phone: "087" }]),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(JSON.stringify(res.rows[0])).not.toMatch(/a@b\.ie|Sarah|087/);
  });

  it("skips unknown events, bad ids and duplicates but keeps the rest", () => {
    const res = parsePayload(
      body([
        { event_id: "e_00000003", event: "consultation_reserved" },
        { event_id: "short", event: "booking_page_view" },
        { event_id: "e_00000004", event: "booking_page_view" },
        { event_id: "e_00000004", event: "booking_page_view" },
        "nope",
      ]),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows).toHaveLength(1);
    expect(res.skipped).toBe(4);
  });

  it("reads the website's field names and test flag", () => {
    const res = parsePayload(
      body(
        [
          { event_id: "e_00000010", event: "booking_page_view", booking_flow: "quiz_v2_time_first", step_name: "intro", entry_therapist: "319" },
          { event_id: "e_00000011", event: "booking_details_submitted", who: "Couples" },
          { event_id: "e_00000012", event: "booking_payment_initiated", amount: "95", package_id: "pay-as-you-go" },
          { event_id: "e_00000013", event: "booking_page_redirect", page_variant: "control", therapist: "Lisa Kelly" },
        ],
        { is_test: true },
      ),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rows[0]).toMatchObject({ booking_flow: "quiz_v2_time_first", therapist_id: 319, entry_therapist: "319", is_test: true });
    expect(res.rows[1].service).toBe("couples");
    expect(res.rows[2].amount).toBe(95);
    expect(res.rows[3].page_variant).toBe("control");
  });

  it("accepts a single event object", () => {
    const res = parsePayload({ session_id: SESSION, flow: "hub", event: { event_id: "e_00000005", event: "booking_page_view" } }, NOW);
    expect(res.ok && res.rows[0].flow).toBe("hub");
  });

  it("rejects bad session, flow, empty or oversized batches", () => {
    expect(parsePayload(null, NOW)).toEqual({ ok: false, error: "invalid_body" });
    expect(parsePayload(body([], { session_id: "x" }), NOW)).toEqual({ ok: false, error: "invalid_session_id" });
    expect(parsePayload(body([], { flow: "app" }), NOW)).toEqual({ ok: false, error: "invalid_flow" });
    expect(parsePayload(body([]), NOW)).toEqual({ ok: false, error: "no_events" });
    const many = Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ event_id: `e_${String(i).padStart(8, "0")}`, event: "booking_page_view" }));
    expect(parsePayload(body(many), NOW)).toEqual({ ok: false, error: "too_many_events" });
  });

  it("lets an event override the context page and drops unknown devices", () => {
    const res = parsePayload(
      body([{ event_id: "e_00000006", event: "booking_page_redirect", page: "/our-therapists/?x=1#a" }], { context: { device: "fridge" } }),
      NOW,
    );
    expect(res.ok && res.rows[0]).toMatchObject({ page: "/our-therapists/", device: null });
  });
});

describe("helpers", () => {
  it("text trims, cuts and nulls empties", () => {
    expect(text("  hi  ", 10)).toBe("hi");
    expect(text("abcdef", 3)).toBe("abc");
    expect(text("   ", 3)).toBeNull();
    expect(text(42, 5)).toBe("42");
    expect(text({}, 5)).toBeNull();
  });

  it("int accepts digit strings within range", () => {
    expect(int("319", 1, 1000)).toBe(319);
    expect(int(2.5, 0, 10)).toBeNull();
    expect(int(-1, 0, 10)).toBeNull();
    expect(int("3a", 0, 10)).toBeNull();
  });

  it("amount accepts euro values only", () => {
    expect(amount(85.555)).toBe(85.56);
    expect(amount("271.50")).toBe(271.5);
    expect(amount(-1)).toBeNull();
    expect(amount("abc")).toBeNull();
  });

  it("pagePath keeps only the path", () => {
    expect(pagePath("https://fettle.ie/book-a-session/?t=319&email=x")).toBe("/book-a-session/");
    expect(pagePath("/packages?fs=abc")).toBe("/packages");
    expect(pagePath("")).toBeNull();
  });

  it("occurredAt falls back to now for missing or skewed times", () => {
    const now = new Date(NOW).toISOString();
    expect(occurredAt(undefined, NOW)).toBe(now);
    expect(occurredAt(NOW - 2 * 86_400_000, NOW)).toBe(now);
    expect(occurredAt("2026-11-04T11:59:00Z", NOW)).toBe("2026-11-04T11:59:00.000Z");
  });

  it("allowedOrigins adds extras without trailing slashes", () => {
    const set = allowedOrigins(" https://staging.fettle.ie/ , http://localhost:8080");
    expect(set.has("https://fettle.ie")).toBe(true);
    expect(set.has("https://staging.fettle.ie")).toBe(true);
    expect(set.has("http://localhost:8080")).toBe(true);
  });

  it("retentionCutoff is 13 months back", () => {
    expect(retentionCutoff(NOW)).toBe("2025-10-05T12:00:00.000Z");
  });

  it("RateLimiter limits per key per window", () => {
    const rl = new RateLimiter(10, 60_000);
    expect(rl.take("a", 8, 0)).toBe(true);
    expect(rl.take("a", 3, 1000)).toBe(false);
    expect(rl.take("b", 3, 1000)).toBe(true);
    expect(rl.take("a", 3, 60_000)).toBe(true);
  });
});
