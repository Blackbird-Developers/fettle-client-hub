import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PAYMENT-INTENT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    logStep("RESTRICTED_API_KEY check", { 
      exists: !!stripeKey, 
      prefix: stripeKey ? stripeKey.substring(0, 10) + '...' : 'NOT SET' 
    });
    
    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");

    const rawBody = await req.text();
    logStep("Raw request body", { body: rawBody });
    
    const body = JSON.parse(rawBody);
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
      notes,
      intakeFormFields, // JSON string of Acuity intake form fields
    } = body;

    logStep("Parsed booking data", { 
      appointmentTypeID, 
      appointmentTypeName, 
      price: appointmentTypePrice,
      priceType: typeof appointmentTypePrice,
      datetime,
      calendarName,
      firstName,
      lastName,
      email
    });

    if (!appointmentTypeID || !datetime || !firstName || !lastName || !email) {
      logStep("Missing required fields", {
        hasAppointmentTypeID: !!appointmentTypeID,
        hasDatetime: !!datetime,
        hasFirstName: !!firstName,
        hasLastName: !!lastName,
        hasEmail: !!email
      });
      throw new Error("Missing required booking fields");
    }

    // Parse price - Acuity returns price as string like "72.99"
    const priceValue = parseFloat(appointmentTypePrice || "0");
    logStep("Price parsing", { 
      rawPrice: appointmentTypePrice, 
      parsedPrice: priceValue 
    });
    
    if (priceValue <= 0) {
      throw new Error("Invalid or missing price for this appointment type");
    }

    // Convert to cents for Stripe
    const amountInCents = Math.round(priceValue * 100);
    logStep("Amount calculation", { priceValue, amountInCents });

    logStep("Initializing Stripe client");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    logStep("Stripe client initialized");

    // Check if customer exists
    const customers = await stripe.customers.list({ email, limit: 1 });
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      logStep("Found existing Stripe customer", { customerId });
    } else {
      // Create new customer
      const customer = await stripe.customers.create({
        email,
        name: `${firstName} ${lastName}`,
        phone: phone || undefined,
      });
      customerId = customer.id;
      logStep("Created new Stripe customer", { customerId });
    }

    // Store booking details in metadata
    const bookingMetadata = {
      appointmentTypeID: appointmentTypeID.toString(),
      appointmentTypeName: appointmentTypeName || "Therapy Session",
      datetime,
      calendarID: calendarID?.toString() || "",
      calendarName: calendarName || "",
      firstName,
      lastName,
      email,
      phone: phone || "",
      notes: notes || "",
      intakeFormFields: intakeFormFields || "", // Acuity intake form fields as JSON string
    };

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "eur",
      customer: customerId,
      description: `${appointmentTypeName || "Therapy Session"} with ${calendarName || "therapist"} on ${new Date(datetime).toLocaleDateString()}`,
      metadata: bookingMetadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    logStep("PaymentIntent created", { 
      paymentIntentId: paymentIntent.id, 
      livemode: paymentIntent.livemode,
      clientSecret: paymentIntent.client_secret?.slice(0, 20) + "..." 
    });

    return new Response(JSON.stringify({ 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amountInCents,
      currency: "eur",
      livemode: paymentIntent.livemode,
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
