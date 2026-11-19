import { describe, expect, it } from "vitest";
import { dublinHour, isExcludedPath, outageDismissKey, phoneLinesOpen, whatsappHref } from "./outageNotice";

describe("outageNotice", () => {
  it("builds a WhatsApp link with the prefilled text encoded", () => {
    expect(whatsappHref("35319131090", "Hi Fettle, I'm here")).toBe(
      "https://wa.me/35319131090?text=Hi%20Fettle%2C%20I'm%20here",
    );
  });

  it("excludes admin pages but not customer pages", () => {
    expect(isExcludedPath("/admin")).toBe(true);
    expect(isExcludedPath("/admin/")).toBe(true);
    expect(isExcludedPath("/Admin/clients")).toBe(true);
    expect(isExcludedPath("/administrator")).toBe(false);
    expect(isExcludedPath("/dashboard")).toBe(false);
    expect(isExcludedPath("/login")).toBe(false);
  });

  it("treats 9:00 to 16:59 as open", () => {
    expect(phoneLinesOpen(8)).toBe(false);
    expect(phoneLinesOpen(9)).toBe(true);
    expect(phoneLinesOpen(16)).toBe(true);
    expect(phoneLinesOpen(17)).toBe(false);
    expect(phoneLinesOpen(null)).toBeNull();
  });

  it("reads the hour in Irish time", () => {
    // 13 Nov is winter time, so Dublin = UTC
    expect(dublinHour(new Date("2026-11-13T08:30:00Z"))).toBe(8);
    // 1 Jul is summer time, so Dublin = UTC+1
    expect(dublinHour(new Date("2026-07-01T08:30:00Z"))).toBe(9);
  });

  it("keys 'seen' by outage, user and sign-in", () => {
    expect(outageDismissKey("a", "u1", "t1")).toBe(outageDismissKey("a", "u1", "t1"));
    expect(outageDismissKey("a", "u1", "t1")).not.toBe(outageDismissKey("b", "u1", "t1"));
    expect(outageDismissKey("a", "u1", "t1")).not.toBe(outageDismissKey("a", "u2", "t1"));
    // signing in again = new login session = shown again
    expect(outageDismissKey("a", "u1", "t1")).not.toBe(outageDismissKey("a", "u1", "t2"));
  });
});
