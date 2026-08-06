import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

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

    const appointmentTypeIDs = await resolveAppointmentTypeIDs(authHeader, packageId);

    const certificateData = {
      productID: parseInt(packageId, 10),
      name: `${firstName} ${lastName}`,
      email: email,
      remainingCounts: sessions,
      appointmentTypeIDs,
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

    // Resolve the caller. Two legitimate callers exist:
    //   1. The browser, presenting the buyer's JWT.
    //   2. The stripe-webhook backstop, server-to-server with the anon key —
    //      Stripe cannot mint a Supabase JWT, so there is no user token to send.
    // When a real user token is present we bind to it (and reject mismatches
    // below). Otherwise we fall back to the PaymentIntent's userId, which is
    // trustworthy: only create-package-payment-intent writes that metadata, and
    // we read it back from Stripe with our own secret key.
    const authHeader = req.headers.get("Authorization");
    let jwtUserId: string | null = null;

    if (authHeader) {
      const token = authHeader.replace("Bearer ", "").trim();
      // The anon key is not a user token — don't waste a round trip on it.
      if (token && token !== supabaseAnonKey) {
        const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
        const { data: userData } = await supabaseAuth.auth.getUser(token);
        jwtUserId = userData?.user?.id ?? null;
      }
    }

    logStep(jwtUserId ? "Authenticated via user JWT" : "No user JWT — server-to-server call", { jwtUserId });

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

    // The purchase always belongs to the userId recorded on the PaymentIntent.
    // A browser caller must BE that user; a server-to-server caller inherits it.
    if (!metadata.userId) {
      throw new Error("Payment metadata has no userId — cannot attribute this package");
    }
    if (jwtUserId && jwtUserId !== metadata.userId) {
      throw new Error("User mismatch");
    }
    const userId = metadata.userId;

    logStep("Package details", { packageId, packageName, sessions, userId });

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const packageResponse = (row: {
      id: string;
      package_name?: string;
      total_sessions?: number;
      remaining_sessions?: number;
      expires_at?: string;
    }, extra: Record<string, unknown> = {}) =>
      new Response(JSON.stringify({
        success: true,
        package: {
          id: row.id,
          name: row.package_name ?? packageName,
          sessions: row.total_sessions ?? sessions,
          remaining: row.remaining_sessions ?? sessions,
          expiresAt: row.expires_at,
        },
        ...extra,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });

    // IDEMPOTENCY. The authoritative "this purchase is fully fulfilled" marker is
    // acuity_certificate_id stamped on the PaymentIntent — durable, visible to
    // every caller (browser, redirect handler, webhook backstop), and unlike the
    // DB row it is only ever written AFTER the Acuity certificate really exists.
    if (paymentIntent.metadata?.acuity_certificate_id) {
      logStep("Already fulfilled — certificate exists", {
        certificateId: paymentIntent.metadata.acuity_certificate_id,
      });
      const { data: row } = await supabaseAdmin
        .from('user_packages')
        .select('id, package_name, total_sessions, remaining_sessions, expires_at')
        .eq('stripe_session_id', `acuity-cert-${paymentIntent.metadata.acuity_certificate_id}`)
        .eq('user_id', userId)
        .maybeSingle();
      if (row) return packageResponse(row, { alreadyProcessed: true });
      // Cert exists but no row (e.g. cert made manually by staff) — let
      // sync-acuity-packages reconcile it rather than minting a second cert.
      return new Response(JSON.stringify({
        success: true,
        alreadyProcessed: true,
        acuitySync: { success: true, certificateId: paymentIntent.metadata.acuity_certificate_id },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // CONCURRENCY GUARD. The browser call, the redirect-return handler and the
    // stripe-webhook backstop can all run for this PaymentIntent at once. The
    // check above is start-of-function only, so without a lock two callers both
    // pass it and the customer gets TWO Acuity certificates for one payment.
    // Reuses the same atomic claim as confirm-payment-and-book (keyed on the PI).
    let claimAcquired = true; // fail-open: never block a paid fulfilment on lock infra
    try {
      const { data: claimed, error: claimError } = await supabaseAdmin.rpc("claim_booking", {
        p_payment_intent_id: paymentIntentId,
      });
      if (claimError) {
        logStep("WARNING: claim_booking failed — proceeding WITHOUT concurrency lock", { error: claimError.message });
      } else {
        claimAcquired = claimed === true;
      }
    } catch (e) {
      logStep("WARNING: claim_booking threw — proceeding WITHOUT concurrency lock", { error: String(e) });
    }

    if (!claimAcquired) {
      // Another invocation is fulfilling this payment. Wait for it to stamp the
      // certificate, then mirror its result instead of creating a duplicate.
      logStep("Another invocation holds the claim — mirroring its outcome", { paymentIntentId });
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const latest = await stripe.paymentIntents.retrieve(paymentIntentId);
        const certId = latest.metadata?.acuity_certificate_id;
        if (certId) {
          logStep("Winner fulfilled — returning success", { certificateId: certId });
          const { data: row } = await supabaseAdmin
            .from('user_packages')
            .select('id, package_name, total_sessions, remaining_sessions, expires_at')
            .eq('stripe_session_id', `acuity-cert-${certId}`)
            .eq('user_id', userId)
            .maybeSingle();
          if (row) return packageResponse(row, { alreadyProcessed: true });
          return new Response(JSON.stringify({
            success: true,
            alreadyProcessed: true,
            acuitySync: { success: true, certificateId: certId },
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
        }
      }
      // Winner didn't settle in time. Report not-settled so the webhook backstop
      // returns 500 and Stripe retries later; the browser just sees a soft error.
      logStep("Winner did not settle within wait window", { paymentIntentId });
      return new Response(JSON.stringify({
        success: false,
        settled: false,
        error: "Your package is still being activated. Please refresh in a moment.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // Find-or-create the user_packages row.
    //
    // A row may already exist from an earlier attempt whose Acuity certificate
    // call failed (the row is inserted BEFORE the cert is created, and cert
    // failure is soft). Such a row still carries the raw PI id as its
    // stripe_session_id — it is unfulfilled, so we reuse it and retry the
    // certificate rather than returning early. Returning early here was why a
    // failed certificate could never be recovered: every retry saw the row,
    // declared success, and left the customer with no bundle in Acuity.
    const { data: existingByPi } = await supabaseAdmin
      .from('user_packages')
      .select('id, package_name, total_sessions, remaining_sessions, expires_at, stripe_session_id')
      .eq('stripe_session_id', paymentIntentId)
      .eq('user_id', userId)
      .maybeSingle();

    let insertedPackage: { id: string; expires_at: string } | null = existingByPi
      ? { id: existingByPi.id, expires_at: existingByPi.expires_at }
      : null;

    if (insertedPackage) {
      logStep("Reusing unfulfilled package row from earlier attempt — retrying certificate", {
        id: insertedPackage.id,
      });
    } else {
      // Calculate expiry date (1 year from now)
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);

      const { data: created, error: insertError } = await supabaseAdmin
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

      if (insertError || !created) {
        logStep("Error saving package", { error: insertError });
        throw new Error("Failed to save package to database");
      }
      insertedPackage = { id: created.id, expires_at: created.expires_at };
    }

    const expiresAt = new Date(insertedPackage.expires_at);

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

      // Stamp the PaymentIntent with the certificate id. This is the durable,
      // cross-process "fulfilled" marker: the stripe-webhook backstop reads it
      // back to decide whether to ack or ask Stripe to retry, and concurrent
      // callers use it to avoid minting a second certificate. Best-effort — if
      // it fails, the worst case is a redundant retry that hits the DB-row
      // reuse path above, not a duplicate certificate.
      try {
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: { ...metadata, acuity_certificate_id: String(acuityCertResult.certificateId) },
        });
        logStep("Stamped PaymentIntent with certificate id", { certificateId: acuityCertResult.certificateId });
      } catch (stampErr) {
        logStep("WARNING: failed to stamp PI with certificate id", { error: String(stampErr) });
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

    // ── Referral credits (best-effort; never blocks the purchase) ────────────
    // The customer just paid REAL money for a package, so (1) consume any
    // referral credit applied to this payment, and (2) unlock the "first paid"
    // referral rewards for them and their referrer.
    try {
      const applied = parseInt(metadata.referralCreditApplied || "0", 10);
      if (applied > 0) {
        const { data: existing } = await supabaseAdmin
          .from("referral_redemptions").select("id")
          .eq("booking_ref", paymentIntentId).limit(1);
        if (!existing || existing.length === 0) {
          await supabaseAdmin.rpc("redeem_referral_credit", {
            uid: userId, want_cents: applied,
            p_booking_type: "package", p_booking_ref: paymentIntentId,
          });
          logStep("Referral credit redeemed", { userId, applied });
        }
      }
      if (paymentIntent.amount > 0) {
        const { data: qualified } = await supabaseAdmin.rpc("qualify_referral", { referee_id: userId });
        if (qualified) logStep("Referral rewards unlocked (first paid purchase)", { userId });
      }
    } catch (e) {
      logStep("Referral credit handling failed (non-fatal)", { error: String(e) });
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
