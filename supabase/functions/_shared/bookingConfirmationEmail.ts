// The "you're booked" email for every booking path: card payment
// (confirm-payment-and-book, send-booking-confirmation), referral credit
// (book-with-credit) and bundle credit (send-credit-used-confirmation).
// Look, colours and footer follow the emails Fettle's content team supplied
// (portal-adoption-emails/templates.ts): logo banner, warm beige page, Fettle
// orange, white rounded cards. Transactional, so no unsubscribe link.

export const HUB_SESSIONS_URL = "https://my.fettle.ie/sessions";
const DEFAULT_TIMEZONE = "Europe/Dublin";
const LOGO_URL =
  "https://d3k81ch9hvuctc.cloudfront.net/company/SX4DGx/images/25addbe4-7b73-47d2-ae58-e783b9614848.png";

const ORANGE = "#f47d31";
const ORANGE_DARK = "#c2410c";
const INK = "#1c1e24";
const BODY = "#5d544b";
const MUTED = "#7d7269";
const LINE = "#efe9e2";
const PAGE = "#f5f3f0";
const SOFT = "#fbf9f6";
const FONT = "Arial, Helvetica, sans-serif";

export type BookingPayment =
  | { kind: "card"; amountCents: number; receiptUrl?: string | null }
  | { kind: "referral" }
  | { kind: "bundle"; packageName: string; remainingSessions: number; totalSessions: number };

