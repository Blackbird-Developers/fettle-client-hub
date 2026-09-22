import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// pay-session — settle an EXISTING unpaid Acuity appointment by card.
// Companion to unpaid-sessions (which decides what counts as unpaid).
//
//   { action: "create",  appointmentId }   → { clientSecret, paymentIntentId, amount }
//   { action: "confirm", paymentIntentId } → { success, receiptUrl }
//
// The appointment must belong to the signed-in caller (JWT email — never a
// client-supplied one), and the amount is always re-derived from Acuity's own
// price. The PaymentIntent carries kind:"session_settlement" and NO
// appointmentTypeID/packageId, so the stripe-webhook backstop skips it and no
// booking/refund machinery can ever touch it.
//
// Once the PI succeeds, unpaid-sessions stops flagging the appointment
// automatically (it searches succeeded PIs by acuity_appointment_id), even if
// the confirm step never runs. Confirm's job is the paper trail: append a PAID
// note to the Acuity appointment so clinic staff see it settled, and hand the
// receipt URL back to the UI.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[PAY-SESSION] ${step}${detailsStr}`);
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

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

    if (!stripeKey || !acuityUserId || !acuityApiKey) {
      return json({ error: "Payments are temporarily unavailable. Please contact hello@fettle.ie." }, 500);
    }

    // Identity from the caller's JWT only.
    let email: string | null = null;
    const bearer = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (bearer && supabaseUrl && anonKey) {
      try {
        const authClient = createClient(supabaseUrl, anonKey);
        const { data } = await authClient.auth.getUser(bearer);
        email = data.user?.email ?? null;
      } catch (_e) { /* handled below */ }
    }
    if (!email) return json({ error: "Please sign in to pay for a session." }, 401);

    const body = await req.json();
    const action = body?.action;
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);

    // ── action: create ────────────────────────────────────────────────────
    if (action === "create") {
      const appointmentId = parseInt(String(body?.appointmentId || ""), 10);
      if (!appointmentId) return json({ error: "Missing appointment reference." }, 400);

      const apptResp = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}`, {
        headers: { Authorization: `Basic ${acuityAuth}` },
      });
      if (!apptResp.ok) {
        logStep("Acuity appointment fetch failed", { appointmentId, status: apptResp.status });
        return json({ error: "We couldn't find that session. Please refresh and try again." }, 404);
      }
      const appt = await apptResp.json();

      // Ownership + state checks — server-side truth only.
      if ((appt.email || "").trim().toLowerCase() !== email.trim().toLowerCase()) {
        logStep("Ownership mismatch", { appointmentId });
        return json({ error: "This session doesn't belong to your account." }, 403);
      }
      if (appt.canceled === true) {
        return json({ error: "This session has been cancelled — there's nothing to pay." }, 400);
      }
      // Mirrors the unpaid-sessions exclusions: insurer-billed sessions and
      // assessments are never self-settled here.
      if (/irish life|laya|vhi|assessment|screening/i.test(appt.type || "")) {
        return json({ error: "This session can't be paid here. Please contact hello@fettle.ie." }, 400);
      }
      const priceCents = Math.round(parseFloat(appt.price || "0") * 100);
      if (appt.paid !== "no" || priceCents <= 0 || parseFloat(appt.amountPaid || "0") > 0) {
        return json({ alreadyPaid: true, message: "This session is already settled." });
      }

      // Double-payment guard: a succeeded PI for this appointment means it's
      // paid regardless of what Acuity's flag says (hub bookings look unpaid
      // in Acuity by design).
      try {
        const existing = await stripe.paymentIntents.search({
          query: `metadata['acuity_appointment_id']:'${appointmentId}' AND status:'succeeded'`,
          limit: 1,
        });
        if (existing.data.length > 0) {
          logStep("Already paid via Stripe", { appointmentId, pi: existing.data[0].id });
          return json({ alreadyPaid: true, message: "This session is already settled." });
        }
      } catch (e) {
        // Cannot rule out an existing payment — refuse rather than risk a
        // double charge.
        logStep("Stripe search failed on create — refusing", { error: String(e).slice(0, 200) });
        return json({ error: "We couldn't verify this session's payment status. Please try again shortly." }, 500);
      }

      // Reuse-or-create Stripe customer, same as create-payment-intent.
      const customers = await stripe.customers.list({ email, limit: 1 });
      const customerId = customers.data.length > 0
        ? customers.data[0].id
        : (await stripe.customers.create({
            email,
            name: `${appt.firstName || ""} ${appt.lastName || ""}`.trim() || undefined,
          })).id;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: priceCents,
        currency: "eur",
        customer: customerId,
        description: `[MyFettleHub] Settle unpaid session: ${appt.type || "Therapy Session"} with ${(appt.calendar || "therapist").trim()} - ${appt.firstName || ""} ${appt.lastName || ""} - ${new Date(appt.datetime).toLocaleDateString()}`,
        metadata: {
          // No appointmentTypeID / packageId → the stripe-webhook backstop
          // skips this PI; nothing can re-book or refund it.
          source: "myfettlehub",
          kind: "session_settlement",
          acuity_appointment_id: String(appointmentId),
          appointmentTypeName: appt.type || "",
          calendarName: (appt.calendar || "").trim(),
          datetime: appt.datetime || "",
          email,
        },
        automatic_payment_methods: { enabled: true },
      });

      logStep("Settlement PI created", { appointmentId, pi: paymentIntent.id, amount: priceCents });
      return json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: priceCents,
        currency: "eur",
        livemode: paymentIntent.livemode,
      });
    }

    // ── action: confirm ───────────────────────────────────────────────────
    if (action === "confirm") {
      const paymentIntentId = String(body?.paymentIntentId || "");
      if (!paymentIntentId) return json({ error: "Missing payment reference." }, 400);

      let pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.metadata?.kind !== "session_settlement") {
        return json({ error: "This payment is not a session settlement." }, 400);
      }
      if ((pi.metadata?.email || "").toLowerCase() !== email.toLowerCase()) {
        return json({ error: "This payment doesn't belong to your account." }, 403);
      }

      // Wallet payments can sit in "processing" briefly (same handling as
      // confirm-payment-and-book).
      if (pi.status === "processing") {
        await new Promise((r) => setTimeout(r, 2000));
        pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      }
      if (pi.status !== "succeeded") {
        return json({ error: "Your payment hasn't completed yet. Please wait a moment and try again." }, 400);
      }

      let receiptUrl: string | null = null;
      try {
        const charges = await stripe.charges.list({ payment_intent: paymentIntentId, limit: 1 });
        receiptUrl = charges.data[0]?.receipt_url ?? null;
      } catch (_e) { /* cosmetic */ }

      if (pi.metadata?.settlement_recorded === "true") {
        return json({ success: true, alreadyRecorded: true, receiptUrl });
      }

      // Paper trail for clinic staff: append a PAID note on the Acuity
      // appointment. Best-effort — the money is already in; a note failure
      // must not fail the flow.
      const appointmentId = pi.metadata.acuity_appointment_id;
      let noteRecorded = false;
      try {
        const getResp = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}`, {
          headers: { Authorization: `Basic ${acuityAuth}` },
        });
        if (getResp.ok) {
          const appt = await getResp.json();
          const paidLine = `PAID EUR ${(pi.amount / 100).toFixed(2)} via My Fettle on ${new Date().toISOString().slice(0, 10)} (Stripe ${pi.id})`;
          const notes = appt.notes ? `${appt.notes}\n${paidLine}` : paidLine;
          const putResp = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}?admin=true`, {
            method: "PUT",
            headers: { Authorization: `Basic ${acuityAuth}`, "Content-Type": "application/json" },
            body: JSON.stringify({ notes }),
          });
          noteRecorded = putResp.ok;
          if (!putResp.ok) {
            logStep("Acuity note update failed (non-fatal)", {
              appointmentId, status: putResp.status, error: (await putResp.text()).slice(0, 200),
            });
          }
        }
      } catch (e) {
        logStep("Acuity note update threw (non-fatal)", { appointmentId, error: String(e).slice(0, 200) });
      }

      try {
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: { settlement_recorded: "true", settlement_note_ok: noteRecorded ? "yes" : "no" },
        });
      } catch (_e) { /* idempotency weakened, not broken — confirm re-runs are still safe */ }

      logStep("Settlement recorded", { appointmentId, pi: pi.id, noteRecorded });
      return json({ success: true, receiptUrl, noteRecorded });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return json({ error: "Something went wrong. Please try again or contact hello@fettle.ie." }, 500);
  }
});
