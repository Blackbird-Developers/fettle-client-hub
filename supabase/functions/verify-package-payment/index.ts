import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[VERIFY-PACKAGE-PAYMENT] ${step}${detailsStr}`);
};

// Package definitions with Acuity IDs
const PACKAGES: Record<string, { name: string; sessions: number; price: number }> = {
  "1122832": { name: "3 Session Bundle", sessions: 3, price: 241.50 },
  "996385": { name: "6 Session Bundle", sessions: 6, price: 468 },
  "1197875": { name: "9 Session Bundle", sessions: 9, price: 675 },
  "1370588": { name: "Youth Bundle 3 x 60min", sessions: 3, price: 305 },
  "1975510": { name: "Youth Bundle 5 x 60min", sessions: 5, price: 505 },
  "2000708": { name: "Couples 3 x 60 min", sessions: 3, price: 320 },
  "1967869": { name: "Couples 5 x 60 min", sessions: 5, price: 525 },
};

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

// Ensure an Acuity Client record exists for this email. Acuity does NOT
// auto-create a Client when a Certificate is POSTed — without this, the
// cert sits orphaned in Business Settings → Coupon & Certificate Codes
// and never appears on the customer's profile until they book an
// appointment. GET-first to avoid duplicate Clients. Soft-failure.
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

    // Resolve user_id. JWT is preferred, but Stripe-hosted checkout often
    // takes long enough (3DS, mobile in-app browsers) that the session has
    // expired by the time we redirect back. Fall back to looking the user
    // up by the email stored in metadata so we don't lose fulfillment.
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;

    if (authHeader && supabaseUrl && supabaseAnonKey) {
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
      const token = authHeader.replace("Bearer ", "");
      const { data: userData } = await supabaseAuth.auth.getUser(token);
      userId = userData.user?.id || null;
      if (userId) logStep("User resolved from JWT", { userId });
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase service credentials missing");
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    if (!userId && metadata.email) {
      // JWT missing/expired — try email lookup
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('user_id')
        .ilike('email', metadata.email)
        .maybeSingle();
      if (profile?.user_id) {
        userId = profile.user_id;
        logStep("User resolved from email fallback", { userId, email: metadata.email });
      }
    }

    if (!userId) {
      // No user_id means we cannot create a user_packages row. Fail loudly
      // instead of returning success, so the caller sees a real error and
      // staff can recover the orphaned payment.
      throw new Error(
        "Could not resolve user_id from JWT or metadata email — payment captured but cannot be linked to a user"
      );
    }

    // Save package to database — re-throw on DB errors so a 500 surfaces to
    // the UI instead of a misleading "success".
    try {
      // Idempotency: skip if this checkout session has already been processed
      // (matches confirm-package-payment's behaviour).
      const { data: existingPackage } = await supabaseAdmin
        .from('user_packages')
        .select('id')
        .eq('stripe_session_id', sessionId)
        .maybeSingle();

      if (existingPackage) {
        logStep("Package already exists for this session", { id: existingPackage.id });
      } else {
        const { data: insertedRow, error: insertError } = await supabaseAdmin
          .from('user_packages')
          .insert({
            user_id: userId,
            package_id: packageId,
            package_name: packageInfo.name,
            total_sessions: packageInfo.sessions,
            remaining_sessions: packageInfo.sessions,
            amount_paid: amountPaid,
            stripe_session_id: sessionId,
            expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          })
          .select('id')
          .single();

        if (insertError) {
          logStep("Failed to save package to database", { error: insertError });
          throw new Error(`Failed to save package: ${insertError.message}`);
        }
        logStep("Package saved to database", { id: insertedRow?.id });

        // Create Acuity certificate
        const acuityCertResult = await createAcuityCertificate(
          metadata.email || "",
          metadata.firstName || "",
          metadata.lastName || "",
          packageId,
          packageInfo.sessions
        );

        if (acuityCertResult.success && acuityCertResult.certificateId) {
          logStep("Acuity certificate created", { certificateId: acuityCertResult.certificateId });

          // Re-link the row to the Acuity certificate so sync-acuity-packages
          // and book-with-package recognise it (mirrors confirm-package-payment).
          const acuityCertId = `acuity-cert-${acuityCertResult.certificateId}`;
          const { error: linkError } = await supabaseAdmin
            .from('user_packages')
            .update({ stripe_session_id: acuityCertId })
            .eq('id', insertedRow.id);
          if (linkError) {
            logStep("Failed to link Acuity cert to package row", { error: linkError });
          } else {
            logStep("Linked package row to Acuity certificate", { acuityCertId });
          }

          // Ensure Acuity Client record exists so the cert is visible on
          // the customer's profile. Soft-fail; never blocks the purchase.
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
            const msg = clientErr instanceof Error ? clientErr.message : String(clientErr);
            logStep("Acuity client ensure threw", { error: msg });
          }
        } else {
          logStep("Acuity certificate creation skipped", { reason: acuityCertResult.error });
        }

        // Send confirmation email — only on new insert, so re-verifies don't
        // spam duplicates.
        try {
          await supabaseAdmin.functions.invoke('send-package-confirmation', {
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
          const msg = emailError instanceof Error ? emailError.message : String(emailError);
          logStep("Failed to send confirmation email", { error: msg });
          // Email failure does not block fulfillment.
        }
      }
    } catch (dbError) {
      // Re-throw — the outer catch turns this into a 500 with a real error
      // message instead of a misleading "success" response.
      throw dbError;
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
