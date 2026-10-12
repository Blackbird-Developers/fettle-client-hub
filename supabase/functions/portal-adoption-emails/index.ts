// portal-adoption-emails — the two one-off emails that invite Acuity clients
// to set up their My Fettle Hub account (copy from the content team, see
// ./templates.ts; who gets which email, see ./logic.ts).
//
// Invoked on weekday mornings by the GitHub Actions workflow
// (.github/workflows/portal-adoption-emails.yml) with the shared secret in
// x-cron-secret. Not a user endpoint: no JWT, and config.toml disables
// gateway JWT verification for it.
//
// SAFETY MODEL, copied from unpaid-session-reminders. Real clients only get
// mail when ALL of these hold:
//   1. env PORTAL_EMAILS_LIVE === "true" (dry-run otherwise: reports, sends nothing)
//   2. the campaign is listed in PORTAL_EMAILS_CAMPAIGNS (default: both)
//   3. they're within this run's cap, PORTAL_EMAILS_MAX_RECIPIENTS (default
//      25); the rest wait for the next run, so a backlog goes out gradually
//   4. no email_sends row exists for (campaign, email): the row is claimed
//      before Resend is called, and the unique constraint stops duplicates
//   5. they aren't suppressed (unsubscribed, bounced, complained), marked
//      Not continuing by staff, or sent another portal email in the last 14 days
// Bodies:
//   { "testEmail": "...", "campaign"?: "existing_clients" | "new_enquiries" }
//       sends sample copies to that address only, regardless of the live flag
//   { "seed": true }  records everyone currently eligible as "seeded" WITHOUT
//       emailing them, for going live without mailing the existing backlog
//
// PRIVACY: logs carry counts and masked emails only.
//
// DEPLOY: imports ../admin-customer-insights/logic.ts and ../_shared, so
// deploy with the Supabase CLI (`supabase functions deploy portal-adoption-emails`).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  type AcuityAppointment,
  addDays,
  buildPortalEmailSet,
  fetchAppointmentsInWindows,
  groupCustomers,
  mapWithConcurrency,
  toDateString,
} from "../admin-customer-insights/logic.ts";
import { unsubscribeQuery } from "../_shared/unsubscribe.ts";
import {
  type Campaign,
  type EnquiryCandidate,
  type Recipient,
  type SendHistory,
  enquiryCandidates,
  enquiryRecipients,
  existingClientRecipients,
  hasEarlierSession,
  maskEmail,
  planSends,
} from "./logic.ts";
import { renderEmail } from "./templates.ts";

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PORTAL-ADOPTION-EMAILS] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";
const HUB_URL = "https://my.fettle.ie";
const FROM = "Fettle <noreply@notifications.fettle.ie>";
const REPLY_TO = "hello@fettle.ie";
const ALL_CAMPAIGNS: Campaign[] = ["existing_clients", "new_enquiries"];

/** Results per Acuity request for the window fetch. */
const WINDOW_LIMIT = 500;
/** Days back fetched: the 30-day adoption window plus a day of slack. */
const LOOKBACK_DAYS = 31;
/** Days ahead fetched, to see booked sessions and free calls. */
const FUTURE_DAYS = 180;
/** Results per enquiry history lookup; a full page counts as "can't tell". */
const HISTORY_LIMIT = 200;
const HISTORY_START_DATE = "2010-01-01";
const ACUITY_CONCURRENCY = 4;

function signupUrl(email: string, campaign: Campaign): string {
  const params = new URLSearchParams({
    email,
    utm_source: "email",
    utm_medium: "email",
    utm_campaign: "portal_adoption",
    utm_content: campaign,
  });
  return `${HUB_URL}/signup?${params}`;
}

interface SendRow {
  id: string;
  campaign: Campaign;
  email: string;
  status: "claimed" | "sent" | "seeded";
  sent_at: string | null;
  created_at: string;
  signed_up_at: string | null;
}

