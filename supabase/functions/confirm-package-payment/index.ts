import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CONFIRM-PACKAGE-PAYMENT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");
    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error("Supabase configuration missing");
    }

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
    logStep("User authenticated", { userId });

    const body = await req.json();
    const { paymentIntentId } = body;

    if (!paymentIntentId) {
      throw new Error("Missing paymentIntentId");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve payment intent to verify it succeeded
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    logStep("Retrieved payment intent", { 
      status: paymentIntent.status, 
      amount: paymentIntent.amount 
    });

    if (paymentIntent.status !== "succeeded") {
      throw new Error(`Payment not completed. Status: ${paymentIntent.status}`);
    }

    // Extract metadata
    const metadata = paymentIntent.metadata;
    const packageId = metadata.packageId;
    const packageName = metadata.packageName;
    const sessions = parseInt(metadata.sessions, 10);

    if (!packageId || !packageName || !sessions) {
      throw new Error("Missing package information in payment metadata");
    }

    // Verify user matches
    if (metadata.userId !== userId) {
      throw new Error("User mismatch");
    }

    logStep("Package details", { packageId, packageName, sessions });

    // Save to user_packages table
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate expiry date (1 year from now)
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);

    const { data: insertedPackage, error: insertError } = await supabaseAdmin
      .from('user_packages')
      .insert({
        user_id: userId,
        package_id: packageId,
        package_name: packageName,
        total_sessions: sessions,
        remaining_sessions: sessions,
        amount_paid: paymentIntent.amount / 100,
        stripe_session_id: paymentIntentId,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      logStep("Error saving package", { error: insertError });
      throw new Error("Failed to save package to database");
    }

    logStep("Package saved to database", { packageId: insertedPackage.id });

    // Get receipt URL if available
    let receiptUrl: string | undefined;
    if (paymentIntent.latest_charge) {
      try {
        const charge = await stripe.charges.retrieve(paymentIntent.latest_charge as string);
        receiptUrl = charge.receipt_url || undefined;
        logStep("Receipt URL retrieved", { receiptUrl });
      } catch (e) {
        logStep("Could not retrieve receipt URL", { error: String(e) });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      package: {
        id: insertedPackage.id,
        name: packageName,
        sessions,
        remaining: sessions,
        expiresAt: expiresAt.toISOString(),
      },
      receiptUrl,
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
