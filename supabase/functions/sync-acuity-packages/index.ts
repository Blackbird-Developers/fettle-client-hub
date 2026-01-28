import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

// Package mapping: Acuity product IDs to package details
const PACKAGE_MAPPING: Record<string, { name: string; sessions: number; price: number }> = {
  "1122832": { name: "3 Session Bundle", sessions: 3, price: 241.50 },
  "996385": { name: "6 Session Bundle", sessions: 6, price: 468 },
  "1197875": { name: "9 Session Bundle", sessions: 9, price: 675 },
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SYNC-ACUITY-PACKAGES] ${step}${detailsStr}`);
};

interface AcuityCertificate {
  id: number;
  certificate: string;
  productID: number;
  name: string;
  email: string;
  remainingCounts: number;
  appointmentTypeIDs: number[];
  createdDate: string;
  expirationDate: string | null;
}

interface Profile {
  id: string;
  email: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!acuityUserId || !acuityApiKey) {
      throw new Error("Acuity credentials not configured");
    }

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error("Supabase configuration missing");
    }

    // Authenticate user (optional - can be called without auth for background sync)
    let userId: string | null = null;
    let userEmail: string | null = null;

    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
      const token = authHeader.replace("Bearer ", "");
      const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);

      if (!userError && userData.user) {
        userId = userData.user.id;
        userEmail = userData.user.email || null;
        logStep("User authenticated", { userId, email: userEmail });
      }
    }

    // Parse request body for specific email to sync (optional)
    let targetEmail: string | null = null;
    try {
      const body = await req.json();
      targetEmail = body.email || null;
    } catch {
      // No body provided, that's ok
    }

    // If user is authenticated, sync only their certificates
    if (userEmail) {
      targetEmail = userEmail;
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const authHeaderBasic = btoa(`${acuityUserId}:${acuityApiKey}`);

    // Fetch certificates from Acuity with timeout handling
    let certificates: AcuityCertificate[] = [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const certificatesUrl = targetEmail
        ? `${ACUITY_API_BASE}/certificates?email=${encodeURIComponent(targetEmail)}`
        : `${ACUITY_API_BASE}/certificates`;

      logStep("Fetching certificates from Acuity", { url: certificatesUrl });

      const response = await fetch(certificatesUrl, {
        headers: {
          Authorization: `Basic ${authHeaderBasic}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 504) {
          logStep("Acuity API timeout (504) - sync skipped gracefully");
          return new Response(
            JSON.stringify({
              success: true,
              synced: 0,
              skipped: true,
              message: "Acuity API timeout - sync will retry later",
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            }
          );
        }
        throw new Error(`Acuity API error: ${response.status}`);
      }

      certificates = await response.json();
      logStep("Fetched certificates from Acuity", { count: certificates.length });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        logStep("Acuity API request timed out - sync skipped gracefully");
        return new Response(
          JSON.stringify({
            success: true,
            synced: 0,
            skipped: true,
            message: "Acuity API timeout - sync will retry later",
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          }
        );
      }
      throw error;
    }

    if (certificates.length === 0) {
      logStep("No certificates found in Acuity");
      return new Response(
        JSON.stringify({
          success: true,
          synced: 0,
          message: "No certificates found to sync",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Get all profiles to match emails to user IDs
    const emailsToMatch = [...new Set(certificates.map((c) => c.email.toLowerCase()))];

    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("profiles")
      .select("id, email")
      .in("email", emailsToMatch);

    if (profilesError) {
      logStep("Error fetching profiles", { error: profilesError });
      throw new Error("Failed to fetch user profiles");
    }

    // Create email to user_id mapping
    const emailToUserId = new Map<string, string>();
    (profiles as Profile[] || []).forEach((profile) => {
      if (profile.email) {
        emailToUserId.set(profile.email.toLowerCase(), profile.id);
      }
    });

    logStep("Matched profiles", {
      totalCertificates: certificates.length,
      matchedProfiles: emailToUserId.size
    });

    let syncedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Process each certificate
    for (const cert of certificates) {
      const certUserId = emailToUserId.get(cert.email.toLowerCase());

      if (!certUserId) {
        logStep("No matching user for certificate", { email: cert.email, certId: cert.id });
        skippedCount++;
        continue;
      }

      // Determine package info from productID or name
      const productIdStr = String(cert.productID);
      const packageInfo = PACKAGE_MAPPING[productIdStr];

      // Generate a unique identifier for this Acuity certificate
      const acuityCertId = `acuity-cert-${cert.id}`;

      // Check if we already have this certificate synced
      const { data: existingPackage } = await supabaseAdmin
        .from("user_packages")
        .select("id, remaining_sessions")
        .eq("user_id", certUserId)
        .eq("stripe_session_id", acuityCertId)
        .maybeSingle();

      if (existingPackage) {
        // Update remaining sessions if changed
        if (existingPackage.remaining_sessions !== cert.remainingCounts) {
          const { error: updateError } = await supabaseAdmin
            .from("user_packages")
            .update({
              remaining_sessions: cert.remainingCounts,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingPackage.id);

          if (updateError) {
            logStep("Error updating package", { error: updateError, certId: cert.id });
            errors.push(`Failed to update cert ${cert.id}: ${updateError.message}`);
          } else {
            logStep("Updated package sessions", {
              certId: cert.id,
              oldRemaining: existingPackage.remaining_sessions,
              newRemaining: cert.remainingCounts
            });
            syncedCount++;
          }
        } else {
          logStep("Package already synced and up to date", { certId: cert.id });
          skippedCount++;
        }
      } else {
        // Create new package entry
        const totalSessions = packageInfo?.sessions || cert.remainingCounts;
        const packageName = packageInfo?.name || cert.name || "Acuity Package";

        const { error: insertError } = await supabaseAdmin
          .from("user_packages")
          .insert({
            user_id: certUserId,
            package_id: productIdStr,
            package_name: packageName,
            total_sessions: totalSessions,
            remaining_sessions: cert.remainingCounts,
            amount_paid: packageInfo?.price || 0,
            stripe_session_id: acuityCertId, // Use this field to track Acuity cert ID
            expires_at: cert.expirationDate || null,
          });

        if (insertError) {
          logStep("Error inserting package", { error: insertError, certId: cert.id });
          errors.push(`Failed to insert cert ${cert.id}: ${insertError.message}`);
        } else {
          logStep("Created new package from Acuity certificate", {
            certId: cert.id,
            userId: certUserId,
            packageName
          });
          syncedCount++;
        }
      }
    }

    logStep("Sync completed", { synced: syncedCount, skipped: skippedCount, errors: errors.length });

    return new Response(
      JSON.stringify({
        success: true,
        synced: syncedCount,
        skipped: skippedCount,
        errors: errors.length > 0 ? errors : undefined,
        message: `Synced ${syncedCount} packages from Acuity`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
