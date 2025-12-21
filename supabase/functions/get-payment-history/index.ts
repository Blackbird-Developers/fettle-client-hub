import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[GET-PAYMENT-HISTORY] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");

    // Create Supabase client to authenticate user
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header provided");

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError) throw new Error(`Authentication error: ${userError.message}`);
    const user = userData.user;
    if (!user?.email) throw new Error("User not authenticated or email not available");
    
    logStep("User authenticated", { email: user.email });

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
