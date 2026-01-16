import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[STRIPE-CANCEL] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");

    const { paymentIntentId, reason } = await req.json();

    if (!paymentIntentId) {
      throw new Error("Missing required field: paymentIntentId");
    }

    logStep("Canceling payment", { paymentIntentId, reason });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId, {
      cancellation_reason: reason || "abandoned",
    });

    logStep("Payment canceled", {
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
    });

    return new Response(JSON.stringify({
      success: true,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
