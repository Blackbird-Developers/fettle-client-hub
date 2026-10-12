import { describe, expect, it } from "vitest";
import {
  type SendRecord,
  SIGNATURE_TOLERANCE_SECONDS,
  eventEffect,
  signSvix,
  verifySvixSignature,
} from "./logic.ts";

const SECRET = `whsec_${btoa("a-test-signing-secret-32-bytes!!")}`;
const NOW = 1_791_800_000;
const BODY = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });

async function headersFor(body: string, timestamp = NOW, secret = SECRET) {
  const signature = await signSvix(secret, "msg_1", String(timestamp), body);
  return { id: "msg_1", timestamp: String(timestamp), signature: `v1,${signature}` };
}

describe("verifySvixSignature", () => {
  it("accepts a correctly signed event", async () => {
    expect(await verifySvixSignature(SECRET, await headersFor(BODY), BODY, NOW)).toBe(true);
  });

  it("accepts any matching signature in a rotated list", async () => {
    const headers = await headersFor(BODY);
    headers.signature = `v1,bm90LWl0 ${headers.signature}`;
    expect(await verifySvixSignature(SECRET, headers, BODY, NOW)).toBe(true);
  });

  it("rejects a changed body, another secret or missing headers", async () => {
    const headers = await headersFor(BODY);
    expect(await verifySvixSignature(SECRET, headers, BODY.replace("abc", "xyz"), NOW)).toBe(false);
    expect(
      await verifySvixSignature(`whsec_${btoa("another-secret")}`, headers, BODY, NOW)
    ).toBe(false);
    expect(await verifySvixSignature(SECRET, { ...headers, signature: null }, BODY, NOW)).toBe(false);
  });

  it("rejects old or future timestamps", async () => {
    const old = NOW - SIGNATURE_TOLERANCE_SECONDS - 1;
    expect(await verifySvixSignature(SECRET, await headersFor(BODY, old), BODY, NOW)).toBe(false);
    const future = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
    expect(await verifySvixSignature(SECRET, await headersFor(BODY, future), BODY, NOW)).toBe(false);
  });
});

describe("eventEffect", () => {
  const blank: SendRecord = {
    delivered_at: null,
    opened_at: null,
    first_clicked_at: null,
    click_count: 0,
    bounced_at: null,
    complained_at: null,
  };
  const AT = "2026-10-12T09:31:00Z";

  it("stamps the first delivery and open only", () => {
    expect(eventEffect("email.delivered", AT, blank).update).toEqual({ delivered_at: AT });
    expect(eventEffect("email.delivered", AT, { ...blank, delivered_at: "earlier" }).update).toEqual({});
    expect(eventEffect("email.opened", AT, blank).update).toEqual({ opened_at: AT });
  });

  it("counts every click and treats a click as an open", () => {
    expect(eventEffect("email.clicked", AT, blank).update).toEqual({
      click_count: 1,
      first_clicked_at: AT,
      opened_at: AT,
    });
    const clicked = { ...blank, click_count: 1, first_clicked_at: "earlier", opened_at: "earlier" };
    expect(eventEffect("email.clicked", AT, clicked).update).toEqual({ click_count: 2 });
  });

  it("suppresses the address on a bounce or complaint", () => {
    expect(eventEffect("email.bounced", AT, blank)).toEqual({
      update: { bounced_at: AT },
      suppress: "bounced",
    });
    expect(eventEffect("email.complained", AT, blank).suppress).toBe("complained");
  });

  it("ignores other event types", () => {
    expect(eventEffect("email.sent", AT, blank)).toEqual({ update: {}, suppress: null });
    expect(eventEffect("email.delivery_delayed", AT, blank)).toEqual({ update: {}, suppress: null });
  });
});
