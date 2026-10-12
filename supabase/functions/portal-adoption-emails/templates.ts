// The two portal-adoption emails, as supplied by the content team
// ("My Fettle Automation 1 – Existing Clients" and "Automation 2 – New
// Enquiries"). Copy, layout and colours are theirs; the only changes are:
//   - Klaviyo tags replaced: {{ first_name|default:'there' }} → firstName,
//     {{ unsubscribe_link }} → our signed unsubscribe link
//   - every my.fettle.ie/dashboard link → ctaUrl (the sign-up page with the
//     email filled in and utm tags), since these readers have no account yet
//     and /dashboard would send them to the login page
//   - a solid background colour (and bgcolor) behind each gradient, so the
//     white text never sits on white where gradients aren't supported
//   - the internal notes in <head> removed (recipients could read them)
// Plain-text versions are ours, written from the same copy.

import type { Campaign } from "./logic.ts";

export interface TemplateInput {
  firstName: string | null;
  ctaUrl: string;
  unsubscribeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const SUBJECTS: Record<Campaign, string> = {
  existing_clients: "Your Fettle account is waiting",
  new_enquiries: "Start your Fettle journey your way",
};

const PREVIEWS: Record<Campaign, string> = {
  existing_clients: "Book, manage and track your sessions in one place, whenever suits you.",
  new_enquiries: "Create your My Fettle account, then book when you're ready.",
};

export function renderEmail(campaign: Campaign, input: TemplateInput): RenderedEmail {
  const values = {
    firstName: escapeHtml(input.firstName?.trim() || "there"),
    ctaUrl: escapeHtml(input.ctaUrl),
    unsubscribeUrl: escapeHtml(input.unsubscribeUrl),
  };
  const html = campaign === "existing_clients" ? existingClientsHtml(values) : newEnquiriesHtml(values);
  const text = campaign === "existing_clients"
    ? existingClientsText(input)
    : newEnquiriesText(input);
  return { subject: SUBJECTS[campaign], html, text };
}

// ---------------------------------------------------------------------------
// Shared pieces (identical in both supplied files)
// ---------------------------------------------------------------------------

const HEAD_STYLES = `
  <style>
    body, table, td, a {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    table {
      border-collapse: collapse !important;
    }
    img {
      border: 0;
      outline: none;
      text-decoration: none;
      -ms-interpolation-mode: bicubic;
      display: block;
    }
    body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: 100% !important;
      background-color: #f5f3f0;
    }
    a {
      text-decoration: none;
    }
    @media screen and (max-width: 640px) {
      .container {
        width: 100% !important;
      }
      .mobile-pad {
        padding-left: 18px !important;
        padding-right: 18px !important;
      }
      .stack {
        display: block !important;
        width: 100% !important;
      }
      .hero-title {
        font-size: 30px !important;
        line-height: 36px !important;
      }
      .hero-sub {
        font-size: 16px !important;
        line-height: 26px !important;
      }
      .body-copy {
        font-size: 17px !important;
        line-height: 28px !important;
      }
      .card-pad {
        padding: 22px !important;
      }
      .button {
        display: block !important;
        width: 100% !important;
        box-sizing: border-box !important;
      }
    }
      @media screen and (max-width: 640px) {
      .grid-cell {
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .tight {
        padding-left: 14px !important;
        padding-right: 14px !important;
      }
    }
  </style>`;

function head(title: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${title}</title>${HEAD_STYLES}
</head>`;
}

const LOGO_ROW = `
          <!-- LOGO -->
          <tr>
            <td align="center" style="padding:0;">
              <img src="https://d3k81ch9hvuctc.cloudfront.net/company/SX4DGx/images/25addbe4-7b73-47d2-ae58-e783b9614848.png" alt="Fettle" width="640" style="width:100%; max-width:640px; height:auto; border-radius:24px 24px 0 0;" />
            </td>
          </tr>`;

const DAY_PICKER = `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr><td width="20%" align="center" style="padding:0 3px;"><div style="font-family:Arial, Helvetica, sans-serif; background:#ffffff; color:#7d7269; border:1px solid #efe9e2; border-radius:12px; padding:9px 0; font-size:13px; line-height:16px;">Mon</div></td><td width="20%" align="center" style="padding:0 3px;"><div style="font-family:Arial, Helvetica, sans-serif; background:#ffffff; color:#7d7269; border:1px solid #efe9e2; border-radius:12px; padding:9px 0; font-size:13px; line-height:16px;">Tue</div></td><td width="20%" align="center" style="padding:0 3px;"><div style="font-family:Arial, Helvetica, sans-serif; background:#f47d31; color:#ffffff; font-weight:800; border-radius:12px; padding:9px 0; font-size:13px; line-height:16px;">Wed</div></td><td width="20%" align="center" style="padding:0 3px;"><div style="font-family:Arial, Helvetica, sans-serif; background:#ffffff; color:#7d7269; border:1px solid #efe9e2; border-radius:12px; padding:9px 0; font-size:13px; line-height:16px;">Thu</div></td><td width="20%" align="center" style="padding:0 3px;"><div style="font-family:Arial, Helvetica, sans-serif; background:#ffffff; color:#7d7269; border:1px solid #efe9e2; border-radius:12px; padding:9px 0; font-size:13px; line-height:16px;">Fri</div></td></tr></table>`;

function progressBar(percent: number, color: string): string {
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
<tr><td style="font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:16px; color:#7d7269; font-weight:700; padding-bottom:6px;">Your progress</td><td align="right" style="font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:16px; color:#7d7269; font-weight:700; padding-bottom:6px;">Next milestone</td></tr>
<tr><td colspan="2"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#efe9e2; border-radius:999px;"><tr><td width="${percent}%" style="width:${percent}%; background:${color}; border-radius:999px; font-size:1px; line-height:10px; height:10px;">&nbsp;</td><td style="font-size:1px; line-height:10px;">&nbsp;</td></tr></table></td></tr>
</table>`;
}

const REWARD_NAMES = ["First Step", "Getting Started", "Committed", "Consistent", "Wellness Champion"];

/** The reward ladder; the first `filled` steps are shown as unlocked. */
function rewardLadder(filled: number): string {
  const cells = REWARD_NAMES.map((name, i) => {
    const on = i < filled;
    return `<td width="20%" align="center" valign="top" style="padding:0 2px;"><div style="font-family:Arial, Helvetica, sans-serif; background:${on ? "#6152ca" : "#ffffff"}; color:${on ? "#ffffff" : "#6152ca"}; border:2px solid #6152ca; width:38px; height:38px; line-height:38px; border-radius:999px; margin:0 auto; font-size:15px; font-weight:800; text-align:center;">${i + 1}</div><div style="font-family:Arial, Helvetica, sans-serif; font-size:11px; line-height:14px; color:#5d544b; font-weight:700; padding-top:6px;">${name}</div></td>`;
  }).join("");
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>${cells}</tr></table>`;
}

function packageTile(count: number, biggest: boolean): string {
  if (!biggest) {
    return `<td width="33%" align="center" valign="bottom" style="padding:0 4px;"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff; border:1px solid #efe9e2; border-radius:14px; border-collapse:separate !important;"><tr><td align="center" style="padding:12px 6px 14px 6px; font-family:Arial, Helvetica, sans-serif;"><div style="font-size:1px; line-height:23px;">&nbsp;</div><div style="font-size:30px; line-height:34px; font-weight:800; color:#1c1e24;">${count}</div><div style="font-size:12px; line-height:16px; font-weight:700; color:#7d7269;">sessions</div></td></tr></table></td>`;
  }
  return `<td width="33%" align="center" valign="bottom" style="padding:0 4px;"><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#0d3b72; border:1px solid #efe9e2; border-radius:14px; border-collapse:separate !important;"><tr><td align="center" style="padding:12px 6px 14px 6px; font-family:Arial, Helvetica, sans-serif;"><div style="font-family:Arial, Helvetica, sans-serif; font-size:10px; line-height:14px; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; color:#ffffff; background:#f47d31; border-radius:999px; padding:3px 8px; display:inline-block; margin-bottom:6px;">Biggest saving</div><div style="font-size:30px; line-height:34px; font-weight:800; color:#ffffff;">${count}</div><div style="font-size:12px; line-height:16px; font-weight:700; color:#dbeafe;">sessions</div></td></tr></table></td>`;
}

