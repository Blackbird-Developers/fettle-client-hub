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
  "1370588": { name: "Youth Bundle 3 x 60min", sessions: 3, price: 305 },
  "1975510": { name: "Youth Bundle 5 x 60min", sessions: 5, price: 505 },
  "2000708": { name: "Couples 3 x 60 min", sessions: 3, price: 320 },
  "1967869": { name: "Couples 5 x 60 min", sessions: 5, price: 525 },
};

// Maps each bundle's Acuity product ID to its session category, so the
// certificate we create is redeemable only against that category's
// appointment types (see resolveAppointmentTypeIDs).
const PACKAGE_CATEGORY: Record<string, "individual" | "youth" | "couples"> = {
  "1122832": "individual", // 3 Session Bundle
  "996385": "individual",  // 6 Session Bundle
  "1197875": "individual", // 9 Session Bundle
  "1370588": "youth",      // Youth Bundle 3 x 60min
  "1975510": "youth",      // Youth Bundle 5 x 60min
  "2000708": "couples",    // Couples 3 x 60 min
  "1967869": "couples",    // Couples 5 x 60 min
};

// Acuity appointment-type name prefixes per category. Mirrors the booking
// UI's category filter (see BookingModal "filteredAppointmentTypes").
const CATEGORY_NAME_PREFIX: Record<string, string> = {
  individual: "Individual Therapy Session",
  youth: "Youth Therapy - Individual Session",
  couples: "Couple's Therapy Session",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SYNC-ACUITY-PACKAGES] ${step}${detailsStr}`);
};

// Resolve which Acuity appointment-type IDs a bundle's credits may be redeemed
// against. Acuity appointment types are per-therapist, so we can't hardcode
// them — instead we fetch the live list and match the same name prefixes the
// booking UI uses. Returns [] on any failure or zero matches, which Acuity
// treats as "all appointment types" — a safe fallback that never produces an
// unredeemable certificate.
async function resolveAppointmentTypeIDs(
  authHeaderBasic: string,
  packageId: string | number
): Promise<number[]> {
  const key = String(packageId);
  const category = PACKAGE_CATEGORY[key];
  const prefix = category ? CATEGORY_NAME_PREFIX[category] : undefined;
  if (!prefix) {
    logStep("No category for package — certificate will allow all types", { packageId: key });
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(`${ACUITY_API_BASE}/appointment-types`, {
      headers: {
        Authorization: `Basic ${authHeaderBasic}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logStep("Could not fetch appointment types — certificate will allow all types", {
        packageId: key,
        category,
        status: response.status,
      });
      return [];
    }

    const types = (await response.json()) as Array<{ id: number; name: string }>;
    const ids = types
      .filter((t) => (t.name ?? "").trim().startsWith(prefix))
      .map((t) => t.id);

    if (ids.length === 0) {
      logStep("No appointment types matched category — certificate will allow all types", {
        packageId: key,
        category,
        prefix,
      });
      return [];
    }

    logStep("Resolved appointment types for certificate", { packageId: key, category, count: ids.length });
    return ids;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("Error resolving appointment types — certificate will allow all types", { packageId: key, error: msg });
    return [];
  }
}

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
  // user_id is the auth uid — the value every other table/RLS check keys on.
  // (profiles.id is a separate random PK and must NOT be used as user_packages.user_id.)
  user_id: string;
  email: string;
}

