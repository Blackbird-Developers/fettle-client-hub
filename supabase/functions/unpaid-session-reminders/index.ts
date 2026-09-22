import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// unpaid-session-reminders — daily payment nudges for upcoming unpaid sessions,
// 4/3/2/1 days before the appointment.
//
// Invoked by the scheduled GitHub Actions workflow
// (.github/workflows/unpaid-session-reminders.yml) with the shared secret in
// x-cron-secret. Not a user endpoint: no JWT, and config.toml disables
// gateway JWT verification for it.
//
// "Unpaid" uses the SAME chain as the unpaid-sessions endpoint (Acuity says
// unpaid + no succeeded Stripe PI stamped with the appointment id + no
// referral redemption), so a client the hub wouldn't banner is never emailed.
//
// SAFETY MODEL — real clients only ever get mail when ALL of these hold:
//   1. env UNPAID_REMINDERS_LIVE === "true"  (dry-run otherwise: reports, sends nothing)
//   2. the run's recipient count is within MAX_RECIPIENTS (mass-send fuse)
//   3. that (appointment, days-before) pair hasn't been sent before
//      (sent-log JSON in the private `reminders` storage bucket)
// A body of { "testEmail": "..." } sends ONE sample-data email to that address
// only, regardless of the live flag, so the template can be reviewed.
//
// Copy is deliberately neutral (no cancellation warnings, no discounts) —
// Fettle hasn't decided that wording yet.

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[UNPAID-REMINDERS] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";
const REMINDER_DAYS = [4, 3, 2, 1];
// Refuse a live run bigger than this — needs a human look. Env-tunable for the
// first run, which clears a multi-day backlog.
const MAX_RECIPIENTS = parseInt(Deno.env.get("UNPAID_REMINDERS_MAX_RECIPIENTS") || "25", 10);
// Never nudge these: insurer-billed sessions (the client doesn't pay us
// directly) and assessments/screenings (partner flows pay outside our Stripe
// stamping, so "unpaid" can't be trusted for them).
const EXCLUDED_TYPES = /irish life|laya|vhi|assessment|screening/i;
const STATE_BUCKET = "reminders";
const STATE_PATH = "unpaid-session-reminders.json";
const TIME_ZONE = "Europe/Dublin";
const HUB_URL = "https://my.fettle.ie/sessions";

// Calendar-day difference in Irish local time (so "1 day before" means
// tomorrow as the client experiences it, not 24 clock hours).
function calendarDaysUntil(datetime: string, now: Date): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const toUtcMidnight = (d: Date) => Date.parse(`${fmt.format(d)}T00:00:00Z`);
  return Math.round((toUtcMidnight(new Date(datetime)) - toUtcMidnight(now)) / 86400000);
}

function formatWhen(datetime: string): string {
  return new Intl.DateTimeFormat("en-IE", {
    timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long",
    hour: "numeric", minute: "2-digit",
  }).format(new Date(datetime));
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${(user || "").slice(0, 2)}***@${domain || ""}`;
}

interface DueSession {
  id: number;
  type: string;
  therapist: string;
  datetime: string;
  price: string;
  daysBefore: number;
  firstName: string;
}

function reminderEmailHtml(firstName: string, sessions: DueSession[]): string {
  const rows = sessions.map((s) => `
    <div style="background: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 12px; border-left: 4px solid #d97706;">
      <p style="margin: 2px 0;"><strong>${s.type}</strong></p>
      ${s.therapist ? `<p style="margin: 2px 0;">Therapist: ${s.therapist}</p>` : ""}
      <p style="margin: 2px 0;">${formatWhen(s.datetime)}</p>
      <p style="margin: 2px 0;">Amount due: <strong>&euro;${s.price}</strong></p>
    </div>`).join("");

  const plural = sessions.length > 1;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 22px;">Payment reminder</h1>
  </div>
  <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px;">
    <p style="font-size: 16px;">Hi ${firstName},</p>
    <p style="font-size: 16px;">Your upcoming ${plural ? "sessions haven't" : "session hasn't"} been paid for yet:</p>
    ${rows}
    <p style="font-size: 15px;">You can pay securely in a couple of clicks from your Fettle account.</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${HUB_URL}" style="background: #667eea; color: white; padding: 13px 30px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Pay for ${plural ? "your sessions" : "your session"}</a>
    </div>
    <p style="font-size: 13px; color: #666;">Already sorted this, or think it's not right? Just ignore this email or contact us at hello@fettle.ie and we'll look after it.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="font-size: 12px; color: #999; text-align: center;">Fettle Therapy</p>
  </div>
</body></html>`;
}

