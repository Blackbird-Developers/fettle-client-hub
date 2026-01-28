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
  type: "counts" | "minutes" | "value";
  remainingCounts: number | null;
  remainingMinutes: number | null;
  remainingValue: number | null;
  appointmentTypeIDs: number[];
  createdDate?: string;
  expiration: string | null;
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

    // Build email to user_id mapping
    const emailToUserId = new Map<string, string>();

    // If we have an authenticated user, use their ID directly
    // Acuity often returns empty email in certificate objects
    if (userId && userEmail) {
      emailToUserId.set(userEmail.toLowerCase(), userId);
      logStep("Using authenticated user for matching", { userId, email: userEmail });
    } else {
      // For batch sync without auth, get profiles for certificates that have emails
      const emailsToMatch = [...new Set(
        certificates
          .map((c) => c.email?.toLowerCase())
          .filter((e): e is string => !!e && e.length > 0)
      )];

      if (emailsToMatch.length > 0) {
        const { data: profiles, error: profilesError } = await supabaseAdmin
          .from("profiles")
          .select("id, email")
          .in("email", emailsToMatch);

        if (profilesError) {
          logStep("Error fetching profiles", { error: profilesError });
          throw new Error("Failed to fetch user profiles");
        }

        (profiles as Profile[] || []).forEach((profile) => {
          if (profile.email) {
            emailToUserId.set(profile.email.toLowerCase(), profile.id);
          }
        });
      }
    }

    logStep("Profile matching ready", {
      totalCertificates: certificates.length,
      matchedProfiles: emailToUserId.size,
      hasAuthUser: !!userId
    });

    let syncedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Process each certificate
    for (const cert of certificates) {
      // Determine user ID: use authenticated user if available, otherwise try to match by email
      let certUserId: string | undefined;

      if (userId && userEmail) {
        // When syncing for authenticated user, all certificates belong to them
        // (since we queried Acuity with their email)
        certUserId = userId;
      } else if (cert.email && cert.email.length > 0) {
        certUserId = emailToUserId.get(cert.email.toLowerCase());
      }

      if (!certUserId) {
        logStep("No matching user for certificate", { email: cert.email || "(empty)", certId: cert.id });
        skippedCount++;
        continue;
      }

      // Determine package info from productID or name
      const productIdStr = String(cert.productID);
      const packageInfo = PACKAGE_MAPPING[productIdStr];

      // Calculate remaining sessions based on certificate type
      // Minutes-based: 50 min = 1 session
      // Counts-based: direct count
      let remainingSessions: number;
      if (cert.type === "minutes" && cert.remainingMinutes !== null) {
        remainingSessions = Math.floor(cert.remainingMinutes / 50);
      } else if (cert.remainingCounts !== null) {
        remainingSessions = cert.remainingCounts;
      } else {
        // Default to package info or skip
        remainingSessions = packageInfo?.sessions || 0;
      }

      logStep("Processing certificate", {
        certId: cert.id,
        type: cert.type,
        remainingMinutes: cert.remainingMinutes,
        remainingCounts: cert.remainingCounts,
        calculatedSessions: remainingSessions
      });

      // Generate a unique identifier for this Acuity certificate
      const acuityCertId = `acuity-cert-${cert.id}`;

      // Check if we already have this certificate synced (check globally, not just for this user)
      const { data: existingPackages } = await supabaseAdmin
        .from("user_packages")
        .select("id, user_id, remaining_sessions")
        .eq("stripe_session_id", acuityCertId);

      const existingPackage = existingPackages?.find((p: { id: string; user_id: string; remaining_sessions: number }) => p.user_id === certUserId);

      if (existingPackages && existingPackages.length > 0) {
        logStep("Found existing packages with this cert ID", {
          certId: cert.id,
          acuityCertId,
          existingCount: existingPackages.length,
          matchesUser: !!existingPackage
        });
      }

      if (existingPackage) {
        // Update remaining sessions if changed
        if (existingPackage.remaining_sessions !== remainingSessions) {
          const { error: updateError } = await supabaseAdmin
            .from("user_packages")
            .update({
              remaining_sessions: remainingSessions,
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
              newRemaining: remainingSessions
            });
            syncedCount++;
          }
        } else {
          logStep("Package already synced and up to date", { certId: cert.id });
          skippedCount++;
        }
      } else if (existingPackages && existingPackages.length > 0) {
        // Certificate exists but for a different user - skip to avoid duplicates
        logStep("Certificate already synced to different user, skipping", {
          certId: cert.id,
          existingUserId: existingPackages[0].user_id,
          requestedUserId: certUserId
        });
        skippedCount++;
      } else {
        // Create new package entry
        const totalSessions = packageInfo?.sessions || remainingSessions;
        const packageName = packageInfo?.name || cert.name || "Acuity Package";

        logStep("Inserting new package", {
          certId: cert.id,
          acuityCertId,
          userId: certUserId,
          packageName,
          totalSessions,
          remainingSessions
        });

        const { error: insertError } = await supabaseAdmin
          .from("user_packages")
          .insert({
            user_id: certUserId,
            package_id: productIdStr,
            package_name: packageName,
            total_sessions: totalSessions,
            remaining_sessions: remainingSessions,
            amount_paid: packageInfo?.price || 0,
            stripe_session_id: acuityCertId, // Use this field to track Acuity cert ID
            expires_at: cert.expiration || null,
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
