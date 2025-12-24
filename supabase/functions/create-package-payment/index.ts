import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PACKAGE-PAYMENT] ${step}${detailsStr}`);
};

// Package definitions with Acuity IDs
const PACKAGES = {
  1122832: { name: "3 Session Bundle", sessions: 3, price: 225 },
  1967864: { name: "6 Session Bundle", sessions: 6, price: 420 },
  1967867: { name: "9 Session Bundle", sessions: 9, price: 585 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");

    const body = await req.json();
    const { 
      packageId,
      firstName,
      lastName,
      email,
      phone,
    } = body;

    logStep("Received package data", { packageId, email });

    if (!packageId || !firstName || !lastName || !email) {
      throw new Error("Missing required fields");
    }

    const packageInfo = PACKAGES[packageId as keyof typeof PACKAGES];
    if (!packageInfo) {
      throw new Error("Invalid package ID");
    }

    const amountInCents = packageInfo.price * 100;

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check if customer exists
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing Stripe customer", { customerId });
    }

    // Store package details in metadata
    const packageMetadata = {
      packageId: packageId.toString(),
      packageName: packageInfo.name,
      sessions: packageInfo.sessions.toString(),
      firstName,
      lastName,
      email,
      phone: phone || "",
    };

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: packageInfo.name,
              description: `${packageInfo.sessions} x 50 minute therapy sessions`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.headers.get("origin")}/booking-success?session_id={CHECKOUT_SESSION_ID}&type=package`,
      cancel_url: `${req.headers.get("origin")}/dashboard`,
      metadata: packageMetadata,
      payment_intent_data: {
        metadata: packageMetadata,
      },
    });

    logStep("Checkout session created", { sessionId: session.id, url: session.url });

    return new Response(JSON.stringify({ url: session.url, sessionId: session.id }), {
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
