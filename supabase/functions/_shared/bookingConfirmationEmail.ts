// The "you're booked" email for every booking path: card payment
// (confirm-payment-and-book, send-booking-confirmation), referral credit
// (book-with-credit) and bundle credit (send-credit-used-confirmation).
// Kept short on purpose: Fettle's logo and colours (from the emails Fettle's
// content team supplied, portal-adoption-emails/templates.ts), the session
// details, one button and a short footer. Transactional, so no unsubscribe
// link.

export const HUB_SESSIONS_URL = "https://my.fettle.ie/sessions";
const DEFAULT_TIMEZONE = "Europe/Dublin";
// Served from the hub (public/email/fettle-logo.png), so it does not depend
// on another service.
const LOGO_URL = "https://my.fettle.ie/email/fettle-logo.png";

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
  /** A moved session (acuity reschedule): "Your session has moved" heading, no Paid row. */
  rescheduled?: boolean;
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
  return `<tr><td style="padding:${last ? "11px 0 0 0" : "11px 0"};${last ? "" : ` border-bottom:1px solid ${LINE};`} font-family:${FONT};">
<div style="font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:${MUTED}; padding-bottom:2px;">${label}</div>
<div style="font-size:16px; line-height:23px; font-weight:700; color:${INK};">${value}</div>
</td></tr>`;
}

/** The "Paid" row: amount and receipt, referral credit, or bundle sessions left. */
function paymentValue(p: BookingPayment): string {
  if (p.kind === "card") {
    const receipt = p.receiptUrl
      ? ` &middot; <a href="${escapeHtml(p.receiptUrl)}" target="_blank" style="color:${ORANGE_DARK}; font-weight:700; text-decoration:underline;">Receipt</a>`
      : "";
    return `${euro(p.amountCents)}${receipt}`;
  }
  if (p.kind === "referral") return "Referral credit (nothing charged)";
  const total = Math.max(p.totalSessions, 1);
  const left = Math.max(Math.min(p.remainingSessions, total), 0);
  const low = left <= 2
    ? `<div style="font-size:14px; line-height:20px; font-weight:700; color:${ORANGE_DARK}; padding-top:2px;">${left === 0 ? "That was your last bundle session." : "You&rsquo;re running low."} You can buy another bundle in My Fettle.</div>`
    : "";
  return `Bundle &middot; ${left} of ${total} session${total === 1 ? "" : "s"} left${low}`;
}

export function bookingConfirmationHtml(input: BookingConfirmationInput): string {
  const firstName = escapeHtml(input.firstName?.trim() || "there");
  const therapist = escapeHtml(input.therapistName?.trim() || "your therapist");
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
  <title>${input.rescheduled ? "Session moved" : "You&rsquo;re booked"}</title>
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
      .card-pad { padding: 4px 20px 16px 20px !important; }
      .hero-title { font-size: 26px !important; line-height: 32px !important; }
      .button { display: block !important; width: 100% !important; box-sizing: border-box !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background:${PAGE};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${preview}</div>
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${PAGE};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" border="0" cellspacing="0" cellpadding="0" class="container" style="width:600px; max-width:600px; background:#ffffff; border-radius:24px; border-top:6px solid ${ORANGE};">

          <!-- LOGO (styled alt text stands in when a mail app hides images) -->
          <tr>
            <td align="center" style="padding:26px 40px 4px 40px;">
              <img src="${LOGO_URL}" alt="Fettle.ie" width="520" style="width:100%; max-width:520px; height:auto; color:${ORANGE}; font-family:${FONT}; font-size:30px; line-height:40px; font-weight:800; text-align:center;" />
            </td>
          </tr>

          <!-- HEADING -->
          <tr>
            <td class="mobile-pad" align="center" style="padding:10px 40px 0 40px; font-family:${FONT};">
              <div class="hero-title" style="font-size:28px; line-height:34px; font-weight:800; color:${INK};">${input.rescheduled ? `Your session has moved, ${firstName}!` : `You&rsquo;re booked, ${firstName}!`}</div>
              <div style="font-size:16px; line-height:25px; color:${BODY}; padding-top:8px;">We&rsquo;ll text and email your session link before the session.</div>
            </td>
          </tr>

          <!-- DETAILS -->
          <tr>
            <td class="mobile-pad" style="padding:22px 40px 0 40px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${SOFT}; border:1px solid ${LINE}; border-radius:18px; border-collapse:separate !important;">
                <tr>
                  <td class="card-pad" style="padding:6px 24px 16px 24px;">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
${detailRow("When", `${date} at ${time}`)}
${detailRow("Therapist", therapist)}
${input.rescheduled ? detailRow("Session", sessionType, true) : `${detailRow("Session", sessionType)}
${detailRow("Paid", paymentValue(input.payment), true)}`}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- BUTTON -->
          <tr>
            <td class="mobile-pad" align="center" style="padding:24px 40px 0 40px;">
              <a class="button" href="${HUB_SESSIONS_URL}" target="_blank" style="display:inline-block; background:${ORANGE}; color:#ffffff; font-family:${FONT}; font-size:16px; line-height:20px; font-weight:700; padding:14px 30px; border-radius:999px;">View my sessions</a>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td class="mobile-pad" align="center" style="padding:22px 40px 28px 40px; font-family:${FONT}; font-size:14px; line-height:22px; color:${MUTED};">
              Need to reschedule or cancel? Let us know at least 48 hours before your session.<br />
              Questions? <a href="mailto:hello@fettle.ie" style="color:${ORANGE_DARK}; text-decoration:underline;">hello@fettle.ie</a> &middot; <a href="tel:19125688" style="color:${ORANGE_DARK}; text-decoration:underline;">1 912 5688</a>
              <div style="padding-top:14px; font-size:13px; color:${MUTED};">Warmly, the Fettle Team</div>
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
    input.rescheduled
      ? `Your session has moved, ${input.firstName?.trim() || "there"}!`
      : `You're booked, ${input.firstName?.trim() || "there"}!`,
    "",
    `Date: ${input.dateLabel}`,
    `Time: ${input.timeLabel}`,
    `Therapist: ${input.therapistName || "Your therapist"}`,
    `Session: ${input.sessionType || "Therapy session"}`,
    "",
    ...(input.rescheduled ? [] : [payment, ""]),
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