const PACKAGE_TILES = `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>${packageTile(3, false)}${packageTile(6, false)}${packageTile(9, true)}</tr></table>`;

/** The mock "My Fettle" window frame around a product visual. */
function mockWindow(tab: string | null, body: string): string {
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#fbf9f6; border:1px solid #efe9e2; border-radius:16px; border-collapse:separate !important;">
<tr><td style="padding:10px 14px; border-bottom:1px solid #efe9e2; font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:16px; color:#7d7269; font-weight:700;"><span style="color:#d3c9bd;">&bull; &bull; &bull;</span>&nbsp;&nbsp;<span style="color:#f47d31; font-weight:800;">My Fettle</span>${tab ? ` &middot; ${tab}` : ""}</td></tr>
<tr><td class="tight" style="padding:16px 16px 18px 16px;">${body}</td></tr></table>`;
}

function footer(unsubscribeUrl: string): string {
  return `
          <!-- FOOTER -->
          <tr>
            <td class="mobile-pad" style="padding:4px 32px 28px 32px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:20px;">
                <tr>
                  <td class="card-pad" style="padding:26px 28px 24px 28px; font-family:Arial, Helvetica, sans-serif; color:#1c1e24;">
                    <div style="font-size:18px; line-height:30px; color:#1c1e24; padding-bottom:22px;">
                      Warmly,<br />
                      The Fettle Team
                    </div>
                    <div style="border-top:1px solid #1c1e24; font-size:1px; line-height:1px;">&nbsp;</div>
                    <div style="padding:22px 0 10px 0; text-align:center;">
                      <div style="font-size:22px; line-height:30px; font-weight:700; color:#1c1e24; padding-bottom:8px;">
                        Got a question? We&rsquo;re here to help
                      </div>
                      <div style="font-size:16px; line-height:26px; color:#5d544b;">
                        If you have any questions now or in the future, please email us at
                        <a href="mailto:hello@fettle.ie" style="color:#2563eb; text-decoration:underline;">hello@fettle.ie</a>
                        or call
                        <a href="tel:19125688" style="color:#2563eb; text-decoration:underline;">1 912 5688</a>
                        during office hours and a member of our team will be happy to assist you!
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
                    <div style="text-align:center; font-size:13px; line-height:22px; color:#7d7269;">
                      No longer want to receive these emails?
                      <a href="${unsubscribeUrl}" style="color:#2563eb; text-decoration:underline;">Unsubscribe</a>.<br />
                      Fettle Therapy Unit 1 Block K, Monavalley Business Park, Tralee, Co. Kerry V92H5KW
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
`;
}

function wrap(preview: string, rows: string): string {
  return `
<body style="margin:0; padding:0; background:#f5f3f0;">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">
    ${preview}
  </div>

  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#f5f3f0;">
    <tr>
      <td align="center" style="padding:0;">
        <table role="presentation" width="640" border="0" cellspacing="0" cellpadding="0" class="container" style="width:640px; max-width:640px; background:#ffffff; border-radius:24px;">
${rows}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Gradient hero card with a solid fallback colour and the Outlook VML fill. */
function heroOpen(from: string, to: string): string {
  return `<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" bgcolor="${from}" style="background-color:${from}; background:linear-gradient(135deg, ${from} 0%, ${to} 100%); border-radius:22px;">
                <!--[if gte mso 9]>
                <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:576px;">
                <v:fill type="gradient" color="${from}" color2="${to}" angle="135" />
                <v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">
                <![endif]-->`;
}

const HERO_CLOSE = `
                <!--[if gte mso 9]>
                </v:textbox>
                </v:rect>
                <![endif]-->
              </table>`;

type Values = { firstName: string; ctaUrl: string; unsubscribeUrl: string };

// ---------------------------------------------------------------------------
// Email 1 — existing clients
// ---------------------------------------------------------------------------

function featureCard(
  background: string,
  number: number,
  badge: string,
  title: string,
  description: string,
  ctaUrl: string,
  visual: string
): string {
  return `
          <tr>
            <td class="mobile-pad" style="padding:0 40px 16px 40px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${background}; border-radius:18px;">
                <tr>
                  <td class="card-pad" style="padding:22px 24px 20px 24px; font-family:Arial, Helvetica, sans-serif;">
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>
                      <td width="44" valign="top"><div style="font-family:Arial, Helvetica, sans-serif; width:32px; height:32px; line-height:32px; border-radius:999px; background:${badge}; color:#ffffff; font-size:15px; font-weight:800; text-align:center;">${number}</div></td>
                      <td valign="top"><div style="font-size:18px; line-height:24px; font-weight:800; color:#1c1e24;">${title}</div><div style="font-size:15px; line-height:23px; color:#5d544b; padding-top:3px;">${description}</div></td>
                    </tr></table>
                    <div style="padding-top:14px;"><a href="${ctaUrl}" target="_blank" style="text-decoration:none; display:block;">${visual}</a></div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

function existingClientsHtml(v: Values): string {
  const heroPreview = mockWindow(
    null,
    `<div style="font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#c2410c; padding-bottom:4px;">Next session</div><div style="font-family:Arial, Helvetica, sans-serif; font-size:17px; line-height:23px; font-weight:800; color:#1c1e24; padding-bottom:12px;">Pick a time that suits you</div>${DAY_PICKER}<div style="padding-top:16px;">${progressBar(60, "#f47d31")}</div>`
  );

  const rows = `${LOGO_ROW}

          <!-- HERO -->
          <tr>
            <td class="mobile-pad" style="padding:28px 32px 10px 32px;">
              ${heroOpen("#c2410c", "#fb923c")}
                <tr>
                  <td class="card-pad" align="center" style="padding:40px 36px 36px 36px; font-family:Arial, Helvetica, sans-serif;">
                    <span style="display:inline-block; background:rgba(255,255,255,0.22); color:#ffffff; border-radius:999px; padding:7px 14px; font-size:13px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">
                      My Fettle
                    </span>
                    <div class="hero-title" style="padding:16px 0 12px 0; font-size:31px; line-height:37px; font-weight:800; color:#ffffff;">
                      Everything about your therapy, in one place.
                    </div>
                    <div class="hero-sub" style="font-size:18px; line-height:29px; color:#ffedd5; max-width:460px; margin:0 auto;">
                      You&rsquo;ve been booking by phone or email. My Fettle makes it quicker, and it&rsquo;s built around you.
                    </div>
                    <div style="padding-top:22px;">
                      <a class="button" href="${v.ctaUrl}" target="_blank" style="display:inline-block; background:#0d3b72; color:#ffffff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:20px; font-weight:700; padding:14px 28px; border-radius:999px;">
                        See What&rsquo;s Inside
                      </a>
                    </div>
                    <div style="padding-top:26px; max-width:440px; margin:0 auto; text-align:left;">
                      <a href="${v.ctaUrl}" target="_blank" style="text-decoration:none; display:block;">
${heroPreview}
                      </a>
                    </div>
                  </td>
                </tr>${HERO_CLOSE}
            </td>
          </tr>

          <!-- OPENING HOOK -->
          <tr>
            <td class="mobile-pad body-copy" style="padding:28px 54px 22px 54px; font-family:Arial, Helvetica, sans-serif; font-size:18px; line-height:31px; color:#5d544b;">
              <p style="margin:0 0 16px;">
                Hi ${v.firstName}, thanks for being part of Fettle. You&rsquo;ve been booking by phone or email, and that&rsquo;s worked.
              </p>
              <p style="margin:0;">
                But there&rsquo;s a quicker way. <strong style="color:#c2410c;">My Fettle is your own online dashboard, and setting it up is simple.</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:0 40px 0 40px;">
<div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:18px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; color:#c2410c; padding:0 0 12px 2px;">What you can do in My Fettle</div>
            </td>
          </tr>${featureCard(
            "#eff6ff", 1, "#2f62b3", "Book and manage sessions",
            "See what&rsquo;s coming up and book your next session yourself, any time. No call or email needed.",
            v.ctaUrl,
            mockWindow("Book", `${DAY_PICKER}<div style="font-family:Arial, Helvetica, sans-serif; font-size:13px; line-height:20px; color:#7d7269; padding-top:10px; text-align:center;">Pick a day. Pick a time. Done.</div>`)
          )}${featureCard(
            "#ecfdf5", 2, "#17a86b", "Track your progress",
            "Watch your sessions add up, keep a streak going and see your next milestone.",
            v.ctaUrl,
            mockWindow("Progress", progressBar(60, "#17a86b"))
          )}${featureCard(
            "#f3f0ff", 3, "#6152ca", "Earn loyalty rewards",
            "Unlock rewards as you keep showing up, from First Step to Wellness Champion.",
            v.ctaUrl,
            mockWindow("Rewards", rewardLadder(2))
          )}${featureCard(
            "#fff2e3", 4, "#f47d31", "Save with session packages",
            "Book sessions in a package of 3, 6 or 9. The bigger the package, the bigger the saving.",
            v.ctaUrl,
            mockWindow("Packages", PACKAGE_TILES)
          )}

          <!-- LOW-FRICTION INLINE LINK -->
          <tr>
            <td class="mobile-pad" align="center" style="padding:6px 40px 22px 40px; font-family:Arial, Helvetica, sans-serif;">
              <a href="mailto:hello@fettle.ie" target="_blank" style="font-size:15px; line-height:22px; color:#c2410c; text-decoration:underline; font-weight:700;">
                Need a hand getting set up? Email us &rarr;
              </a>
            </td>
          </tr>

          <!-- MID CTA -->
          <tr>
            <td class="mobile-pad" style="padding:0 40px 28px 40px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff; border-left:4px solid #f47d31; border-radius:4px;">
                <tr>
                  <td style="padding:22px 26px; font-family:Arial, Helvetica, sans-serif;">
                    <div style="font-size:18px; line-height:24px; font-weight:700; color:#1c1e24; padding-bottom:10px;">
                      Ready to try it?
                    </div>
                    <div style="font-size:16px; line-height:27px; color:#5d544b; padding-bottom:16px;">
                      Set up your account and book your next session from there.
                    </div>
                    <a class="button" href="${v.ctaUrl}" target="_blank" style="display:inline-block; background:#f47d31; color:#ffffff; font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:20px; font-weight:700; padding:14px 26px; border-radius:999px;">
                      Open My Fettle
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:0 40px 28px 40px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:4px; border-collapse:separate !important;  border-left:4px solid #c2410c;"><tr><td style="padding:24px 26px; font-family:Arial, Helvetica, sans-serif;"><div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:18px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; color:#c2410c; padding:0 0 12px 0;">Plus, all in the same place</div><div style="font-size:17px; line-height:28px; color:#5d544b;">View your invoices, refer a friend with Refer &amp; Earn, find answers in the Help Centre and explore Fettle&rsquo;s online psychiatry service.</div></td></tr></table>
            </td>
          </tr>

          <!-- CLOSING LINE -->
          <tr>
            <td class="mobile-pad body-copy" style="padding:0 54px 28px 54px; font-family:Arial, Helvetica, sans-serif; font-size:18px; line-height:31px; color:#5d544b;">
              <p style="margin:0 0 16px;">
                Your sessions, your progress and your rewards, all a click away. You can still reach us by phone or email any time you like.
              </p>
              <p style="margin:0;">
                <strong style="color:#c2410c;">Set it up once and it&rsquo;s ready whenever you are.</strong>
              </p>
            </td>
          </tr>

          <!-- CTA BLOCK -->
          <tr>
            <td class="mobile-pad" style="padding:0 32px 30px 32px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#c2410c; border-radius:22px;">
                <tr>
                  <td class="card-pad" style="padding:36px 30px; text-align:center; font-family:Arial, Helvetica, sans-serif;">
                    <div style="font-size:14px; line-height:20px; color:#ffedd5; font-weight:800; letter-spacing:1px; text-transform:uppercase; padding-bottom:10px;">
                      Your Fettle Account
                    </div>
                    <div style="font-size:26px; line-height:32px; color:#ffffff; font-weight:800; padding-bottom:12px;">
                      Your therapy, all in one place.
                    </div>
                    <div style="font-size:17px; line-height:28px; color:#ffedd5; padding:0 8px 24px 8px;">
                      Set up your My Fettle account and start booking, tracking and earning.
                    </div>
                    <a class="button" href="${v.ctaUrl}" target="_blank" style="display:inline-block; background:#0d3b72; color:#ffffff; font-family:Arial, Helvetica, sans-serif; font-size:17px; line-height:22px; font-weight:700; padding:16px 32px; border-radius:999px;">
                      Set Up Your Account
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${footer(v.unsubscribeUrl)}`;

  return head("My Fettle: Set Up Your Account | Fettle") + wrap(PREVIEWS.existing_clients, rows);
}

function existingClientsText(input: TemplateInput): string {
  return `Hi ${input.firstName?.trim() || "there"}, thanks for being part of Fettle. You've been booking by phone or email, and that's worked.

But there's a quicker way. My Fettle is your own online dashboard, and setting it up is simple.

What you can do in My Fettle:
1. Book and manage sessions: see what's coming up and book your next session yourself, any time.
2. Track your progress: watch your sessions add up, keep a streak going and see your next milestone.
3. Earn loyalty rewards: unlock rewards as you keep showing up, from First Step to Wellness Champion.
4. Save with session packages: book sessions in a package of 3, 6 or 9. The bigger the package, the bigger the saving.

Plus, all in the same place: your invoices, Refer & Earn, the Help Centre and Fettle's online psychiatry service.

Set up your account: ${input.ctaUrl}

Need a hand getting set up? Email us at hello@fettle.ie. You can still reach us by phone or email any time you like.

Warmly,
The Fettle Team

Questions? hello@fettle.ie or 1 912 5688 during office hours.
Unsubscribe: ${input.unsubscribeUrl}
Fettle Therapy, Unit 1 Block K, Monavalley Business Park, Tralee, Co. Kerry V92H5KW
`;
}

// ---------------------------------------------------------------------------
// Email 2 — new enquiries
// ---------------------------------------------------------------------------

function step(number: number, title: string, description: string, last: boolean): string {
  const pad = last ? "0 0 0px 0" : "0 0 16px 0";
  return `<tr>
<td width="52" valign="top" style="padding:${pad};"><div style="font-family:Arial, Helvetica, sans-serif; width:38px; height:38px; line-height:38px; border-radius:999px; background:#0d3b72; color:#ffffff; font-size:17px; font-weight:800; text-align:center;">${number}</div></td>
<td valign="top" style="padding:${pad}; font-family:Arial, Helvetica, sans-serif;"><div style="font-size:18px; line-height:24px; font-weight:800; color:#1c1e24;">${title}</div><div style="font-size:16px; line-height:25px; color:#5d544b; padding-top:2px;">${description}</div></td></tr>`;
}

function newEnquiriesHtml(v: Values): string {
  const peek = mockWindow(
    "Dashboard",
    `<div style="font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#2f62b3; padding-bottom:8px;">Book</div>${DAY_PICKER}<div style="padding-top:18px;">${progressBar(40, "#17a86b")}</div><div style="font-family:Arial, Helvetica, sans-serif; font-size:12px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px; color:#6152ca; padding:18px 0 10px 0;">Rewards</div>${rewardLadder(1)}`
  );

  const rows = `${LOGO_ROW}

          <!-- HERO -->
          <tr>
            <td class="mobile-pad" style="padding:28px 32px 10px 32px;">
              ${heroOpen("#0d3b72", "#2f62b3")}
                <tr>
                  <td class="card-pad" align="center" style="padding:40px 36px 36px 36px; font-family:Arial, Helvetica, sans-serif;">
                    <span style="display:inline-block; background:rgba(255,255,255,0.22); color:#ffffff; border-radius:999px; padding:7px 14px; font-size:13px; line-height:16px; font-weight:800; text-transform:uppercase; letter-spacing:1px;">
                      Welcome to Fettle
                    </span>
                    <div class="hero-title" style="padding:16px 0 12px 0; font-size:31px; line-height:37px; font-weight:800; color:#ffffff;">
                      Your first step starts here.
                    </div>
                    <div class="hero-sub" style="font-size:18px; line-height:29px; color:#dbeafe; max-width:460px; margin:0 auto;">
                      Create your My Fettle account now, then book your first session whenever you&rsquo;re ready.
                    </div>
                    <div style="padding-top:22px;">
                      <a class="button" href="${v.ctaUrl}" target="_blank" style="display:inline-block; background:#f47d31; color:#ffffff; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:20px; font-weight:700; padding:14px 28px; border-radius:999px;">
                        Get Started
                      </a>
                    </div>
                  </td>
                </tr>${HERO_CLOSE}
            </td>
          </tr>

          <!-- OPENING HOOK -->
          <tr>
            <td class="mobile-pad body-copy" style="padding:28px 54px 22px 54px; font-family:Arial, Helvetica, sans-serif; font-size:18px; line-height:31px; color:#5d544b;">
              <p style="margin:0 0 16px;">
                Hi ${v.firstName}, thanks for getting in touch with Fettle. Reaching out is often the hardest part.
              </p>
              <p style="margin:0;">
                <strong style="color:#0d3b72;">My Fettle is where it all happens.</strong> Here&rsquo;s how it works.
              </p>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:0 40px 20px 40px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#faf8f5; border-radius:18px; border-collapse:separate !important; border:1px solid #efe9e2; "><tr><td class="card-pad" style="padding:26px 26px 26px 26px; font-family:Arial, Helvetica, sans-serif;"><div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:18px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; color:#0d3b72; padding:0 0 16px 0;">Three simple steps</div><table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">${step(1, "Create your account", "Set up My Fettle in a few clicks. No need to book anything yet.", false)}${step(2, "Book when you&rsquo;re ready", "Choose a session that suits you and manage it yourself, any time.", false)}${step(3, "Track, earn and save", "Watch your progress, unlock rewards and save with session packages.", true)}</table></td></tr></table>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:0 40px 20px 40px;">
<div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:18px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; color:#0d3b72; padding:0 0 12px 2px;">A peek inside</div><a href="${v.ctaUrl}" target="_blank" style="text-decoration:none; display:block;">${peek}</a>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:0 40px 16px 40px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#fff2e3; border-radius:18px; border-collapse:separate !important;  "><tr><td class="card-pad" style="padding:24px 24px 22px 24px; font-family:Arial, Helvetica, sans-serif;"><div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:18px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; color:#c2410c; padding:0 0 6px 0;">Save with session packages</div><div style="font-size:15px; line-height:23px; color:#5d544b; padding-bottom:14px;">Book sessions in a package of 3, 6 or 9. The bigger the package, the bigger the saving.</div><a href="${v.ctaUrl}" target="_blank" style="text-decoration:none; display:block;">${PACKAGE_TILES}</a></td></tr></table>
            </td>
          </tr>

          <!-- LOW-FRICTION INLINE LINK -->
          <tr>
            <td class="mobile-pad" align="center" style="padding:6px 40px 22px 40px; font-family:Arial, Helvetica, sans-serif;">
              <a href="https://fettle.ie/free-consultation/" target="_blank" style="font-size:15px; line-height:22px; color:#0d3b72; text-decoration:underline; font-weight:700;">
                Not ready to book? Talk to us first &rarr;
              </a>
            </td>
          </tr>

          <!-- MID CTA -->
          <tr>
            <td class="mobile-pad" style="padding:0 40px 28px 40px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff; border-left:4px solid #f47d31; border-radius:4px;">
                <tr>
                  <td style="padding:22px 26px; font-family:Arial, Helvetica, sans-serif;">
                    <div style="font-size:18px; line-height:24px; font-weight:700; color:#1c1e24; padding-bottom:10px;">
                      Get everything ready
                    </div>
                    <div style="font-size:16px; line-height:27px; color:#5d544b; padding-bottom:16px;">
                      Set up your account now, so booking is quick when you are.
                    </div>
                    <a class="button" href="${v.ctaUrl}" target="_blank" style="display:inline-block; background:#f47d31; color:#ffffff; font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:20px; font-weight:700; padding:14px 26px; border-radius:999px;">
                      Create Your Account
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="mobile-pad" style="padding:0 40px 28px 40px;">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#ffffff; border-radius:4px; border-collapse:separate !important;  border-left:4px solid #0d3b72;"><tr><td style="padding:24px 26px; font-family:Arial, Helvetica, sans-serif;"><div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:18px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; color:#0d3b72; padding:0 0 12px 0;">Not sure where to start?</div><div style="font-size:17px; line-height:28px; color:#5d544b;">That&rsquo;s completely normal. A free, confidential consultation is an easy first step, and your My Fettle account will be ready when you are.</div></td></tr></table>
            </td>
          </tr>

          <!-- CLOSING LINE -->
          <tr>
            <td class="mobile-pad body-copy" style="padding:0 54px 28px 54px; font-family:Arial, Helvetica, sans-serif; font-size:18px; line-height:31px; color:#5d544b;">
              <p style="margin:0 0 16px;">
                Less back-and-forth, more control. Just your own space to take the next step at your own pace.
              </p>
              <p style="margin:0;">
                <strong style="color:#0d3b72;">Your account is simple to set up, and it&rsquo;s there when you need it.</strong>
              </p>
            </td>
          </tr>

          <!-- CTA BLOCK -->
          <tr>
            <td class="mobile-pad" style="padding:0 32px 30px 32px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:#0d3b72; border-radius:22px;">
                <tr>
                  <td class="card-pad" style="padding:36px 30px; text-align:center; font-family:Arial, Helvetica, sans-serif;">
                    <div style="font-size:14px; line-height:20px; color:#dbeafe; font-weight:800; letter-spacing:1px; text-transform:uppercase; padding-bottom:10px;">
                      Your Fettle Journey
                    </div>
                    <div style="font-size:26px; line-height:32px; color:#ffffff; font-weight:800; padding-bottom:12px;">
                      Start your way, when you&rsquo;re ready.
                    </div>
                    <div style="font-size:17px; line-height:28px; color:#dbeafe; padding:0 8px 24px 8px;">
                      Set up your My Fettle account and book when the time feels right.
                    </div>
                    <a class="button" href="${v.ctaUrl}" target="_blank" style="display:inline-block; background:#f47d31; color:#ffffff; font-family:Arial, Helvetica, sans-serif; font-size:17px; line-height:22px; font-weight:700; padding:16px 32px; border-radius:999px;">
                      Set Up Your Account
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${footer(v.unsubscribeUrl)}`;

  return head("My Fettle: Set Up Your Account | Fettle") + wrap(PREVIEWS.new_enquiries, rows);
}

function newEnquiriesText(input: TemplateInput): string {
  return `Hi ${input.firstName?.trim() || "there"}, thanks for getting in touch with Fettle. Reaching out is often the hardest part.

My Fettle is where it all happens. Here's how it works:
1. Create your account: set up My Fettle in a few clicks. No need to book anything yet.
2. Book when you're ready: choose a session that suits you and manage it yourself, any time.
3. Track, earn and save: watch your progress, unlock rewards and save with session packages of 3, 6 or 9.

Set up your account: ${input.ctaUrl}

Not sure where to start? That's completely normal. A free, confidential consultation is an easy first step: https://fettle.ie/free-consultation/

Warmly,
The Fettle Team

Questions? hello@fettle.ie or 1 912 5688 during office hours.
Unsubscribe: ${input.unsubscribeUrl}
Fettle Therapy, Unit 1 Block K, Monavalley Business Park, Tralee, Co. Kerry V92H5KW
`;
}
