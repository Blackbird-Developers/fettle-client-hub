import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = 'https://acuityscheduling.com/api/v1';

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-PAYMENT-AND-BOOK] ${step}${detailsStr}`);
};

// Look for an appointment that ALREADY EXISTS for this customer + slot, so we
// never refund a payment whose booking actually went through (a racing call,
// the webhook/confirm path, or a booking on another surface that shares this
// Acuity). Acuity rejects a duplicate as "not available / already booked",
// which is indistinguishable from a real failure — refunding it would hand the
// customer a paid session for free.
//
// Returns { appointment } on a confident match, { inconclusive: true } if
// Acuity couldn't be queried (caller must NOT refund), or {} if confidently no
// match (safe to refund).
async function findExistingAcuityAppointment(
  acuityAuth: string,
  email: string,
  datetime: string,
  appointmentTypeID: string | number,
): Promise<{ appointment?: any; inconclusive?: boolean }> {
  if (!email || !datetime) return {};

  const wantMs = new Date(datetime).getTime();
  if (Number.isNaN(wantMs)) return {};

  try {
    const dayMs = 24 * 60 * 60 * 1000;
    const minDate = new Date(wantMs - dayMs).toISOString().slice(0, 10);
    const maxDate = new Date(wantMs + dayMs).toISOString().slice(0, 10);
    const url =
      `${ACUITY_API_BASE}/appointments` +
      `?email=${encodeURIComponent(email)}` +
      `&minDate=${minDate}&maxDate=${maxDate}&max=100`;

    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${acuityAuth}`, "Content-Type": "application/json" },
    });

    if (!resp.ok) {
      logStep("Existence check: Acuity appointments query failed — inconclusive", { status: resp.status });
      return { inconclusive: true };
    }

    const appts = await resp.json();
    if (!Array.isArray(appts)) {
      logStep("Existence check: unexpected Acuity response — inconclusive");
      return { inconclusive: true };
    }

    // Email is constrained by the query, so an exact start-time match (within a
    // minute) is a confident "this is their booking".
    const match = appts.find((a: any) => {
      if (a?.canceled === true) return false;
      return a?.datetime && Math.abs(new Date(a.datetime).getTime() - wantMs) < 60 * 1000;
    });

    if (match) {
      logStep("Existence check: matched an existing appointment", { appointmentId: match.id });
      return { appointment: match };
    }

    return {};
  } catch (e) {
    logStep("Existence check threw — inconclusive", { error: String(e) });
    return { inconclusive: true };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");

    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");
    if (!acuityUserId || !acuityApiKey) throw new Error("Acuity credentials not configured");

    const { sessionId } = await req.json();
    if (!sessionId) throw new Error("Missing session_id");

    logStep("Verifying payment session", { sessionId });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    logStep("Session retrieved", { status: session.payment_status, metadata: session.metadata });

    if (session.payment_status !== "paid") {
      throw new Error("Payment not completed");
    }

    // Check if already booked (prevent double booking)
    if (session.metadata?.acuity_appointment_id) {
      logStep("Appointment already booked", { appointmentId: session.metadata.acuity_appointment_id });
      return new Response(JSON.stringify({ 
        success: true, 
        alreadyBooked: true,
        appointmentId: session.metadata.acuity_appointment_id 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Extract booking details from metadata
    const { 
      appointmentTypeID, 
      datetime, 
      calendarID, 
      firstName, 
      lastName, 
      email, 
      phone, 
      notes 
    } = session.metadata || {};

    if (!appointmentTypeID || !datetime || !firstName || !lastName || !email) {
      throw new Error("Missing booking details in session metadata");
    }

    logStep("Booking appointment in Acuity", { appointmentTypeID, datetime, calendarID });

    // Book in Acuity
    const acuityAuthHeader = btoa(`${acuityUserId}:${acuityApiKey}`);
    
    const bookingData: Record<string, any> = {
      appointmentTypeID: parseInt(appointmentTypeID),
      datetime,
      firstName,
      lastName,
      email,
    };

    if (calendarID) bookingData.calendarID = parseInt(calendarID);
    if (phone) bookingData.phone = phone;
    if (notes) bookingData.notes = notes;

    const acuityResponse = await fetch(`${ACUITY_API_BASE}/appointments`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${acuityAuthHeader}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bookingData),
    });

    if (!acuityResponse.ok) {
      const errorText = await acuityResponse.text();
      logStep("Acuity booking failed", { status: acuityResponse.status, error: errorText });

      // RECOVERY BEFORE REFUND. The appointment may already exist (a racing
      // call, the webhook/confirm path, or a booking on another surface that
      // shares this Acuity). Acuity rejects the duplicate as "not available /
      // already booked", which must NOT trigger a refund — that gives the
      // customer a paid session for free. Verify against Acuity first.
      const existing = await findExistingAcuityAppointment(
        acuityAuthHeader, email, datetime, appointmentTypeID,
      );

      if (existing.appointment) {
        logStep("Recovery: appointment already exists — keeping payment, NOT refunding", {
          appointmentId: existing.appointment.id,
        });
        // Stamp the session so repeat calls short-circuit at the idempotency guard.
        try {
          await stripe.checkout.sessions.update(sessionId, {
            metadata: { ...session.metadata, acuity_appointment_id: String(existing.appointment.id) },
          });
        } catch (e) {
          logStep("WARNING: failed to stamp session metadata", { error: String(e) });
        }
        return new Response(JSON.stringify({
          success: true,
          alreadyBooked: true,
          appointment: existing.appointment,
          appointmentId: existing.appointment.id,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      if (existing.inconclusive) {
        // Couldn't confirm with Acuity — refunding now risks clawing back a real
        // booking, so we DON'T. Return a soft pending state instead of refunding.
        logStep("Recovery: existence check inconclusive — NOT refunding", { sessionId });
        return new Response(JSON.stringify({
          success: false,
          pending: true,
          error: "We're finalizing your booking. If you don't receive a confirmation email shortly, please contact hello@fettle.ie for support.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
      }

      // Confirmed there is genuinely no appointment for this customer + slot →
      // the payment has nothing to pay for, so refund it.
      logStep("Initiating refund due to booking failure (no existing appointment found)");

      if (session.payment_intent) {
        await stripe.refunds.create({
          payment_intent: session.payment_intent as string,
          reason: "requested_by_customer",
        });
        logStep("Refund initiated");
      }

      throw new Error(`Failed to book appointment in Acuity: ${errorText}. Payment has been refunded.`);
    }

    const appointment = await acuityResponse.json();
    logStep("Appointment booked successfully", { appointmentId: appointment.id });

    // Get receipt URL from the charge
    let receiptUrl = null;
    if (session.payment_intent) {
      try {
        const charges = await stripe.charges.list({
          payment_intent: session.payment_intent as string,
          limit: 1,
        });
        if (charges.data.length > 0) {
          receiptUrl = charges.data[0].receipt_url;
        }
      } catch (e) {
        logStep("Could not fetch receipt URL", { error: e });
      }
    }

    // Send confirmation email (fire and forget - don't block on this)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY");
    
    if (supabaseUrl && supabaseKey) {
      try {
        logStep("Sending booking confirmation email");
        
        const emailPayload = {
          to: email,
          firstName,
          sessionType: appointment.type || "Therapy Session",
          therapistName: appointment.calendar || "Your Therapist",
          datetime,
          duration: appointment.duration || 50,
          amount: session.amount_total || 0,
          currency: session.currency || "eur",
          receiptUrl,
        };

        fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseKey}`,
          },
          body: JSON.stringify(emailPayload),
        }).then(res => {
          if (res.ok) {
            logStep("Confirmation email sent successfully");
          } else {
            logStep("Confirmation email failed", { status: res.status });
          }
        }).catch(err => {
          logStep("Error sending confirmation email", { error: err.message });
        });
      } catch (emailError) {
        logStep("Failed to initiate confirmation email", { error: emailError });
        // Don't throw - booking was successful, email is secondary
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      appointment,
      appointmentId: appointment.id 
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
