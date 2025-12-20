import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-SESSION-PAYMENT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    const body = await req.json();
    const { 
      appointmentTypeID,
      appointmentTypeName,
      appointmentTypePrice, // Price in EUR from Acuity (e.g., "72.99")
      datetime,
      calendarID,
      calendarName,
      firstName,
      lastName,
      email,
      phone,
      notes
    } = body;

    logStep("Received booking data", { 
      appointmentTypeID, 
      appointmentTypeName, 
      price: appointmentTypePrice,
      datetime,
      calendarName 
    });

    if (!appointmentTypeID || !datetime || !firstName || !lastName || !email) {
      throw new Error("Missing required booking fields");
    }

    // Parse price - Acuity returns price as string like "72.99"
    const priceValue = parseFloat(appointmentTypePrice || "0");
    if (priceValue <= 0) {
      throw new Error("Invalid or missing price for this appointment type");
    }

    // Convert to cents for Stripe
    const amountInCents = Math.round(priceValue * 100);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Check if customer exists
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string | undefined;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing Stripe customer", { customerId });
    }

    // Store booking details in metadata to use after payment
    const bookingMetadata = {
      appointmentTypeID: appointmentTypeID.toString(),
      datetime,
      calendarID: calendarID?.toString() || "",
      firstName,
      lastName,
      email,
      phone: phone || "",
      notes: notes || "",
    };

    // Create checkout session with dynamic price
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : email,
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name: appointmentTypeName || "Therapy Session",
              description: `Session with ${calendarName || "therapist"} on ${new Date(datetime).toLocaleDateString()}`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${req.headers.get("origin")}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get("origin")}/dashboard`,
      metadata: bookingMetadata,
      payment_intent_data: {
        metadata: bookingMetadata,
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
