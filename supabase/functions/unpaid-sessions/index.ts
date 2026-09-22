import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// unpaid-sessions — list the signed-in client's genuinely unpaid sessions.
//
// Acuity's `paid` flag alone is NOT that signal: hub card bookings charge via
// Stripe first and create the Acuity appointment afterwards, so Acuity shows
// them as unpaid. An appointment only counts as unpaid here when EVERY payment
// trail comes up empty:
//   1. Acuity says paid="no", amountPaid=0, price>0, not canceled. (Package
//      and website bookings attach a certificate at booking time, so Acuity
//      already shows those as paid and they never reach the checks below.)
//   2. No succeeded Stripe PaymentIntent stamped with this appointment's id
//      (every hub booking path writes metadata.acuity_appointment_id).
//   3. No referral-credit redemption for this appointment id (book-with-credit
//      records booking_ref = appointment id).
//
// FAIL-SAFE: any doubt — Stripe search error, Acuity outage, unexpected throw —
// means we do NOT accuse. The endpoint then returns an empty list with a
// `degraded` marker rather than an error, so the dashboard stays clean.
//
// Known residual gap: legacy Stripe-Checkout bookings (verify-payment-and-book)
// stamped the checkout SESSION, not the PI, and Stripe search can't see those.
// The 60-day lookback keeps that era mostly out of range.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[UNPAID-SESSIONS] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

const LOOKBACK_DAYS = 60;
const LOOKAHEAD_DAYS = 90;
const MAX_CANDIDATES = 20;
// Never flag these: insurer-billed sessions (the client doesn't pay us
// directly) and assessments/screenings (partner flows pay outside our Stripe
// stamping, so "unpaid" can't be trusted for them).
const EXCLUDED_TYPES = /irish life|laya|vhi|assessment|screening/i;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // Identity comes ONLY from the caller's Supabase JWT — the same pattern as
    // the acuity proxy. No client-supplied email is ever accepted.
    let email: string | null = null;
    const bearer = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (bearer && supabaseUrl && anonKey) {
      try {
        const authClient = createClient(supabaseUrl, anonKey);
        const { data } = await authClient.auth.getUser(bearer);
        email = data.user?.email ?? null;
      } catch (_e) { /* handled below */ }
    }
    if (!email) {
      return json({ error: "Please sign in to view your sessions." }, 401);
    }

    if (!acuityUserId || !acuityApiKey) {
      logStep("Degraded: Acuity env missing");
      return json({ unpaidSessions: [], degraded: "acuity_unavailable" });
    }

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const minDate = new Date(now - LOOKBACK_DAYS * day).toISOString().slice(0, 10);
    const maxDate = new Date(now + LOOKAHEAD_DAYS * day).toISOString().slice(0, 10);

    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);
    const acuityResp = await fetch(
      "https://acuityscheduling.com/api/v1/appointments" +
        `?email=${encodeURIComponent(email)}&minDate=${minDate}&maxDate=${maxDate}&max=100`,
      { headers: { Authorization: `Basic ${acuityAuth}` } },
    );
    if (!acuityResp.ok) {
      logStep("Degraded: Acuity appointments query failed", { status: acuityResp.status });
      return json({ unpaidSessions: [], degraded: "acuity_unavailable" });
    }
    const appts = await acuityResp.json();
    if (!Array.isArray(appts)) {
      logStep("Degraded: unexpected Acuity response shape");
      return json({ unpaidSessions: [], degraded: "acuity_unavailable" });
    }

    let candidates = appts.filter((a: any) =>
      a?.canceled !== true &&
      a?.paid === "no" &&
      parseFloat(a?.price || "0") > 0 &&
      parseFloat(a?.amountPaid || "0") === 0 &&
      !EXCLUDED_TYPES.test(a?.type || "")
    );
    candidates.sort(
      (a: any, b: any) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime(),
    );
    candidates = candidates.slice(0, MAX_CANDIDATES);
    logStep("Candidates after Acuity filter", {
      email,
      total: appts.length,
      candidates: candidates.map((a: any) => a.id),
    });

    if (candidates.length === 0) {
      return json({ unpaidSessions: [], checkedAt: new Date().toISOString() });
    }

    let degraded: string | undefined;

    // Exclusion 2: a succeeded Stripe payment stamped with this appointment id.
    if (stripeKey) {
      const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
      const stillUnpaid: any[] = [];
      for (const a of candidates) {
        try {
          const found = await stripe.paymentIntents.search({
            query: `metadata['acuity_appointment_id']:'${a.id}' AND status:'succeeded'`,
            limit: 1,
          });
          if (found.data.length > 0) {
            logStep("Excluded: paid via Stripe", { appointmentId: a.id, pi: found.data[0].id });
          } else {
            stillUnpaid.push(a);
          }
        } catch (e) {
          // Can't verify — do not accuse this appointment.
          degraded = "stripe_check_failed";
          logStep("Stripe search failed — excluding appointment as fail-safe", {
            appointmentId: a.id,
            error: String(e).slice(0, 200),
          });
        }
      }
      candidates = stillUnpaid;
    } else {
      logStep("Degraded: Stripe key missing — cannot verify, returning none");
      return json({ unpaidSessions: [], degraded: "stripe_unavailable" });
    }

    // Exclusion 3: covered by referral credit (booking_ref = appointment id).
    if (candidates.length > 0 && supabaseUrl && serviceKey) {
      try {
        const admin = createClient(supabaseUrl, serviceKey);
        const ids = candidates.map((a: any) => String(a.id));
        const { data: redemptions, error } = await admin
          .from("referral_redemptions")
          .select("booking_ref")
          .in("booking_ref", ids);
        if (error) throw error;
        const covered = new Set((redemptions || []).map((r: any) => String(r.booking_ref)));
        candidates = candidates.filter((a: any) => {
          if (covered.has(String(a.id))) {
            logStep("Excluded: covered by referral credit", { appointmentId: a.id });
            return false;
          }
          return true;
        });
      } catch (e) {
        // Can't verify referral coverage — do not accuse anyone this run.
        logStep("Referral check failed — returning none as fail-safe", { error: String(e).slice(0, 200) });
        return json({ unpaidSessions: [], degraded: "referral_check_failed" });
      }
    }

    const unpaidSessions = candidates.map((a: any) => ({
      id: a.id,
      type: a.type,
      therapist: (a.calendar || "").trim(),
      datetime: a.datetime,
      price: a.price,
      amountPaid: a.amountPaid,
      isPast: new Date(a.datetime).getTime() < now,
    }));

    logStep("Result", { email, unpaid: unpaidSessions.map((s) => s.id), degraded });
    return json({ unpaidSessions, degraded, checkedAt: new Date().toISOString() });
  } catch (error) {
    // Never break the dashboard over this feature.
    logStep("ERROR — returning empty as fail-safe", { message: String(error).slice(0, 300) });
    return json({ unpaidSessions: [], degraded: "error" });
  }
});
