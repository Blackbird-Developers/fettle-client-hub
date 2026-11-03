import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { getCaller, unauthorized } from "../_shared/auth.ts";
import { requireSupportedAppVersion } from "../_shared/appVersion.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-version",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[GET-PAYMENT-HISTORY] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const tooOld = requireSupportedAppVersion(req, corsHeaders);
  if (tooOld) return tooOld;

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");

    // AUTH: user JWT. Only the caller's own Stripe payments are returned.
    const user = await getCaller(req);
    if (!user) return unauthorized(corsHeaders);

    logStep("User authenticated", { userId: user.userId });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Find the customer by email
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    
    if (customers.data.length === 0) {
      logStep("No Stripe customer found");
      return new Response(JSON.stringify({ payments: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const customerId = customers.data[0].id;
    logStep("Found Stripe customer", { customerId });

    // Fetch payment intents for this customer
    const paymentIntents = await stripe.paymentIntents.list({
      customer: customerId,
      limit: 50,
    });

    // Fetch charges to get receipt URLs
    const charges = await stripe.charges.list({
      customer: customerId,
      limit: 50,
    });

    // Create a map of payment intent to charge for receipt URLs
    const chargeMap = new Map<string, Stripe.Charge>();
    for (const charge of charges.data) {
      if (charge.payment_intent) {
        chargeMap.set(charge.payment_intent as string, charge);
      }
    }

    // Format payments for response
    const payments = paymentIntents.data
      .filter((pi: Stripe.PaymentIntent) => pi.status === 'succeeded')
      .map((pi: Stripe.PaymentIntent) => {
        const charge = chargeMap.get(pi.id);
        return {
          id: pi.id,
          amount: pi.amount,
          currency: pi.currency,
          status: pi.status,
          created: pi.created,
          description: pi.description || pi.metadata?.appointmentTypeName || 'Therapy Session',
          therapist: pi.metadata?.calendarName || null,
          datetime: pi.metadata?.datetime || null,
          receiptUrl: charge?.receipt_url || null,
        };
      });

    logStep("Fetched payments", { count: payments.length });

    return new Response(JSON.stringify({ payments }), {
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
