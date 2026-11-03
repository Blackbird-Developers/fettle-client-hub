import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// pay-session — settle an EXISTING unpaid Acuity appointment by card, or
// with a bundle credit. Companion to unpaid-sessions (which decides what
// counts as unpaid).
//
//   { action: "create",  appointmentId }   → { clientSecret, paymentIntentId, amount }
//   { action: "confirm", paymentIntentId } → { success, receiptUrl }
//   { action: "use-credit", appointmentId, packageId } → { success, packageName, remainingSessions }
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

type PackageCategory = "individual" | "youth" | "couples";

// Bundle product ID → session category. Kept in sync with
// src/lib/packageCategory.ts and book-with-package.
const PACKAGE_CATEGORY: Record<string, PackageCategory> = {
  "1122832": "individual", // 3 Session Bundle
  "996385": "individual",  // 6 Session Bundle
  "1197875": "individual", // 9 Session Bundle
  "1370588": "youth",      // Youth Bundle 3 x 60min
  "1975510": "youth",      // Youth Bundle 5 x 60min
  "2000708": "couples",    // Couples 3 x 60 min
  "1967869": "couples",    // Couples 5 x 60 min
};

// Appointment-type name prefixes per category, as book-with-package.
const CATEGORY_NAME_PREFIX: Record<PackageCategory, string> = {
  individual: "Individual Therapy Session",
  youth: "Youth Therapy - Individual Session",
  couples: "Couple's Therapy Session",
};

const CATEGORY_LABEL: Record<PackageCategory, string> = {
  individual: "individual therapy",
  youth: "youth therapy",
  couples: "couples therapy",
};