serve(async (req) => {
  try {
    const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "Unauthorized" }, 401);
    }

    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!acuityUserId || !acuityApiKey || !stripeKey || !resendKey || !supabaseUrl || !serviceKey) {
      logStep("Missing env — aborting", {
        acuity: !!acuityUserId, stripe: !!stripeKey, resend: !!resendKey, supabase: !!serviceKey,
      });
      return json({ error: "Function not fully configured" }, 500);
    }

    const live = Deno.env.get("UNPAID_REMINDERS_LIVE") === "true";
    const body = await req.json().catch(() => ({}));
    const resend = new Resend(resendKey);

    // Template preview: one email with sample data to the given address only.
    if (body?.testEmail) {
      const sample: DueSession[] = [{
        id: 0, type: "Individual Therapy Session (Anxiety)", therapist: "Jane Example",
        datetime: new Date(Date.now() + 2 * 86400000).toISOString(),
        price: "95.00", daysBefore: 2, firstName: "Test",
      }];
      const resp = await resend.emails.send({
        from: "Fettle <noreply@notifications.fettle.ie>",
        to: [body.testEmail],
        subject: "[TEST] Payment reminder for your upcoming session",
        html: reminderEmailHtml("Test", sample),
      });
      logStep("Test template sent", { to: maskEmail(body.testEmail), id: (resp as any)?.data?.id });
      return json({ testSent: true });
    }

    const now = new Date();
    const day = 86400000;
    const minDate = new Date(now.getTime()).toISOString().slice(0, 10);
    const maxDate = new Date(now.getTime() + 5 * day).toISOString().slice(0, 10);

    // All upcoming appointments in the window — one call, then group by client.
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);
    const apptResp = await fetch(
      `${ACUITY_API_BASE}/appointments?minDate=${minDate}&maxDate=${maxDate}&max=300`,
      { headers: { Authorization: `Basic ${acuityAuth}` } },
    );
    if (!apptResp.ok) {
      logStep("Acuity query failed — aborting", { status: apptResp.status });
      return json({ error: "Acuity unavailable" }, 502);
    }
    const appts = await apptResp.json();
    if (!Array.isArray(appts)) return json({ error: "Unexpected Acuity response" }, 502);

    let candidates = appts.filter((a: any) =>
      a?.canceled !== true &&
      a?.paid === "no" &&
      parseFloat(a?.price || "0") > 0 &&
      parseFloat(a?.amountPaid || "0") === 0 &&
      a?.email &&
      !EXCLUDED_TYPES.test(a?.type || "") &&
      REMINDER_DAYS.includes(calendarDaysUntil(a.datetime, now))
    );
    logStep("Candidates after Acuity filter", { window: `${minDate}..${maxDate}`, total: appts.length, candidates: candidates.length });

    // Same exclusions as unpaid-sessions. Any check failing = don't email.
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const verified: any[] = [];
    for (const a of candidates) {
      try {
        const found = await stripe.paymentIntents.search({
          query: `metadata['acuity_appointment_id']:'${a.id}' AND status:'succeeded'`,
          limit: 1,
        });
        if (found.data.length === 0) verified.push(a);
        else logStep("Excluded: paid via Stripe", { appointmentId: a.id });
      } catch (e) {
        logStep("Stripe check failed — excluding as fail-safe", { appointmentId: a.id, error: String(e).slice(0, 150) });
      }
    }
    candidates = verified;

    const admin = createClient(supabaseUrl, serviceKey);
    if (candidates.length > 0) {
      try {
        const ids = candidates.map((a: any) => String(a.id));
        const { data: redemptions, error } = await admin
          .from("referral_redemptions").select("booking_ref").in("booking_ref", ids);
        if (error) throw error;
        const covered = new Set((redemptions || []).map((r: any) => String(r.booking_ref)));
        candidates = candidates.filter((a: any) => !covered.has(String(a.id)));
      } catch (e) {
        logStep("Referral check failed — aborting run as fail-safe", { error: String(e).slice(0, 150) });
        return json({ error: "Referral check unavailable" }, 502);
      }
    }

    // Sent-log: skip (appointment, daysBefore) pairs already reminded.
    let sentLog: Record<string, string> = {};
    try {
      const dl = await admin.storage.from(STATE_BUCKET).download(STATE_PATH);
      if (dl.data) sentLog = JSON.parse(await dl.data.text());
    } catch (_e) { /* first run or bucket missing — handled on save */ }

    const due: DueSession[] = [];
    for (const a of candidates) {
      const daysBefore = calendarDaysUntil(a.datetime, now);
      const key = `${a.id}:${daysBefore}`;
      if (sentLog[key]) {
        logStep("Skipped: already reminded", { key });
        continue;
      }
      due.push({
        id: a.id, type: a.type || "Therapy session", therapist: (a.calendar || "").trim(),
        datetime: a.datetime, price: a.price, daysBefore,
        firstName: a.firstName || "there",
      });
    }

    // One email per client per run, listing everything due.
    const byEmail = new Map<string, DueSession[]>();
    for (const [i, a] of candidates.entries()) {
      void i;
      const match = due.find((d) => d.id === a.id);
      if (!match) continue;
      const key = String(a.email).trim().toLowerCase();
      byEmail.set(key, [...(byEmail.get(key) || []), match]);
    }

    const plan = [...byEmail.entries()].map(([email, sessions]) => ({
      email: maskEmail(email),
      appointments: sessions.map((s) => ({ id: s.id, daysBefore: s.daysBefore, price: s.price })),
    }));

    if (!live) {
      logStep("DRY RUN — nothing sent", { recipients: plan.length, plan });
      return json({ dryRun: true, wouldEmail: plan, checkedAt: now.toISOString() });
    }
    if (byEmail.size > MAX_RECIPIENTS) {
      logStep("Mass-send fuse tripped — nothing sent", { recipients: byEmail.size, max: MAX_RECIPIENTS });
      return json({ error: "recipient_count_exceeds_fuse", recipients: byEmail.size, wouldEmail: plan }, 200);
    }

    let sent = 0;
    const failures: string[] = [];
    for (const [email, sessions] of byEmail) {
      try {
        const plural = sessions.length > 1;
        await resend.emails.send({
          from: "Fettle <noreply@notifications.fettle.ie>",
          to: [email],
          subject: plural
            ? "Payment reminder for your upcoming sessions"
            : "Payment reminder for your upcoming session",
          html: reminderEmailHtml(sessions[0].firstName, sessions),
        });
        sent++;
        const stamp = now.toISOString();
        for (const s of sessions) sentLog[`${s.id}:${s.daysBefore}`] = stamp;
        logStep("Reminder sent", { to: maskEmail(email), appointments: sessions.map((s) => s.id) });
      } catch (e) {
        failures.push(maskEmail(email));
        logStep("Send failed", { to: maskEmail(email), error: String(e).slice(0, 150) });
      }
    }

    // Persist the sent-log (prune entries older than 30 days).
    try {
      const cutoff = now.getTime() - 30 * day;
      sentLog = Object.fromEntries(
        Object.entries(sentLog).filter(([, ts]) => Date.parse(ts) > cutoff),
      );
      const blob = new Blob([JSON.stringify(sentLog)], { type: "application/json" });
      let up = await admin.storage.from(STATE_BUCKET).upload(STATE_PATH, blob, { upsert: true });
      if (up.error && /not found/i.test(up.error.message || "")) {
        await admin.storage.createBucket(STATE_BUCKET, { public: false });
        up = await admin.storage.from(STATE_BUCKET).upload(STATE_PATH, blob, { upsert: true });
      }
      if (up.error) throw up.error;
    } catch (e) {
      // Worst case tomorrow's run re-sends today's bucket once; log loudly.
      logStep("WARNING: sent-log save failed — duplicates possible next run", { error: String(e).slice(0, 200) });
    }

    logStep("Run complete", { sent, failures: failures.length });
    return json({ sent, failures, plan, checkedAt: now.toISOString() });
  } catch (error) {
    logStep("ERROR", { message: String(error).slice(0, 300) });
    return json({ error: "Internal error" }, 500);
  }
});
