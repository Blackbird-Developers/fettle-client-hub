import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

// Package mapping for Acuity certificate creation
const PACKAGE_APPOINTMENT_TYPES: Record<string, number[]> = {
  "1122832": [], // 3 Session Bundle - empty means all appointment types
  "996385": [],  // 6 Session Bundle
  "1197875": [], // 9 Session Bundle
  "1370588": [], // Youth Bundle 3 x 60min
  "1975510": [], // Youth Bundle 5 x 60min
  "2000708": [], // Couples 3 x 60 min
  "1967869": [], // Couples 5 x 60 min
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CONFIRM-PACKAGE-PAYMENT] ${step}${detailsStr}`);
};

// Ensure an Acuity Client record exists for this email. Acuity does NOT
// auto-create a Client when a Certificate is POSTed — without this, the
// cert sits orphaned in Business Settings → Coupon & Certificate Codes
// and never appears on the customer's profile until they book an
// appointment (which is when Acuity creates the Client implicitly). For
// bundle purchasers who haven't booked yet, the cert is invisible to
// staff. We mirror what staff have been doing manually by POSTing to
// /api/v1/clients after the cert is created.
//
// GET-first to avoid duplicate Clients. Soft-failure — never throws.
async function ensureAcuityClient(
  firstName: string,
  lastName: string,
  email: string
): Promise<{ success: boolean; created: boolean; error?: string }> {
  const acuityUserId = Deno.env.get("ACUITY_USER_ID");
  const acuityApiKey = Deno.env.get("ACUITY_API_KEY");

  if (!acuityUserId || !acuityApiKey) {
    return { success: false, created: false, error: "Acuity credentials not configured" };
  }
  if (!email) {
    return { success: false, created: false, error: "Email required" };
  }
  if (!firstName && !lastName) {
    return { success: false, created: false, error: "First or last name required for Acuity client" };
  }

  const authHeader = btoa(`${acuityUserId}:${acuityApiKey}`);
  const headers = {
    Authorization: `Basic ${authHeader}`,
    "Content-Type": "application/json",
  };

  try {
    // Look for existing Client by email
    const searchUrl = `${ACUITY_API_BASE}/clients?search=${encodeURIComponent(email)}`;
    const searchResp = await fetch(searchUrl, { method: "GET", headers });

    if (searchResp.ok) {
      const found = await searchResp.json();
      const match = Array.isArray(found) && found.find(
        (c: { email?: string }) => (c.email || "").toLowerCase() === email.toLowerCase()
      );
      if (match) {
        logStep("Acuity client already exists, skipping create", { email });
        return { success: true, created: false };
      }
    } else {
      logStep("Acuity client search failed — attempting create anyway", {
        status: searchResp.status,
      });
    }

    logStep("Creating Acuity client", { email, firstName, lastName });

    const createResp = await fetch(`${ACUITY_API_BASE}/clients`, {
      method: "POST",
      headers,
      body: JSON.stringify({ firstName, lastName, email }),
    });

    if (!createResp.ok) {
      const errorText = await createResp.text();
      logStep("Acuity client creation failed", {
        status: createResp.status,
        error: errorText.substring(0, 300),
      });
      return { success: false, created: false, error: `Acuity client API ${createResp.status}` };
    }

    logStep("Acuity client created successfully", { email });
    return { success: true, created: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error ensuring Acuity client", { error: errorMessage });
    return { success: false, created: false, error: errorMessage };
  }
}

// Helper function to create certificate in Acuity
async function createAcuityCertificate(
  email: string,
  firstName: string,
  lastName: string,
  packageId: string,
  packageName: string,
  sessions: number
): Promise<{ success: boolean; certificateId?: number; error?: string }> {
  const acuityUserId = Deno.env.get("ACUITY_USER_ID");
  const acuityApiKey = Deno.env.get("ACUITY_API_KEY");

  if (!acuityUserId || !acuityApiKey) {
    return { success: false, error: "Acuity credentials not configured" };
  }

  const authHeader = btoa(`${acuityUserId}:${acuityApiKey}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const certificateData = {
      productID: parseInt(packageId, 10),
      name: `${firstName} ${lastName}`,
      email: email,
      remainingCounts: sessions,
      appointmentTypeIDs: PACKAGE_APPOINTMENT_TYPES[packageId] || [],
    };

    logStep("Creating Acuity certificate", certificateData);

    const response = await fetch(`${ACUITY_API_BASE}/certificates`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(certificateData),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 504) {
        logStep("Acuity API timeout (504) - certificate creation skipped");
        return { success: false, error: "Acuity API timeout - certificate will sync later" };
      }
      const errorText = await response.text();
      logStep("Acuity certificate creation failed", { status: response.status, error: errorText });
      return { success: false, error: `Acuity API error: ${response.status}` };
    }

    const certificate = await response.json();
    logStep("Acuity certificate created successfully", { certificateId: certificate.id });
    return { success: true, certificateId: certificate.id };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      logStep("Acuity API request timed out");
      return { success: false, error: "Acuity API timeout" };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error creating Acuity certificate", { error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

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

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Idempotency check: if this payment intent was already processed, return the existing package
    // Check for exact paymentIntentId match first
    const { data: existingByPi } = await supabaseAdmin
      .from('user_packages')
      .select('id, package_name, total_sessions, remaining_sessions, expires_at, stripe_session_id')
      .eq('stripe_session_id', paymentIntentId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingByPi) {
      logStep("Payment already processed (exact pi match)", { id: existingByPi.id });
      return new Response(JSON.stringify({
        success: true,
        package: {
          id: existingByPi.id,
          name: existingByPi.package_name,
          sessions: existingByPi.total_sessions,
          remaining: existingByPi.remaining_sessions,
          expiresAt: existingByPi.expires_at,
        },
        alreadyProcessed: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Also check if this function already ran and linked an Acuity cert (within last 5 min)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentLinked } = await supabaseAdmin
      .from('user_packages')
      .select('id, package_name, total_sessions, remaining_sessions, expires_at')
      .eq('user_id', userId)
      .eq('package_id', packageId)
      .like('stripe_session_id', 'acuity-cert-%')
      .gte('created_at', fiveMinAgo)
      .maybeSingle();

    if (recentLinked) {
      logStep("Payment already processed (recently linked to Acuity cert)", { id: recentLinked.id });
      return new Response(JSON.stringify({
        success: true,
        package: {
          id: recentLinked.id,
          name: recentLinked.package_name,
          sessions: recentLinked.total_sessions,
          remaining: recentLinked.remaining_sessions,
          expiresAt: recentLinked.expires_at,
        },
        alreadyProcessed: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Save to user_packages table

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

    // Export to Acuity: Create certificate for two-way sync
    // This allows users to use their credits in both systems
    const acuityCertResult = await createAcuityCertificate(
      metadata.email || "",
      metadata.firstName || "",
      metadata.lastName || "",
      packageId,
      packageName,
      sessions
    );

    if (acuityCertResult.success && acuityCertResult.certificateId) {
      logStep("Acuity certificate created", { certificateId: acuityCertResult.certificateId });

      // Link the DB row to the Acuity certificate so that:
      // 1. sync-acuity-packages recognises this row and won't create a duplicate
      // 2. book-with-package can auto-deduct from the Acuity certificate
      const acuityCertId = `acuity-cert-${acuityCertResult.certificateId}`;
      const { error: linkError } = await supabaseAdmin
        .from('user_packages')
        .update({ stripe_session_id: acuityCertId })
        .eq('id', insertedPackage.id);

      if (linkError) {
        logStep("Failed to link Acuity cert to package row", { error: linkError });
      } else {
        logStep("Linked package row to Acuity certificate", { acuityCertId });
      }

      // Ensure an Acuity Client record exists so the cert is visible on the
      // customer's profile — Acuity won't auto-create one from a cert alone.
      try {
        const clientResult = await ensureAcuityClient(
          metadata.firstName || "",
          metadata.lastName || "",
          metadata.email || ""
        );
        if (!clientResult.success) {
          logStep("Acuity client ensure skipped", { reason: clientResult.error });
        }
      } catch (clientErr) {
        // Defensive: never let Client creation block a successful purchase.
        const msg = clientErr instanceof Error ? clientErr.message : String(clientErr);
        logStep("Acuity client ensure threw", { error: msg });
      }
    } else {
      // Soft failure - don't block the UI, certificate will sync later
      logStep("Acuity certificate creation skipped", { reason: acuityCertResult.error });
    }

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
      acuitySync: {
        success: acuityCertResult.success,
        certificateId: acuityCertResult.certificateId,
        message: acuityCertResult.success
          ? "Certificate created in Acuity"
          : acuityCertResult.error,
      },
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
