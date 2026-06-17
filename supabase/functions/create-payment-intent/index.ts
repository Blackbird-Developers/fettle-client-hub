import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREATE-PAYMENT-INTENT] ${step}${detailsStr}`);
};

// Loyalty coupon codes are EARNED at session milestones (mirrors
// src/hooks/useAchievements.ts) and stored in public.user_achievements. Each
// code maps to the achievement that grants it; a code is only honoured if the
// signed-in caller actually earned that achievement. The discount VALUE comes
// from the matching Stripe coupon (source of truth), so marketing can change
// the percentage in Stripe without a code deploy.
const LOYALTY_COUPONS: Record<string, { achievementId: string }> = {
  FETTLELOYALTY4:  { achievementId: "three_sessions" },
  FETTLELOYALTY5:  { achievementId: "five_sessions" },
  FETTLELOYALTY8:  { achievementId: "ten_sessions" },
  FETTLELOYALTY10: { achievementId: "twenty_sessions" },
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
    
    if (!stripeKey) throw new Error("Our payment system is temporarily unavailable. Please contact hello@fettle.ie for support.");

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
      timezone, // User's timezone for email formatting
      couponCode, // Optional loyalty coupon code (earned reward)
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
      throw new Error("Please fill in all required booking details (name, email, session type, and time).");
    }

    // Parse price - Acuity returns price as string like "72.99"
    const priceValue = parseFloat(appointmentTypePrice || "0");
    logStep("Price parsing", { 
      rawPrice: appointmentTypePrice, 
      parsedPrice: priceValue 
    });
    
    if (priceValue <= 0) {
      throw new Error("This session type does not have a valid price. Please contact hello@fettle.ie for support.");
    }

    // Convert to cents for Stripe
    let amountInCents = Math.round(priceValue * 100);
    logStep("Amount calculation", { priceValue, amountInCents });

    logStep("Initializing Stripe client");
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    logStep("Stripe client initialized");

    // ── Loyalty coupon (optional) ─────────────────────────────────────────
    // A coupon NEVER blocks the booking — any problem just means full price
    // plus a `couponRejected` reason the UI can surface. We (1) confirm the
    // code is a known loyalty reward, (2) confirm the signed-in caller earned
    // it (user_achievements), then (3) read the discount from the Stripe coupon.
    const originalAmount = amountInCents;
    let discountApplied = false;
    let appliedDiscountPercent = 0;
    let couponRejected: string | null = null;
    const normalizedCoupon = (couponCode || "").toString().trim().toUpperCase();

    if (normalizedCoupon) {
      const loyalty = LOYALTY_COUPONS[normalizedCoupon];
      if (!loyalty) {
        couponRejected = "unknown_code";
        logStep("Coupon rejected: unknown code", { normalizedCoupon });
      } else {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        const token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();

        // Identify the caller from the Supabase JWT (functions.invoke sends it).
        let userId: string | null = null;
        if (supabaseUrl && anonKey && token) {
          try {
            const authClient = createClient(supabaseUrl, anonKey);
            const { data: u } = await authClient.auth.getUser(token);
            userId = u.user?.id ?? null;
          } catch (_e) { /* unauthenticated — handled below */ }
        }

        if (!userId) {
          couponRejected = "not_signed_in";
          logStep("Coupon rejected: caller not authenticated");
        } else if (!supabaseUrl || !serviceKey) {
          couponRejected = "server_unavailable";
          logStep("Coupon check skipped: supabase service env missing");
        } else {
          // Did this user earn the achievement that grants the code?
          const admin = createClient(supabaseUrl, serviceKey);
          const { data: earned, error: earnErr } = await admin
            .from("user_achievements")
            .select("achievement_id")
            .eq("user_id", userId)
            .eq("achievement_id", loyalty.achievementId)
            .maybeSingle();

          if (earnErr) {
            couponRejected = "validation_error";
            logStep("Coupon validation error", { error: earnErr.message });
          } else if (!earned) {
            couponRejected = "not_earned";
            logStep("Coupon rejected: reward not unlocked on this account", { userId, normalizedCoupon });
          } else {
            // Earned — take the discount from the Stripe coupon (source of truth).
            try {
              const coupon = await stripe.coupons.retrieve(normalizedCoupon);
              if (!coupon || coupon.valid === false) {
                couponRejected = "coupon_invalid";
                logStep("Coupon rejected: not valid in Stripe", { normalizedCoupon });
              } else if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
                appliedDiscountPercent = coupon.percent_off;
                const discount = Math.round(originalAmount * coupon.percent_off / 100);
                amountInCents = Math.max(originalAmount - discount, 0);
                discountApplied = true;
              } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
                amountInCents = Math.max(originalAmount - coupon.amount_off, 0);
                discountApplied = true;
              } else {
                couponRejected = "coupon_no_discount";
              }
              if (discountApplied) {
                logStep("Coupon applied", { normalizedCoupon, originalAmount, newAmount: amountInCents, percentOff: appliedDiscountPercent });
              }
            } catch (e) {
              // Coupon doesn't exist in Stripe yet, or retrieve failed.
              couponRejected = "coupon_not_found";
              logStep("Coupon rejected: Stripe retrieve failed", { normalizedCoupon, error: String(e) });
            }
          }
        }
      }
    }

    // Stripe rejects charges under €0.50; loyalty discounts (≤10%) can't reach
    // that on a real session price, but guard anyway.
    if (discountApplied && amountInCents < 50) {
      logStep("Discount would drop below Stripe minimum — reverting to full price", { amountInCents });
      amountInCents = originalAmount;
      discountApplied = false;
      appliedDiscountPercent = 0;
      couponRejected = "below_minimum";
    }

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
      // Origin marker. This Stripe account is shared with the separate [Website]
      // booking app; the stripe-webhook backstop must ONLY act on payments THIS
      // app created, or it tries to re-book (and refunds) [Website]'s bookings.
      source: "myfettlehub",
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
      timezone: timezone || "Europe/Dublin", // User's timezone for email formatting
      // Loyalty discount audit trail (empty unless a coupon was actually applied)
      couponCode: discountApplied ? normalizedCoupon : "",
      discountPercent: discountApplied ? String(appliedDiscountPercent) : "",
      originalAmount: discountApplied ? String(originalAmount) : "",
    };

    // Create PaymentIntent with auto-capture to support all payment methods
    // (Revolut Pay, PayPal etc. do NOT support manual capture)
    // If Acuity booking fails after payment, a refund is issued instead
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "eur",
      customer: customerId,
      description: `[MyFettleHub] ${appointmentTypeName || "Therapy Session"} with ${calendarName || "therapist"} - ${firstName} ${lastName} - ${new Date(datetime).toLocaleDateString()}`,
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
      // Loyalty coupon outcome — the UI uses these to show the discount or to
      // explain why a code wasn't applied. originalAmount lets it show was/now.
      discountApplied,
      discountPercent: appliedDiscountPercent,
      originalAmount,
      couponRejected,
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
