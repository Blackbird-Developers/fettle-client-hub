import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-PACKAGE-PAYMENT] ${step}${detailsStr}`);
};

// Package definitions
const PACKAGES: Record<string, { name: string; sessions: number; price: number }> = {
  "1122832": { name: "3 Session Bundle", sessions: 3, price: 225 },
  "1967864": { name: "6 Session Bundle", sessions: 6, price: 420 },
  "1967867": { name: "9 Session Bundle", sessions: 9, price: 585 },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    const body = await req.json();
    const { sessionId } = body;

    if (!sessionId) {
      throw new Error("Missing session ID");
    }

    logStep("Verifying session", { sessionId });

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve the checkout session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    logStep("Session retrieved", { 
      status: session.payment_status,
      metadata: session.metadata 
    });

    if (session.payment_status !== 'paid') {
      throw new Error("Payment not completed");
    }

    const metadata = session.metadata || {};
    const packageId = metadata.packageId;
    const packageInfo = PACKAGES[packageId];

    if (!packageInfo) {
      throw new Error("Invalid package in session metadata");
    }

    const amountPaid = session.amount_total ? session.amount_total / 100 : packageInfo.price;

    logStep("Package verified", {
      packageId,
      packageName: packageInfo.name,
      sessions: packageInfo.sessions,
      amountPaid,
    });

    // Get the authenticated user from the request
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    if (authHeader && supabaseUrl && supabaseAnonKey) {
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabaseAuth.auth.getUser(token);
      userId = userData.user?.id || null;
      logStep("User authenticated", { userId });
    }

    // Save package to database
    if (supabaseUrl && supabaseServiceKey && userId) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        
        // Check if this session has already been processed
        const { data: existingPackage } = await supabaseAdmin
          .from('user_packages')
          .select('id')
          .eq('stripe_session_id', sessionId)
          .maybeSingle();

        if (!existingPackage) {
          // Insert new package
          const { error: insertError } = await supabaseAdmin
            .from('user_packages')
            .insert({
              user_id: userId,
              package_id: packageId,
              package_name: packageInfo.name,
              total_sessions: packageInfo.sessions,
              remaining_sessions: packageInfo.sessions,
              amount_paid: amountPaid,
              stripe_session_id: sessionId,
              expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year expiry
            });

          if (insertError) {
            logStep("Failed to save package to database", { error: insertError });
          } else {
            logStep("Package saved to database");
          }
        } else {
          logStep("Package already exists for this session");
        }
      } catch (dbError) {
        logStep("Database error", { error: dbError });
      }
    }

    // Send confirmation email
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        await supabase.functions.invoke('send-package-confirmation', {
          body: {
            email: metadata.email,
            firstName: metadata.firstName,
            lastName: metadata.lastName,
            packageName: packageInfo.name,
            sessions: packageInfo.sessions,
            amountPaid,
          },
        });
        
        logStep("Confirmation email sent");
      } catch (emailError) {
        logStep("Failed to send confirmation email", { error: emailError });
        // Don't throw - email failure shouldn't break the flow
      }
    }

    return new Response(JSON.stringify({
      success: true,
      packageId,
      packageName: packageInfo.name,
      sessions: packageInfo.sessions,
      amountPaid,
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