// Ensure an Acuity Client record exists for this email. Acuity does NOT
// auto-create a Client when a Certificate is POSTed — without this, a cert
// pushed by the sync sits orphaned and never appears on the customer's
// profile until they book an appointment. GET-first to avoid duplicates;
// soft-failure so a Client API hiccup never breaks the sync.
async function ensureAcuityClient(
  authHeaderBasic: string,
  firstName: string,
  lastName: string,
  email: string
): Promise<{ success: boolean; created: boolean; error?: string }> {
  if (!email) {
    return { success: false, created: false, error: "Email required" };
  }
  if (!firstName && !lastName) {
    return { success: false, created: false, error: "First or last name required for Acuity client" };
  }

  const headers = {
    Authorization: `Basic ${authHeaderBasic}`,
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
        logStep("PUSH: Acuity client already exists, skipping create", { email });
        return { success: true, created: false };
      }
    } else {
      logStep("PUSH: Acuity client search failed — attempting create anyway", {
        status: searchResp.status,
      });
    }

    logStep("PUSH: creating Acuity client", { email, firstName, lastName });

    const createResp = await fetch(`${ACUITY_API_BASE}/clients`, {
      method: "POST",
      headers,
      body: JSON.stringify({ firstName, lastName, email }),
    });

    if (!createResp.ok) {
      const errorText = await createResp.text();
      logStep("PUSH: Acuity client creation failed", {
        status: createResp.status,
        error: errorText.substring(0, 300),
      });
      return { success: false, created: false, error: `Acuity client API ${createResp.status}` };
    }

    logStep("PUSH: Acuity client created successfully", { email });
    return { success: true, created: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("PUSH: error ensuring Acuity client", { error: errorMessage });
    return { success: false, created: false, error: errorMessage };
  }
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
      // Don't return early — still need to run push phase below
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
          .select("user_id, email")
          .in("email", emailsToMatch);

        if (profilesError) {
          logStep("Error fetching profiles", { error: profilesError });
          throw new Error("Failed to fetch user profiles");
        }

        (profiles as Profile[] || []).forEach((profile) => {
          // Map to the AUTH uid (profiles.user_id), not the profiles PK. Using
          // the PK here was the C1 bug: it inserted user_packages rows whose
          // user_id matched nothing, so RLS hid them and redemption/lookup
          // missed them — packages paid for but invisible and unredeemable.
          if (profile.email && profile.user_id) {
            emailToUserId.set(profile.email.toLowerCase(), profile.user_id);
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
        .select("id, user_id, remaining_sessions, expires_at")
        .eq("stripe_session_id", acuityCertId);

      const existingPackage = existingPackages?.find((p: { id: string; user_id: string; remaining_sessions: number; expires_at: string | null }) => p.user_id === certUserId);

      if (existingPackages && existingPackages.length > 0) {
        logStep("Found existing packages with this cert ID", {
          certId: cert.id,
          acuityCertId,
          existingCount: existingPackages.length,
          matchesUser: !!existingPackage
        });
      }

      if (existingPackage) {
        // Update remaining sessions and/or expires_at if changed
        const newExpiresAt = cert.expiration || null;
        const sessionsChanged = existingPackage.remaining_sessions !== remainingSessions;
        const expirationChanged = existingPackage.expires_at !== newExpiresAt;

        if (sessionsChanged || expirationChanged) {
          const { error: updateError } = await supabaseAdmin
            .from("user_packages")
            .update({
              remaining_sessions: remainingSessions,
              expires_at: newExpiresAt,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingPackage.id);

          if (updateError) {
            logStep("Error updating package", { error: updateError, certId: cert.id });
            errors.push(`Failed to update cert ${cert.id}: ${updateError.message}`);
          } else {
            logStep("Updated package", {
              certId: cert.id,
              oldRemaining: existingPackage.remaining_sessions,
              newRemaining: remainingSessions,
              oldExpiresAt: existingPackage.expires_at,
              newExpiresAt: newExpiresAt
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
        // Before inserting a new row, check if this Acuity cert was created by
        // confirm-package-payment but not yet linked (stripe_session_id = pi_...).
        // Match by: same user, same package_id, created within 1 hour of each other.
        const certCreatedDate = cert.createdDate ? new Date(cert.createdDate) : null;
        let linkedExisting = false;

        if (certCreatedDate) {
          const windowStart = new Date(certCreatedDate.getTime() - 60 * 60 * 1000).toISOString();
          const windowEnd = new Date(certCreatedDate.getTime() + 60 * 60 * 1000).toISOString();

          const { data: piRows } = await supabaseAdmin
            .from("user_packages")
            .select("id, stripe_session_id, remaining_sessions")
            .eq("user_id", certUserId)
            .eq("package_id", productIdStr)
            .like("stripe_session_id", "pi_%")
            .gte("created_at", windowStart)
            .lte("created_at", windowEnd);

          if (piRows && piRows.length > 0) {
            // Found a matching app-created row — link it to this Acuity cert
            const piRow = piRows[0];
            const { error: linkError } = await supabaseAdmin
              .from("user_packages")
              .update({
                stripe_session_id: acuityCertId,
                remaining_sessions: remainingSessions,
                expires_at: cert.expiration || null,
                updated_at: new Date().toISOString(),
              })
              .eq("id", piRow.id);

            if (linkError) {
              logStep("Error linking pi_ row to Acuity cert", { error: linkError, piRowId: piRow.id, certId: cert.id });
            } else {
              logStep("Linked existing app-created package to Acuity certificate", {
                piRowId: piRow.id,
                oldStripeSessionId: piRow.stripe_session_id,
                newStripeSessionId: acuityCertId,
                oldRemaining: piRow.remaining_sessions,
                newRemaining: remainingSessions,
              });
              linkedExisting = true;
              syncedCount++;
            }
          }
        }

        if (!linkedExisting) {
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
            // 23505 = unique_violation on (user_id, stripe_session_id). This is
            // the guard against the duplicate-row bug: a concurrent/repeated sync
            // tried to insert a cert this user already has. Not an error — the
            // cert is already synced, so skip it rather than creating a duplicate.
            if (insertError.code === "23505") {
              logStep("Duplicate insert blocked by unique constraint — cert already synced", {
                certId: cert.id,
                acuityCertId,
                userId: certUserId,
              });
              skippedCount++;
            } else {
              logStep("Error inserting package", { error: insertError, certId: cert.id });
              errors.push(`Failed to insert cert ${cert.id}: ${insertError.message}`);
            }
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
    }

    // ================================================================
    // PHASE 2: PUSH — Create Acuity certs for unlinked pi_ rows
    // ================================================================
    // Only runs for authenticated users (we need their email for Acuity)
    let pushedCount = 0;

    if (userId && userEmail) {
      logStep("PUSH PHASE: checking for unlinked pi_ rows", { userId });

      // Fetch all pi_ rows for this user
      const { data: piRows } = await supabaseAdmin
        .from("user_packages")
        .select("id, package_id, package_name, total_sessions, remaining_sessions, stripe_session_id, created_at")
        .eq("user_id", userId)
        .like("stripe_session_id", "pi_%");

      if (piRows && piRows.length > 0) {
        logStep("Found unlinked pi_ rows", { count: piRows.length });

        // Get user's profile for name (needed by Acuity)
        const { data: profileData } = await supabaseAdmin
          .from("profiles")
          .select("first_name, last_name")
          .eq("user_id", userId)
          .single();

        const firstName = profileData?.first_name || "";
        const lastName = profileData?.last_name || "";

        // Build a set of acuity-cert IDs already linked to ANY row for this user
        // This prevents linking a pi_ row to a cert that's already used by another row
        const { data: linkedRows } = await supabaseAdmin
          .from("user_packages")
          .select("stripe_session_id")
          .eq("user_id", userId)
          .like("stripe_session_id", "acuity-cert-%");

        const alreadyLinkedCertIds = new Set(
          (linkedRows || []).map((r: { stripe_session_id: string }) => r.stripe_session_id)
        );

        for (const piRow of piRows) {
          // Re-read the row to make sure it's still pi_ (pull phase may have linked it)
          const { data: freshRow } = await supabaseAdmin
            .from("user_packages")
            .select("stripe_session_id")
            .eq("id", piRow.id)
            .single();

          if (!freshRow || !freshRow.stripe_session_id.startsWith("pi_")) {
            logStep("PUSH: row already linked during pull phase, skipping", { rowId: piRow.id });
            continue;
          }

          // Try to find an existing Acuity cert that matches this row
          // Match criteria: same productID + created within 1 hour + not already linked
          const piCreatedAt = new Date(piRow.created_at);
          let matchedCertId: number | null = null;

          for (const cert of certificates) {
            const certIdStr = `acuity-cert-${cert.id}`;

            // Skip certs already linked to another row
            if (alreadyLinkedCertIds.has(certIdStr)) continue;

            // Must be same product
            if (String(cert.productID) !== piRow.package_id) continue;

            // Must be created within 1 hour of each other
            if (cert.createdDate) {
              const certDate = new Date(cert.createdDate);
              const diffMs = Math.abs(piCreatedAt.getTime() - certDate.getTime());
              if (diffMs <= 60 * 60 * 1000) {
                matchedCertId = cert.id;
                break;
              }
            }
          }

          if (matchedCertId) {
            // Found existing cert — just link it
            const acuityCertId = `acuity-cert-${matchedCertId}`;
            const { error: linkError } = await supabaseAdmin
              .from("user_packages")
              .update({
                stripe_session_id: acuityCertId,
                updated_at: new Date().toISOString(),
              })
              .eq("id", piRow.id)
              .eq("stripe_session_id", freshRow.stripe_session_id); // Optimistic lock

            if (!linkError) {
              alreadyLinkedCertIds.add(acuityCertId);
              logStep("PUSH: linked pi_ row to existing Acuity cert", {
                rowId: piRow.id,
                certId: matchedCertId,
              });
              pushedCount++;
            } else {
              logStep("PUSH: failed to link row", { rowId: piRow.id, error: linkError });
            }
          } else {
            // No matching cert found — create one in Acuity
            if (!firstName && !lastName) {
              logStep("PUSH: skipping cert creation — no name in profile", { rowId: piRow.id });
              continue;
            }

            const packageId = piRow.package_id;
            const sessions = piRow.remaining_sessions;

            logStep("PUSH: creating Acuity cert for unlinked row", {
              rowId: piRow.id,
              packageId,
              sessions,
              email: userEmail,
            });

            try {
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 30000);

              const appointmentTypeIDs = await resolveAppointmentTypeIDs(authHeaderBasic, packageId);

              const certData = {
                productID: parseInt(packageId, 10),
                name: `${firstName} ${lastName}`.trim(),
                email: userEmail,
                remainingCounts: sessions,
                appointmentTypeIDs,
              };

              const certResponse = await fetch(`${ACUITY_API_BASE}/certificates`, {
                method: "POST",
                headers: {
                  Authorization: `Basic ${authHeaderBasic}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(certData),
                signal: controller.signal,
              });

              clearTimeout(timeoutId);

              if (!certResponse.ok) {
                const errText = await certResponse.text();
                logStep("PUSH: Acuity cert creation failed", { status: certResponse.status, error: errText });
                continue;
              }

              const newCert = await certResponse.json();
              const newCertId = `acuity-cert-${newCert.id}`;

              logStep("PUSH: Acuity cert created", { certId: newCert.id });

              // Ensure Acuity Client record exists so the cert is visible on
              // the customer's profile. Soft-fail; never blocks the sync.
              try {
                await ensureAcuityClient(authHeaderBasic, firstName, lastName, userEmail);
              } catch (clientErr) {
                const msg = clientErr instanceof Error ? clientErr.message : String(clientErr);
                logStep("PUSH: Acuity client ensure threw", { error: msg });
              }

              // Link the row — use optimistic lock to prevent races
              const { error: linkError } = await supabaseAdmin
                .from("user_packages")
                .update({
                  stripe_session_id: newCertId,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", piRow.id)
                .eq("stripe_session_id", freshRow.stripe_session_id);

              if (!linkError) {
                alreadyLinkedCertIds.add(newCertId);
                logStep("PUSH: linked row to new Acuity cert", {
                  rowId: piRow.id,
                  newCertId,
                });
                pushedCount++;
              } else {
                logStep("PUSH: cert created but link failed (will be caught by pull next time)", {
                  rowId: piRow.id,
                  certId: newCert.id,
                  error: linkError,
                });
              }
            } catch (certError) {
              const msg = certError instanceof Error ? certError.message : String(certError);
              logStep("PUSH: cert creation error", { rowId: piRow.id, error: msg });
            }
          }
        }
      } else {
        logStep("PUSH PHASE: no unlinked pi_ rows found");
      }
    }

    logStep("Sync completed", { synced: syncedCount, pushed: pushedCount, skipped: skippedCount, errors: errors.length });

    return new Response(
      JSON.stringify({
        success: true,
        synced: syncedCount,
        pushed: pushedCount,
        skipped: skippedCount,
        errors: errors.length > 0 ? errors : undefined,
        message: `Synced ${syncedCount} from Acuity, pushed ${pushedCount} to Acuity`,
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
