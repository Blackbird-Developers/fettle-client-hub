import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

// ============================================================================
// book-with-credit — book a session that is FULLY covered by referral credit
// (€0 to pay, so no Stripe is involved at all).
//
// Flow: authenticate user → re-check their available credit covers the price
// (server is source of truth) → create the Acuity appointment → redeem exactly
// the price from their referral credit → send a confirmation email.
//
// IMPORTANT: this path is credit-covered, NOT real money, so it must NOT call
// qualify_referral — a fully-credit booking never unlocks new referral rewards
// (anti-abuse). Rewards only unlock on a real paid session/package.
// ============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[BOOK-WITH-CREDIT] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!acuityUserId || !acuityApiKey) throw new Error("Our scheduling system is temporarily unavailable. Please contact hello@fettle.ie for support.");
    if (!supabaseUrl || !serviceKey || !anonKey) throw new Error("Server configuration error. Please contact hello@fettle.ie for support.");

    // ── Authenticate the caller ───────────────────────────────────────────────
    const token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
    if (!token) throw new Error("Please sign in to book a session.");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData.user) throw new Error("Your session has expired. Please sign in again.");
    const userId = userData.user.id;

    const body = await req.json();
    const {
      appointmentTypeID,
      appointmentTypeName,
      appointmentTypePrice,
      datetime,
      calendarID,
      calendarName,
      firstName,
      lastName,
      email,
      phone,
      notes,
      intakeFormFields,
      timezone,
    } = body;

    if (!appointmentTypeID || !datetime || !firstName || !lastName || !email) {
      throw new Error("Please fill in all required booking details.");
    }

    const priceCents = Math.round(parseFloat(appointmentTypePrice || "0") * 100);
    if (priceCents <= 0) throw new Error("This session type does not have a valid price.");

    const admin = createClient(supabaseUrl, serviceKey);

    // ── Server-side guard: credit must actually cover the full price ──────────
    const { data: balData, error: balErr } = await admin.rpc("referral_available_balance", { uid: userId });
    if (balErr) throw new Error("Could not verify your referral credit. Please try again.");
    const balance = Number(balData || 0);
    if (balance < priceCents) {
      throw new Error("Your referral credit no longer covers this session. Please refresh and try again.");
    }

    // ── Create the Acuity appointment (adaptive intake-field retry) ───────────
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);
    const appointmentBody: Record<string, any> = {
      appointmentTypeID: parseInt(appointmentTypeID),
      datetime,
      firstName,
      lastName,
      email,
      phone: phone || "0000000000",
    };
    if (calendarID) appointmentBody.calendarID = parseInt(calendarID);
    if (notes) appointmentBody.notes = notes;
    if (intakeFormFields) {
      try { appointmentBody.fields = JSON.parse(intakeFormFields); } catch { /* ignore */ }
    }

    const postAcuity = () => fetch("https://acuityscheduling.com/api/v1/appointments", {
      method: "POST",
      headers: { "Authorization": `Basic ${acuityAuth}`, "Content-Type": "application/json" },
      body: JSON.stringify(appointmentBody),
    });

    let appointment: any = null;
    let lastErrorText = "";
    for (let attempt = 1; attempt <= 12; attempt++) {
      const resp = await postAcuity();
      if (resp.ok) { appointment = await resp.json(); logStep("Acuity appointment created", { id: appointment.id, attempt }); break; }
      lastErrorText = await resp.text();
      logStep("Acuity error", { status: resp.status, error: lastErrorText, attempt });

      const isInvalidField = lastErrorText.includes("invalid_fields") || lastErrorText.includes("does not exist on this appointment");
      const isRequiredField = lastErrorText.includes("required_field");
      if (isInvalidField) {
        const badId = lastErrorText.match(/(\d+)\\?" does not exist/)?.[1];
        if (badId && Array.isArray(appointmentBody.fields)) {
          appointmentBody.fields = appointmentBody.fields.filter((f: { id: number }) => String(f.id) !== badId);
          if (appointmentBody.fields.length === 0) delete appointmentBody.fields;
          continue;
        }
        if (appointmentBody.fields) { delete appointmentBody.fields; continue; }
        break;
      }
      if (isRequiredField) {
        const reqId = lastErrorText.match(/"fieldID":(\d+)/)?.[1];
        const existing: { id: number; value: string }[] = appointmentBody.fields || [];
        if (reqId && !existing.some((f) => String(f.id) === reqId)) {
          appointmentBody.fields = [...existing, { id: parseInt(reqId), value: "yes" }];
          continue;
        }
        break;
      }
      break; // slot taken / in the past / auth — not fixable here
    }

    if (!appointment) {
      throw new Error("That time slot is no longer available. Please pick another time.");
    }

    // ── Redeem the credit (only AFTER the booking succeeded) ──────────────────
    const { data: redeemed, error: redeemErr } = await admin.rpc("redeem_referral_credit", {
      uid: userId,
      want_cents: priceCents,
      p_booking_type: "session",
      p_booking_ref: String(appointment.id),
    });
    if (redeemErr) {
      // Booking succeeded but credit wasn't consumed — log loudly; do not fail
      // the user's booking over an accounting hiccup.
      logStep("WARNING: redeem failed after booking", { error: redeemErr.message, appointmentId: appointment.id });
    } else {
      logStep("Referral credit redeemed", { redeemed, appointmentId: appointment.id });
    }

    // ── Confirmation email (best-effort) ──────────────────────────────────────
    if (resendApiKey) {
      try {
        const tz = timezone || "Europe/Dublin";
        const d = new Date(datetime);
        const fDate = d.toLocaleDateString("en-IE", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz });
        const fTime = d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: tz });
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Fettle <noreply@notifications.fettle.ie>",
            to: [email],
            subject: `Booking Confirmed: ${appointmentTypeName || "Therapy Session"} on ${fDate}`,
            html: `
              <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
                <h2 style="color:#d2691e;">Booking Confirmed ✓</h2>
                <p>Hi ${firstName},</p>
                <p>Your therapy session has been booked.</p>
                <div style="background:#f8f9fa;padding:16px;border-radius:8px;border-left:4px solid #d2691e;">
                  <p style="margin:4px 0;"><strong>Session:</strong> ${appointmentTypeName || "Therapy Session"}</p>
                  <p style="margin:4px 0;"><strong>Therapist:</strong> ${calendarName || "Your therapist"}</p>
                  <p style="margin:4px 0;"><strong>Date:</strong> ${fDate}</p>
                  <p style="margin:4px 0;"><strong>Time:</strong> ${fTime}</p>
                </div>
                <div style="background:#e8f5e9;padding:12px;border-radius:8px;margin-top:12px;color:#2e7d32;">
                  <strong>Paid with referral credit</strong> — €0.00 charged.
                </div>
                <p style="font-size:13px;color:#666;margin-top:16px;">Need to reschedule or cancel? Contact us at least 24 hours before your appointment.</p>
              </div>`,
          }),
        });
      } catch (e) { logStep("Email send failed (non-fatal)", { error: String(e) }); }
    }

    return new Response(JSON.stringify({
      success: true,
      appointment: {
        id: appointment.id,
        datetime: appointment.datetime,
        type: appointmentTypeName,
        therapist: calendarName,
      },
      creditRedeemed: Number(redeemed || 0),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