export interface BookingConfirmationInput {
  firstName: string;
  sessionType: string;
  therapistName: string;
  /** e.g. "Wednesday, 30 December 2026" */
  dateLabel: string;
  /** e.g. "7:00pm GMT" */
  timeLabel: string;
  payment: BookingPayment;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Date and time in the client's timezone: "Wednesday, 30 December 2026", "7:00pm GMT". */
export function formatSessionWhen(datetime: string, timezone?: string | null): { dateLabel: string; timeLabel: string } {
  const timeZone = timezone || DEFAULT_TIMEZONE;
  const d = new Date(datetime);
  const dateLabel = d.toLocaleDateString("en-IE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  });
  const clock = d
    .toLocaleTimeString("en-IE", { hour: "numeric", minute: "2-digit", hour12: true, timeZone })
    .replace(/\s?([ap])\.?m\.?/i, (_m, a: string) => `${a.toLowerCase()}m`);
  const zone = d.toLocaleTimeString("en-IE", { timeZoneName: "short", timeZone }).split(" ").pop() || "";
  return { dateLabel, timeLabel: zone ? `${clock} ${zone}` : clock };
}

function euro(cents: number): string {
  return `&euro;${(Math.round(cents) / 100).toFixed(2)}`;
}

function detailRow(label: string, value: string, last = false): string {
  return `<tr><td style="padding:${last ? "12px 0 0 0" : "12px 0"};${last ? "" : ` border-bottom:1px solid ${LINE};`} font-family:${FONT};">
<div style="font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:${MUTED}; padding-bottom:3px;">${label}</div>
<div style="font-size:17px; line-height:24px; font-weight:700; color:${INK};">${value}</div>
</td></tr>`;
}

function paymentBlock(p: BookingPayment): string {
  if (p.kind === "card") {
    const receipt = p.receiptUrl
      ? `<div style="padding-top:6px;"><a href="${escapeHtml(p.receiptUrl)}" target="_blank" style="color:${ORANGE_DARK}; font-weight:700; text-decoration:underline;">View your receipt</a></div>`
      : "";
    return `<div style="font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:${MUTED}; padding-bottom:3px;">Amount paid</div>
<div style="font-size:24px; line-height:30px; font-weight:800; color:${INK};">${euro(p.amountCents)}</div>${receipt}`;
  }
  if (p.kind === "referral") {
    return `<div style="font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:${MUTED}; padding-bottom:3px;">Paid with</div>
<div style="font-size:18px; line-height:26px; font-weight:800; color:${INK};">Your referral credit</div>
<div style="font-size:15px; line-height:22px; color:${BODY};">Nothing was charged to your card.</div>`;
  }
  const total = Math.max(p.totalSessions, 1);
  const left = Math.max(Math.min(p.remainingSessions, total), 0);
  const percent = Math.round((left / total) * 100);
  const low = left <= 2
    ? `<div style="font-size:14px; line-height:21px; color:${ORANGE_DARK}; font-weight:700; padding-top:10px;">${left === 0 ? "That was the last session in this bundle." : "You&rsquo;re running low."} You can buy another bundle in My Fettle.</div>`
    : "";
  return `<div style="font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:${MUTED}; padding-bottom:3px;">Paid with your bundle</div>
<div style="font-size:18px; line-height:26px; font-weight:800; color:${INK};">${left} of ${total} session${total === 1 ? "" : "s"} left</div>
<div style="font-size:14px; line-height:20px; color:${BODY}; padding-bottom:10px;">${escapeHtml(p.packageName)}</div>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${LINE}; border-radius:999px;"><tr><td width="${percent}%" style="width:${percent}%; background:${ORANGE}; border-radius:999px; font-size:1px; line-height:10px; height:10px;">&nbsp;</td><td style="font-size:1px; line-height:10px;">&nbsp;</td></tr></table>${low}`;
}

function step(n: number, title: string, text: string): string {
  return `<tr><td valign="top" width="44" style="padding:0 0 16px 0;"><div style="font-family:${FONT}; background:${ORANGE}; color:#ffffff; width:30px; height:30px; line-height:30px; border-radius:999px; text-align:center; font-size:14px; font-weight:800;">${n}</div></td>
<td valign="top" style="padding:3px 0 16px 0; font-family:${FONT};"><div style="font-size:16px; line-height:22px; font-weight:800; color:${INK};">${title}</div><div style="font-size:15px; line-height:23px; color:${BODY};">${text}</div></td></tr>`;
}

export function bookingConfirmationHtml(input: BookingConfirmationInput): string {
  const firstName = escapeHtml(input.firstName?.trim() || "there");
  const therapist = escapeHtml(input.therapistName?.trim() || "your therapist");
  const therapistFirst = escapeHtml((input.therapistName?.trim() || "").split(/\s+/)[0] || "your therapist");
  const sessionType = escapeHtml(input.sessionType?.trim() || "Therapy session");
  const date = escapeHtml(input.dateLabel);
  const time = escapeHtml(input.timeLabel);
  const preview = `${date} at ${time} with ${therapist}.`;

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>You&rsquo;re booked</title>
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    table { border-collapse: collapse !important; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; display: block; }
    body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${PAGE}; }
    a { text-decoration: none; }
    @media screen and (max-width: 640px) {
      .container { width: 100% !important; }
      .mobile-pad { padding-left: 18px !important; padding-right: 18px !important; }
      .card-pad { padding: 22px !important; }
      .hero-title { font-size: 28px !important; line-height: 34px !important; }
      .button { display: block !important; width: 100% !important; box-sizing: border-box !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:${PAGE};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${preview}</div>
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${PAGE};">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" width="640" border="0" cellspacing="0" cellpadding="0" class="container" style="width:640px; max-width:640px; background:#ffffff; border-radius:24px;">

          <!-- LOGO -->
          <tr>
            <td align="center" style="padding:0;">
              <img src="${LOGO_URL}" alt="Fettle" width="640" style="width:100%; max-width:640px; height:auto; border-radius:24px 24px 0 0;" />
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td class="mobile-pad" align="center" style="padding:34px 40px 6px 40px; font-family:${FONT};">
              <div style="background:#e7f6ee; color:#17a86b; width:56px; height:56px; line-height:56px; border-radius:999px; text-align:center; font-size:28px; font-weight:800; margin:0 auto;">&#10003;</div>
              <div class="hero-title" style="padding:16px 0 8px 0; font-size:31px; line-height:37px; font-weight:800; color:${INK};">You&rsquo;re booked, ${firstName}!</div>
              <div style="font-size:17px; line-height:27px; color:${BODY}; max-width:470px; margin:0 auto;">Your session with ${therapist} is confirmed. Here are the details.</div>
            </td>
          </tr>

          <!-- SESSION DETAILS -->
          <tr>
            <td class="mobile-pad" style="padding:24px 40px 0 40px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${SOFT}; border:1px solid ${LINE}; border-radius:20px; border-collapse:separate !important;">
                <tr>
                  <td class="card-pad" style="padding:16px 26px 20px 26px;">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
${detailRow("Date", date)}
${detailRow("Time", time)}
${detailRow("Therapist", therapist)}
${detailRow("Session", sessionType, true)}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- PAYMENT -->
          <tr>
            <td class="mobile-pad" style="padding:14px 40px 0 40px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#fff2e3; border-radius:20px; border-collapse:separate !important;">
                <tr>
                  <td class="card-pad" style="padding:20px 26px; font-family:${FONT};">
${paymentBlock(input.payment)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- WHAT HAPPENS NEXT -->
          <tr>
            <td class="mobile-pad" style="padding:30px 40px 6px 40px; font-family:${FONT};">
              <div style="font-size:14px; line-height:18px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; color:${ORANGE_DARK}; padding-bottom:16px;">What happens next</div>
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
${step(1, "Look out for your session link", "We&rsquo;ll text and email your secure log-in details before the session.")}
${step(2, `Meet ${therapistFirst} online`, "Find a quiet, private spot. That&rsquo;s all you need.")}
${step(3, "Manage it in My Fettle", "See your upcoming sessions and book your next one whenever suits you.")}
              </table>
            </td>
          </tr>

          <!-- BUTTON -->
          <tr>
            <td class="mobile-pad" align="center" style="padding:6px 40px 10px 40px;">
              <a class="button" href="${HUB_SESSIONS_URL}" target="_blank" style="display:inline-block; background:${ORANGE}; color:#ffffff; font-family:${FONT}; font-size:16px; line-height:20px; font-weight:700; padding:14px 30px; border-radius:999px;">View my sessions</a>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" align="center" style="padding:10px 54px 26px 54px; font-family:${FONT}; font-size:14px; line-height:22px; color:${MUTED};">
              Need to reschedule or cancel? Please let us know at least 48 hours before your session.
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="mobile-pad" style="padding:4px 32px 28px 32px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:20px;">
                <tr>
                  <td class="card-pad" style="padding:26px 28px 24px 28px; font-family:${FONT}; color:${INK};">
                    <div style="font-size:18px; line-height:30px; color:${INK}; padding-bottom:22px;">
                      Warmly,<br />
                      The Fettle Team
                    </div>
                    <div style="border-top:1px solid ${INK}; font-size:1px; line-height:1px;">&nbsp;</div>
                    <div style="padding:22px 0 10px 0; text-align:center;">
                      <div style="font-size:22px; line-height:30px; font-weight:700; color:${INK}; padding-bottom:8px;">
                        Got a question? We&rsquo;re here to help
                      </div>
                      <div style="font-size:16px; line-height:26px; color:${BODY};">
                        Email us at
                        <a href="mailto:hello@fettle.ie" style="color:#2563eb; text-decoration:underline;">hello@fettle.ie</a>
                        or call
                        <a href="tel:19125688" style="color:#2563eb; text-decoration:underline;">1 912 5688</a>
                        during office hours and a member of our team will be happy to help.
                      </div>
                    </div>
                    <div style="padding:18px 0 18px 0; text-align:center;">
                      <a href="https://x.com/fettletherapy" target="_blank" style="display:inline-block; padding:0 10px;">
                        <img src="https://cdn-icons-png.flaticon.com/512/733/733579.png" alt="X" width="18" style="width:18px; height:18px; display:inline-block;" />
                      </a>
                      <a href="https://www.facebook.com/fettletherapy" target="_blank" style="display:inline-block; padding:0 10px;">
                        <img src="https://cdn-icons-png.flaticon.com/512/733/733547.png" alt="Facebook" width="18" style="width:18px; height:18px; display:inline-block;" />
                      </a>
                      <a href="https://www.instagram.com/fettle.therapy" target="_blank" style="display:inline-block; padding:0 10px;">
                        <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="18" style="width:18px; height:18px; display:inline-block;" />
                      </a>
                    </div>
                    <div style="text-align:center; font-size:13px; line-height:22px; color:${MUTED};">
                      Fettle Therapy Unit 1 Block K, Monavalley Business Park, Tralee, Co. Kerry V92H5KW
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text version for clients whose mail app doesn't show HTML. */
export function bookingConfirmationText(input: BookingConfirmationInput): string {
  const p = input.payment;
  const payment = p.kind === "card"
    ? `Amount paid: €${(p.amountCents / 100).toFixed(2)}${p.receiptUrl ? `\nReceipt: ${p.receiptUrl}` : ""}`
    : p.kind === "referral"
    ? "Paid with your referral credit. Nothing was charged to your card."
    : `Paid with your bundle: ${p.remainingSessions} of ${p.totalSessions} sessions left (${p.packageName}).`;
  return [
    `You're booked, ${input.firstName?.trim() || "there"}!`,
    "",
    `Date: ${input.dateLabel}`,
    `Time: ${input.timeLabel}`,
    `Therapist: ${input.therapistName || "Your therapist"}`,
    `Session: ${input.sessionType || "Therapy session"}`,
    "",
    payment,
    "",
    "We'll text and email your secure log-in details before the session.",
    `View your sessions: ${HUB_SESSIONS_URL}`,
    "",
    "Need to reschedule or cancel? Please let us know at least 48 hours before your session.",
    "Questions? Email hello@fettle.ie or call 1 912 5688.",
    "",
    "Warmly,",
    "The Fettle Team",
  ].join("\n");
}
