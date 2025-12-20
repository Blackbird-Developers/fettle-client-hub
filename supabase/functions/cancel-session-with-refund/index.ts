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

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");

    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");
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

    // Find the Stripe customer and their payments
    let refundProcessed = false;
    let refundAmount = 0;

    const customers = await stripe.customers.list({ email: clientEmail, limit: 1 });
    
    if (customers.data.length > 0) {
      const customerId = customers.data[0].id;
      logStep("Found Stripe customer", { customerId });

      // Search for payment with matching appointment datetime in metadata
      const paymentIntents = await stripe.paymentIntents.list({
        customer: customerId,
        limit: 50,
      });

      // Find the payment for this specific appointment
      const matchingPayment = paymentIntents.data.find((pi: Stripe.PaymentIntent) => {
        if (pi.status !== 'succeeded') return false;
        
        // Check metadata for matching datetime
        if (pi.metadata?.datetime === appointment.datetime) return true;
        
        // Also check if appointment ID matches if stored
        if (pi.metadata?.appointmentId === appointmentId.toString()) return true;
        
        return false;
      });

      if (matchingPayment) {
        logStep("Found matching payment", { paymentId: matchingPayment.id, amount: matchingPayment.amount });

        // Check if already refunded
        const existingRefunds = await stripe.refunds.list({
          payment_intent: matchingPayment.id,
          limit: 1,
        });

        if (existingRefunds.data.length === 0) {
          // Process refund
          const refund = await stripe.refunds.create({
            payment_intent: matchingPayment.id,
            reason: "requested_by_customer",
          });
          
          logStep("Refund processed", { refundId: refund.id, amount: refund.amount });
          refundProcessed = true;
          refundAmount = refund.amount;
        } else {
          logStep("Payment already refunded");
          refundProcessed = true;
          refundAmount = existingRefunds.data[0].amount;
        }
      } else {
        logStep("No matching payment found for this appointment");
      }
    } else {
      logStep("No Stripe customer found for this email");
    }

    // Cancel the appointment in Acuity
    const cancelResponse = await fetch(`${ACUITY_API_BASE}/appointments/${appointmentId}/cancel`, {
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${acuityAuthHeader}`,
        'Content-Type': 'application/json',
      },
    });

    if (!cancelResponse.ok) {
      const errorText = await cancelResponse.text();
      logStep("Acuity cancellation failed", { status: cancelResponse.status, error: errorText });
      throw new Error(`Failed to cancel appointment: ${errorText}`);
    }

    const cancelledAppointment = await cancelResponse.json();
    logStep("Appointment cancelled successfully", { appointmentId: cancelledAppointment.id });

    return new Response(JSON.stringify({ 
      success: true,
      message: refundProcessed 
        ? `Session cancelled and €${(refundAmount / 100).toFixed(2)} refunded` 
        : "Session cancelled (no payment found to refund)",
      refunded: refundProcessed,
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
