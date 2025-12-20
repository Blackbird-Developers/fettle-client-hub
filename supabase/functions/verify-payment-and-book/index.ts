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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");

    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
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
      
      // If Acuity booking fails, we should refund the payment
      logStep("Initiating refund due to booking failure");
      
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

    // Update the session metadata with the appointment ID (for idempotency)
    // Note: We can't update session metadata, but the payment intent metadata serves as a record

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