serve(async (req) => {
  try {
    const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "Unauthorized" }, 401);
    }

    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const unsubscribeSecret = Deno.env.get("EMAIL_UNSUBSCRIBE_SECRET");
    if (!acuityUserId || !acuityApiKey || !resendKey || !supabaseUrl || !serviceKey || !unsubscribeSecret) {
      logStep("Missing env — aborting", {
        acuity: !!acuityUserId && !!acuityApiKey, resend: !!resendKey,
        supabase: !!serviceKey, unsubscribe: !!unsubscribeSecret,
      });
      return json({ error: "Function not fully configured" }, 500);
    }

    const live = Deno.env.get("PORTAL_EMAILS_LIVE") === "true";
    const maxRecipients = parseInt(Deno.env.get("PORTAL_EMAILS_MAX_RECIPIENTS") || "25", 10);
    const enabled = new Set(
      (Deno.env.get("PORTAL_EMAILS_CAMPAIGNS") || ALL_CAMPAIGNS.join(","))
        .split(",").map((c) => c.trim()).filter((c): c is Campaign => ALL_CAMPAIGNS.includes(c as Campaign)),
    );
    const body = await req.json().catch(() => ({}));
    const resend = new Resend(resendKey);

    async function compose(recipient: Pick<Recipient, "campaign" | "email" | "firstName">) {
      const query = await unsubscribeQuery(recipient.email, unsubscribeSecret!);
      const email = renderEmail(recipient.campaign, {
        firstName: recipient.firstName,
        ctaUrl: signupUrl(recipient.email, recipient.campaign),
        unsubscribeUrl: `${HUB_URL}/unsubscribe?${query}`,
      });
      return {
        ...email,
        headers: {
          // One-click unsubscribe straight from the inbox (RFC 8058).
          "List-Unsubscribe": `<${supabaseUrl}/functions/v1/email-unsubscribe?${query}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      };
    }

    // Resend's SDK reports API errors in the result instead of throwing.
    async function send(recipient: Pick<Recipient, "campaign" | "email" | "firstName">, subjectPrefix = "") {
      const email = await compose(recipient);
      const resp: { data?: { id?: string } | null; error?: { message?: string } | null } =
        await resend.emails.send({
          from: FROM,
          to: [recipient.email],
          reply_to: REPLY_TO,
          subject: subjectPrefix + email.subject,
          html: email.html,
          text: email.text,
          headers: email.headers,
          tags: [{ name: "campaign", value: recipient.campaign }],
        });
      if (resp?.error || !resp?.data?.id) {
        throw new Error(resp?.error?.message || "Resend returned no message id");
      }
      return resp.data.id as string;
    }

    // Template preview: sample copies to the given address only.
    if (body?.testEmail) {
      const testEmail = String(body.testEmail).trim().toLowerCase();
      const campaigns = ALL_CAMPAIGNS.includes(body.campaign) ? [body.campaign as Campaign] : ALL_CAMPAIGNS;
      for (const campaign of campaigns) {
        await send({ campaign, email: testEmail, firstName: "Test" }, "[TEST] ");
      }
      logStep("Test emails sent", { to: maskEmail(testEmail), campaigns });
      return json({ testSent: campaigns });
    }

    const now = Date.now();
    const today = toDateString(now);
    const acuityAuth = `Basic ${btoa(`${acuityUserId}:${acuityApiKey}`)}`;

    // Retries rate limits and server errors. Error messages carry only the
    // status — the URL can contain a client's email.
    async function acuityAppointments(params: URLSearchParams): Promise<AcuityAppointment[]> {
      params.set("excludeForms", "true");
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(`${ACUITY_API_BASE}/appointments?${params}`, {
          headers: { Authorization: acuityAuth, "Content-Type": "application/json" },
        });
        if (response.ok) return await response.json();
        const retryable = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        if (!retryable || attempt >= 2) throw new Error(`Acuity API error: ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    // 1. Appointments from the adoption window to FUTURE_DAYS ahead.
    const fetched = await fetchAppointmentsInWindows(
      (minDate, maxDate) =>
        acuityAppointments(new URLSearchParams({ minDate, maxDate, max: String(WINDOW_LIMIT) })),
      addDays(today, -LOOKBACK_DAYS),
      addDays(today, FUTURE_DAYS),
      { limit: WINDOW_LIMIT, chunkDays: 7, concurrency: ACUITY_CONCURRENCY },
    );
    if (fetched.incompleteDates.length > 0) {
      // A cut-off day could hide someone's booked session; don't guess.
      logStep("Acuity window incomplete — aborting", { incompleteDates: fetched.incompleteDates.length });
      return json({ error: "acuity_window_incomplete", incompleteDates: fetched.incompleteDates }, 502);
    }
    const customers = groupCustomers(fetched.appointments);

    const admin = createClient(supabaseUrl, serviceKey);

    // 2. Hub account emails.
    const profileEmails: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("profiles").select("email").order("id").range(from, from + 999);
      if (error) throw new Error(`Failed to fetch profiles: ${error.message}`);
      profileEmails.push(...(data ?? []).map((p) => p.email));
      if (!data || data.length < 1000) break;
    }
    const portalEmails = buildPortalEmailSet(profileEmails);

    // 3. What's been sent, who's suppressed, who staff marked Not continuing.
    const sends: SendRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin
        .from("email_sends")
        .select("id, campaign, email, status, sent_at, created_at, signed_up_at")
        .order("created_at")
        .range(from, from + 999);
      if (error) throw new Error(`Failed to read email_sends: ${error.message}`);
      sends.push(...((data ?? []) as SendRow[]));
      if (!data || data.length < 1000) break;
    }

    const suppressed = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from("email_suppressions").select("email").range(from, from + 999);
      if (error) throw new Error(`Failed to read email_suppressions: ${error.message}`);
      for (const row of data ?? []) suppressed.add(row.email);
      if (!data || data.length < 1000) break;
    }

    const notContinuing = new Set<string>();
    {
      const { data, error } = await admin
        .from("customer_followups").select("customer_key").eq("outcome", "not_continuing");
      // 42703 = the outcomes migration isn't applied yet, so nobody can be
      // marked Not continuing; anything else is a real failure.
      if (error && error.code !== "42703") throw new Error(`Failed to read follow-ups: ${error.message}`);
      for (const row of data ?? []) notContinuing.add(row.customer_key);
    }

    // 4. Mark sends whose recipient has since signed up (for the admin panel).
    const newlySignedUp = sends
      .filter((s) => s.status === "sent" && !s.signed_up_at && portalEmails.has(s.email))
      .map((s) => s.id);
    if (newlySignedUp.length > 0) {
      const { error } = await admin
        .from("email_sends").update({ signed_up_at: new Date(now).toISOString() }).in("id", newlySignedUp);
      if (error) logStep("Signed-up stamp failed", { error: error.message.slice(0, 150) });
    }

    const history: SendHistory = {
      sent: { existing_clients: new Set(), new_enquiries: new Set() },
      lastSentAt: new Map(),
      suppressed,
      notContinuing,
    };
    for (const s of sends) {
      history.sent[s.campaign].add(s.email);
      if (s.status === "seeded") continue;
      const at = Date.parse(s.sent_at ?? s.created_at);
      if (at > (history.lastSentAt.get(s.email) ?? 0)) history.lastSentAt.set(s.email, at);
    }

    // 5. Who's eligible for each enabled email.
    const recipients: Recipient[] = [];
    if (enabled.has("existing_clients")) {
      recipients.push(...existingClientRecipients(customers, portalEmails, now));
    }
    let enquiryHistoryFailures = 0;
    if (enabled.has("new_enquiries")) {
      // Only look up history for people who could actually be emailed.
      const candidates = enquiryCandidates(customers, portalEmails, now).filter(
        (c) => !history.sent.new_enquiries.has(c.customer.email!) && !suppressed.has(c.customer.email!),
      );
      const checked = await mapWithConcurrency(candidates, ACUITY_CONCURRENCY, async (candidate) => {
        try {
          const past = await acuityAppointments(new URLSearchParams({
            email: candidate.customer.email!,
            minDate: HISTORY_START_DATE,
            maxDate: today,
            max: String(HISTORY_LIMIT),
          }));
          return hasEarlierSession(past, HISTORY_LIMIT) ? null : candidate;
        } catch {
          enquiryHistoryFailures++;
          return null;
        }
      });
      recipients.push(...enquiryRecipients(checked.filter((c): c is EnquiryCandidate => c !== null)));
    }

    const plan = planSends(recipients, history, now, maxRecipients);
    const summary = {
      eligible: {
        existing_clients: recipients.filter((r) => r.campaign === "existing_clients").length,
        new_enquiries: recipients.filter((r) => r.campaign === "new_enquiries").length,
      },
      skipped: plan.skipped,
      waitingForNextRun: plan.waiting.length,
      enquiryHistoryFailures,
      campaigns: [...enabled],
    };
    const describe = (list: Recipient[]) => list.map((r) => ({ campaign: r.campaign, email: maskEmail(r.email) }));

    // 6a. Seed: record everyone eligible now, email nobody.
    if (body?.seed === true) {
      const rows = [...plan.send, ...plan.waiting].map((r) => ({
        campaign: r.campaign, email: r.email, customer_key: r.customerKey,
        customer_name: r.name, status: "seeded",
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin
          .from("email_sends")
          .upsert(rows.slice(i, i + 500), { onConflict: "campaign,email", ignoreDuplicates: true });
        if (error) {
          logStep("Seed failed", { error: error.message.slice(0, 200) });
          return json({ error: "seed_failed" }, 500);
        }
      }
      logStep("Seeded — nothing sent", { seeded: rows.length, ...summary });
      return json({ seeded: rows.length, sent: 0, ...summary });
    }

    // 6b. Dry run.
    if (!live) {
      logStep("DRY RUN — nothing sent", { wouldEmail: plan.send.length, ...summary });
      return json({ dryRun: true, wouldEmail: describe(plan.send), ...summary });
    }

    // 6c. Live: claim the row, send, then record the message id. A failed
    //     send releases the claim so the next run retries it.
    let sent = 0;
    const failures: string[] = [];
    for (const recipient of plan.send) {
      const { data: claim, error: claimError } = await admin
        .from("email_sends")
        .insert({
          campaign: recipient.campaign, email: recipient.email,
          customer_key: recipient.customerKey, customer_name: recipient.name, status: "claimed",
        })
        .select("id")
        .single();
      if (claimError) {
        // 23505 = another run already has this (campaign, email).
        if (claimError.code !== "23505") {
          failures.push(maskEmail(recipient.email));
          logStep("Claim failed", { to: maskEmail(recipient.email), error: claimError.message.slice(0, 150) });
        }
        continue;
      }

      let messageId: string;
      try {
        messageId = await send(recipient);
      } catch (e) {
        failures.push(maskEmail(recipient.email));
        logStep("Send failed", { to: maskEmail(recipient.email), error: String(e).slice(0, 150) });
        const { error } = await admin.from("email_sends").delete().eq("id", claim.id);
        // A claim that can't be released blocks a resend, which is the safe side.
        if (error) logStep("Claim release failed", { to: maskEmail(recipient.email) });
        continue;
      }

      sent++;
      const { error } = await admin
        .from("email_sends")
        .update({ status: "sent", resend_message_id: messageId, sent_at: new Date().toISOString() })
        .eq("id", claim.id);
      if (error) logStep("WARNING: sent but not recorded as sent", { to: maskEmail(recipient.email) });
      logStep("Email sent", { campaign: recipient.campaign, to: maskEmail(recipient.email) });
    }

    logStep("Run complete", { sent, failures: failures.length, ...summary });
    return json({ sent, failures, ...summary, checkedAt: new Date(now).toISOString() });
  } catch (error) {
    // Messages here are built without client data (see acuityAppointments).
    logStep("ERROR", { message: String(error).slice(0, 300) });
    return json({ error: "Internal error" }, 500);
  }
});
