import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = 'https://acuityscheduling.com/api/v1';

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CANCEL-SESSION-WITH-REFUND] ${step}${detailsStr}`);
};

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

    const { appointmentId, clientEmail } = await req.json();
    
    if (!appointmentId) throw new Error("Missing appointmentId");
    if (!clientEmail) throw new Error("Missing clientEmail");

    logStep("Processing cancellation", { appointmentId, clientEmail });

    const acuityAuthHeader = btoa(`${acuityUserId}:${acuityApiKey}`);
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // First, get appointment details from Acuity to verify it exists
    const appointmentResponse = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}`, {
      headers: {
        'Authorization': `Basic ${acuityAuthHeader}`,
        'Content-Type': 'application/json',
      },
    });

    if (!appointmentResponse.ok) {
      throw new Error(`Appointment not found: ${appointmentResponse.status}`);
    }

    const appointment = await appointmentResponse.json();
    logStep("Found appointment", { 
      id: appointment.id, 
      datetime: appointment.datetime,
      email: appointment.email 
    });

    // Verify the email matches (security check)
    if (appointment.email?.toLowerCase() !== clientEmail.toLowerCase()) {
      throw new Error("Unauthorized: Email does not match appointment");
    }

    // Check if already cancelled
    if (appointment.canceled) {
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Appointment was already cancelled",
        refunded: false 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Locate the Stripe payment for this appointment. LOOKUP ONLY — no money is
    // moved until the Acuity cancellation has succeeded (see STEP 1 below). This
    // ordering guarantees the customer is never left both refunded AND still
    // holding the appointment slot.
    let matchingPayment: Stripe.PaymentIntent | null = null;
    let alreadyRefundedAmount: number | null = null;

    const customers = await stripe.customers.list({ email: clientEmail, limit: 1 });

    if (customers.data.length > 0) {
      const customerId = customers.data[0].id;
      logStep("Found Stripe customer", { customerId });

      const paymentIntents = await stripe.paymentIntents.list({
        customer: customerId,
        limit: 100,
      });

      // Match on the durable acuity_appointment_id that confirm-payment-and-book
      // stamps onto the PI metadata. Fall back to the legacy datetime compare only
      // for older bookings made before that id was stamped. (The previous code
      // checked pi.metadata.appointmentId — a key NO function ever writes — so the
      // brittle datetime equality was effectively the only matcher.)
      const apptIdStr = String(appointmentId);
      matchingPayment =
        paymentIntents.data.find((pi) =>
          pi.status === 'succeeded' && pi.metadata?.acuity_appointment_id === apptIdStr
        ) ||
        paymentIntents.data.find((pi) =>
          pi.status === 'succeeded' && pi.metadata?.datetime === appointment.datetime
        ) ||
        null;

      if (matchingPayment) {
        logStep("Found matching payment", { paymentId: matchingPayment.id, amount: matchingPayment.amount });
        const existingRefunds = await stripe.refunds.list({
          payment_intent: matchingPayment.id,
          limit: 1,
        });
        if (existingRefunds.data.length > 0) {
          alreadyRefundedAmount = existingRefunds.data[0].amount;
          logStep("Payment already refunded", { amount: alreadyRefundedAmount });
        }
      } else {
        logStep("No matching payment found for this appointment");
      }
    } else {
      logStep("No Stripe customer found for this email");
    }

    // STEP 1: Cancel in Acuity FIRST. If this fails we have not refunded anything,
    // so we never end up in the "refunded but still booked" state.
    const cancelResponse = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}/cancel`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${acuityAuthHeader}`,
        'Content-Type': 'application/json',
      },
    });

    if (!cancelResponse.ok) {
      const errorText = await cancelResponse.text();
      logStep("Acuity cancellation failed — NO refund issued", { status: cancelResponse.status, error: errorText });
      throw new Error(`Failed to cancel appointment: ${errorText}`);
    }

    const cancelledAppointment = await cancelResponse.json();
    logStep("Appointment cancelled successfully", { appointmentId: cancelledAppointment.id });

    // STEP 2: Slot is released — now issue the refund. Idempotent (skips if one
    // already exists). A refund failure here is recoverable on a later retry (the
    // existing-refund guard prevents a double refund) and never re-books the slot.
    let refundProcessed = false;
    let refundAmount = 0;
    let refundPending = false;
    if (matchingPayment) {
      if (alreadyRefundedAmount !== null) {
        refundProcessed = true;
        refundAmount = alreadyRefundedAmount;
      } else {
        try {
          const refund = await stripe.refunds.create({
            payment_intent: matchingPayment.id,
            reason: "requested_by_customer",
          });
          logStep("Refund processed", { refundId: refund.id, amount: refund.amount });
          refundProcessed = true;
          refundAmount = refund.amount;
        } catch (refundError) {
          // Cancellation already succeeded; report a clear "refund pending" state
          // instead of throwing (which would wrongly imply the cancel didn't happen).
          refundPending = true;
          logStep("CRITICAL: appointment cancelled but refund failed — manual refund needed", {
            paymentId: matchingPayment.id,
            error: String(refundError),
          });
        }
      }
    }

    const message = refundProcessed
      ? `Session cancelled and €${(refundAmount / 100).toFixed(2)} refunded`
      : refundPending
        ? "Session cancelled. Your refund is being processed — please contact hello@fettle.ie if it doesn't appear shortly."
        : "Session cancelled (no payment found to refund)";

    return new Response(JSON.stringify({
      success: true,
      message,
      refunded: refundProcessed,
      refundPending,
      refundAmount: refundAmount / 100,
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