function categoryOfType(typeName: string): PackageCategory | undefined {
  const name = typeName.trim();
  for (const [category, prefix] of Object.entries(CATEGORY_NAME_PREFIX)) {
    if (name.startsWith(prefix)) return category as PackageCategory;
  }
  return undefined;
}

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
    let userId: string | null = null;
    const bearer = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (bearer && supabaseUrl && anonKey) {
      try {
        const authClient = createClient(supabaseUrl, anonKey);
        const { data } = await authClient.auth.getUser(bearer);
        email = data.user?.email ?? null;
        userId = data.user?.id ?? null;
      } catch (_e) { /* handled below */ }
    }
    if (!email) return json({ error: "Please sign in to pay for a session." }, 401);

    const body = await req.json();
    const action = body?.action;
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);

    // The caller's own appointment, if it is genuinely unpaid; otherwise the
    // response to send. Shared by card payment and bundle credit.
    const loadUnpaid = async (appointmentId: number): Promise<
      { ok: true; appt: any; priceCents: number } | { ok: false; response: Response }
    > => {
      const apptResp = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}`, {
        headers: { Authorization: `Basic ${acuityAuth}` },
      });
      if (!apptResp.ok) {
        logStep("Acuity appointment fetch failed", { appointmentId, status: apptResp.status });
        return { ok: false, response: json({ error: "We couldn't find that session. Please refresh and try again." }, 404) };
      }
      const appt = await apptResp.json();

      // Ownership + state checks — server-side truth only.
      if ((appt.email || "").trim().toLowerCase() !== email!.trim().toLowerCase()) {
        logStep("Ownership mismatch", { appointmentId });
        return { ok: false, response: json({ error: "This session doesn't belong to your account." }, 403) };
      }
      if (appt.canceled === true) {
        return { ok: false, response: json({ error: "This session has been cancelled — there's nothing to pay." }, 400) };
      }
      // Adult sessions BOOKED before the 26 Aug 2026 price rise are honoured
      // at the old €85 rate; on/after pay €95 (Art, 23 Sep 2026). Mirrors
      // effectivePrice in unpaid-sessions — the banner shows what we charge.
      if (appt.price === "85.00" || appt.price === "95.00") {
        const created = Date.parse(appt.datetimeCreated || "");
        if (!Number.isNaN(created)) {
          appt.price = created < Date.parse("2026-08-26T00:00:00+01:00") ? "85.00" : "95.00";
        }
      }
      // Mirrors the unpaid-sessions exclusions: insurer-billed sessions and
      // assessments are never self-settled here.
      if (/irish life|laya|vhi|assessment|screening/i.test(appt.type || "")) {
        return { ok: false, response: json({ error: "This session can't be paid here. Please contact hello@fettle.ie." }, 400) };
      }
      // API-created bookings (website/hub) are paid before Acuity sees them —
      // never let one be paid a second time here (Oct-1 double-charge).
      if (appt.scheduledBy === "art@blackbird.marketing") {
        return { ok: false, response: json({ error: "This session was already paid for when it was booked. If you think that's wrong, contact hello@fettle.ie." }, 400) };
      }
      const priceCents = Math.round(parseFloat(appt.price || "0") * 100);
      if (
        appt.paid !== "no" || priceCents <= 0 || parseFloat(appt.amountPaid || "0") > 0 ||
        // Already paid with a bundle credit (see use-credit below).
        /\[Bundle: /.test(appt.notes || "")
      ) {
        return { ok: false, response: json({ alreadyPaid: true, message: "This session is already settled." }) };
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
          return { ok: false, response: json({ alreadyPaid: true, message: "This session is already settled." }) };
        }
      } catch (e) {
        // Cannot rule out an existing payment — refuse rather than risk a
        // double charge.
        logStep("Stripe search failed — refusing", { error: String(e).slice(0, 200) });
        return { ok: false, response: json({ error: "We couldn't verify this session's payment status. Please try again shortly." }, 500) };
      }
      return { ok: true, appt, priceCents };
    };

    // ── action: create ────────────────────────────────────────────────────
    if (action === "create") {
      const appointmentId = parseInt(String(body?.appointmentId || ""), 10);
      if (!appointmentId) return json({ error: "Missing appointment reference." }, 400);

      const checked = await loadUnpaid(appointmentId);
      if (!checked.ok) return checked.response;
      const { appt, priceCents } = checked;

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

    // ── action: use-credit ────────────────────────────────────────────────
    // Settle the session with one credit from the caller's bundle instead of
    // a card. The credit is taken first (only if the balance hasn't moved
    // since we read it) and given back if Acuity can't record the session as
    // paid. A bundle from Acuity has its certificate applied to the
    // appointment, so Acuity deducts it too; every bundle leaves the same
    // "[Bundle: …]" note as book-with-package, which unpaid-sessions and the
    // Sessions page read.
    if (action === "use-credit") {
      const appointmentId = parseInt(String(body?.appointmentId || ""), 10);
      const packageId = String(body?.packageId || "");
      if (!appointmentId || !packageId) return json({ error: "Missing session or bundle reference." }, 400);
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!userId || !supabaseUrl || !serviceKey) {
        return json({ error: "Please sign in again to use a bundle credit." }, 401);
      }

      const checked = await loadUnpaid(appointmentId);
      if (!checked.ok) return checked.response;
      const { appt } = checked;

      const admin = createClient(supabaseUrl, serviceKey);
      const { data: pkg } = await admin
        .from("user_packages")
        .select("*")
        .eq("id", packageId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!pkg) return json({ error: "We couldn't find that bundle on your account." }, 404);
      if (pkg.remaining_sessions <= 0) return json({ error: "All sessions on this bundle are used." }, 400);
      if (pkg.expires_at && new Date(pkg.expires_at) < new Date()) {
        return json({ error: "This bundle has expired." }, 400);
      }
      // Bundles are for therapy sessions only (assessments are already
      // excluded by loadUnpaid). Like book-with-package, a session type we
      // can't place in a category isn't blocked.
      if (/psychiatr/i.test(appt.type || "")) {
        return json({ error: "Bundles can't be used for psychiatry." }, 400);
      }
      const bundleCategory = PACKAGE_CATEGORY[String(pkg.package_id)];
      const sessionCategory = categoryOfType(appt.type || "");
      if (bundleCategory && sessionCategory && sessionCategory !== bundleCategory) {
        return json({
          error: `This bundle is for ${CATEGORY_LABEL[bundleCategory]}, so it can't pay for this session.`,
        }, 400);
      }

      // Take the credit, only if nobody else spent it since we read it.
      const newRemaining = pkg.remaining_sessions - 1;
      const { data: taken } = await admin
        .from("user_packages")
        .update({ remaining_sessions: newRemaining, updated_at: new Date().toISOString() })
        .eq("id", pkg.id)
        .eq("remaining_sessions", pkg.remaining_sessions)
        .select("id");
      if (!taken || taken.length === 0) {
        return json({ error: "Your bundle balance just changed. Please refresh and try again." }, 409);
      }
      const giveBack = async () => {
        const { error } = await admin
          .from("user_packages")
          .update({ remaining_sessions: pkg.remaining_sessions, updated_at: new Date().toISOString() })
          .eq("id", pkg.id)
          .eq("remaining_sessions", newRemaining);
        if (error) logStep("CREDIT NOT RETURNED — fix by hand", { packageId: pkg.id, error: error.message });
      };

      // Acuity: apply the bundle's certificate (so Acuity deducts it as well)
      // and add the bundle note.
      const update: Record<string, unknown> = {};
      const certId = String(pkg.stripe_session_id || "").startsWith("acuity-cert-")
        ? String(pkg.stripe_session_id).replace("acuity-cert-", "")
        : null;
      if (certId) {
        const certResp = await fetch(`${ACUITY_API_BASE}/certificates/${certId}`, {
          headers: { Authorization: `Basic ${acuityAuth}` },
        });
        const cert = certResp.ok ? await certResp.json() : null;
        if (!cert?.certificate) {
          logStep("Bundle certificate lookup failed", { certId, status: certResp.status });
          await giveBack();
          return json({ error: "We couldn't reach your bundle in our scheduling system. Please try again, or contact hello@fettle.ie." }, 502);
        }
        update.certificate = cert.certificate;
      }
      const bundleNote = `[Bundle: ${pkg.package_name} | Credits remaining: ${newRemaining}/${pkg.total_sessions}]`;
      update.notes = appt.notes ? `${appt.notes}\n\n${bundleNote}` : bundleNote;

      const putResp = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}?admin=true`, {
        method: "PUT",
        headers: { Authorization: `Basic ${acuityAuth}`, "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (!putResp.ok) {
        logStep("Acuity refused the bundle credit", {
          appointmentId, status: putResp.status, error: (await putResp.text()).slice(0, 300),
        });
        await giveBack();
        return json({ error: "We couldn't apply your bundle to this session. You haven't been charged a credit. Please contact hello@fettle.ie." }, 502);
      }

      logStep("Session settled with a bundle credit", { appointmentId, packageId: pkg.id, newRemaining, certId });
      return json({ success: true, packageName: pkg.package_name, remainingSessions: newRemaining });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return json({ error: "Something went wrong. Please try again or contact hello@fettle.ie." }, 500);
  }
});
