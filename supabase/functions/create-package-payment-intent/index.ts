import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PACKAGE-PAYMENT-INTENT] ${step}${detailsStr}`);
};

// Package definitions with Acuity IDs
// Individual 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1122832
// Individual 6: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=996385
// Individual 9: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1197875
// Youth 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1370588
// Youth 5: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1975510
// Couples 3: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=2000708
// Couples 5: https://app.acuityscheduling.com/catalog.php?owner=21301568&action=addCart&clear=1&id=1967869
const PACKAGES: Record<number, { name: string; sessions: number; price: number }> = {
  1122832: { name: "3 Session Bundle", sessions: 3, price: 241.50 },
  996385: { name: "6 Session Bundle", sessions: 6, price: 468 },
  1197875: { name: "9 Session Bundle", sessions: 9, price: 675 },
  1370588: { name: "Youth Bundle 3 x 60min", sessions: 3, price: 305 },
  1975510: { name: "Youth Bundle 5 x 60min", sessions: 5, price: 505 },
  2000708: { name: "Couples 3 x 60 min", sessions: 3, price: 320 },
  1967869: { name: "Couples 5 x 60 min", sessions: 5, price: 525 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");
    if (!supabaseUrl || !supabaseAnonKey) throw new Error("Supabase configuration missing");

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);

    if (userError || !userData.user) {
      throw new Error("User not authenticated");
    }

    const userId = userData.user.id;
    const userEmail = userData.user.email;
    logStep("User authenticated", { userId, email: userEmail });

    const body = await req.json();
    const { packageId, firstName, lastName, email, phone } = body;

    logStep("Received package data", { packageId, email });

    if (!packageId || !firstName || !lastName || !email) {
      throw new Error("Missing required fields");
    }

    const packageInfo = PACKAGES[packageId as number];
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

    // Store package details in metadata
    const packageMetadata = {
      userId,
      packageId: packageId.toString(),
      packageName: packageInfo.name,
      sessions: packageInfo.sessions.toString(),
      firstName,
      lastName,
      email,
      phone: phone || "",
    };

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "eur",
      customer: customerId,
      metadata: packageMetadata,
      automatic_payment_methods: {
        enabled: true,
      },
      description: `[MyFettleHub] ${packageInfo.name} - ${packageInfo.sessions} therapy sessions - ${firstName} ${lastName}`,
    });

    logStep("Payment intent created", { 
      paymentIntentId: paymentIntent.id, 
      amount: amountInCents,
      livemode: paymentIntent.livemode 
    });

    return new Response(JSON.stringify({ 
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amountInCents,
      livemode: paymentIntent.livemode,
      packageName: packageInfo.name,
      sessions: packageInfo.sessions,
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
