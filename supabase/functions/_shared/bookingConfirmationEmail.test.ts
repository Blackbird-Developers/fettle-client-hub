import { describe, expect, it } from "vitest";
import {
  type BookingConfirmationInput,
  HUB_SESSIONS_URL,
  bookingConfirmationHtml,
  bookingConfirmationText,
  formatSessionWhen,
} from "./bookingConfirmationEmail";

const base: BookingConfirmationInput = {
  firstName: "Ernest",
  sessionType: "Individual Session with Ida Blazek",
  therapistName: "Ida Blazek",
  dateLabel: "Wednesday 30 December 2026",
  timeLabel: "7:00pm GMT",
  payment: { kind: "card", amountCents: 9500, receiptUrl: "https://pay.stripe.com/receipts/abc" },
};

describe("formatSessionWhen", () => {
  it("formats the session in Irish time with the zone", () => {
    const { dateLabel, timeLabel } = formatSessionWhen("2026-12-30T19:00:00+0000", "Europe/Dublin");
    expect(dateLabel).toContain("30 December 2026");
    expect(dateLabel).toContain("Wednesday");
    expect(timeLabel).toBe("7:00pm GMT");
  });

  it("uses the client's own timezone when given", () => {
    expect(formatSessionWhen("2026-12-30T19:00:00+0000", "Europe/Belgrade").timeLabel).toMatch(/^8:00pm /);
  });
});

describe("bookingConfirmationHtml", () => {
  it("shows the session, the amount paid, the receipt and the sessions link", () => {
    const html = bookingConfirmationHtml(base);
    expect(html).toContain("You&rsquo;re booked, Ernest!");
    expect(html).toContain("Wednesday 30 December 2026");
    expect(html).toContain("7:00pm GMT");
    expect(html).toContain("Ida Blazek");
    expect(html).toContain("&euro;95.00");
    expect(html).toContain("https://pay.stripe.com/receipts/abc");
    expect(html).toContain(HUB_SESSIONS_URL);
    expect(html).toContain("48 hours");
    expect(html).not.toContain("24 hours");
  });

  it("uses the hub-hosted logo with a text fallback", () => {
    const html = bookingConfirmationHtml(base);
    expect(html).toContain('src="https://my.fettle.ie/email/fettle-logo.png"');
    expect(html).toContain('alt="Fettle.ie"');
  });

  it("says referral credit paid and nothing was charged", () => {
    const html = bookingConfirmationHtml({ ...base, payment: { kind: "referral" } });
    expect(html).toContain("Referral credit (nothing charged)");
    expect(html).not.toContain("&euro;");
  });

  it("shows bundle sessions left and warns when running low", () => {
    const html = bookingConfirmationHtml({
      ...base,
      payment: { kind: "bundle", packageName: "6 Session Bundle", remainingSessions: 2, totalSessions: 6 },
    });
    expect(html).toContain("2 of 6 sessions left");
    expect(html).toContain("You&rsquo;re running low.");
  });

  it("escapes names typed by the client", () => {
    const html = bookingConfirmationHtml({ ...base, firstName: "<b>Al</b>" });
    expect(html).toContain("&lt;b&gt;Al&lt;/b&gt;");
    expect(html).not.toContain("<b>Al</b>");
  });

  it("has a plain-text version with the same details", () => {
    const text = bookingConfirmationText(base);
    expect(text).toContain("You're booked, Ernest!");
    expect(text).toContain("Time: 7:00pm GMT");
    expect(text).toContain("Amount paid: €95.00");
  });
});
