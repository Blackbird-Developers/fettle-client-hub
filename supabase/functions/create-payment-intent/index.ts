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

    // ── Discount codes (optional) ─────────────────────────────────────────
    // Two kinds share the one input field:
    //   1. Loyalty rewards (FETTLELOYALTY…) — achievement-gated per account,
    //      validated against user_achievements.
    //   2. Marketing discount codes — Stripe PROMOTION CODES on the shared
    //      Stripe account, resolved exactly like the main fettle.ie booking
    //      widget does, so one code works on both booking surfaces.
    //   3. Acuity coupons — checked via /certificates/check when Stripe has
    //      no matching promotion code (see the fallback below).
    //   4. Session-bundle certificates — not a discount at all; detected in
    //      the same fallback and returned as `packageCertificate` so the UI
    //      links the bundle and books with a package credit.
    // A code NEVER blocks the booking — any problem just means full price
    // plus a `couponRejected` reason the UI can surface.
    const originalAmount = amountInCents;
    let discountApplied = false;
    let appliedDiscountPercent = 0; // 0 when a fixed-amount code applied
    let appliedDiscountAmount = 0;  // cents off (set for every applied code)
    let appliedPromotionCodeId = "";
    let appliedCouponId = "";
    let appliedAcuityCertificate = ""; // set when an Acuity coupon funds the discount
    // Set when the "coupon" turns out to be a session-bundle certificate. The
    // UI links it to the account (redeem-package-code) and books with a
    // package credit instead — no PaymentIntent is created (see below).
    let packageCertificate: {
      code: string;
      certificateId: number | null;
      type: string;
      name: string;
      productID: string;
    } | null = null;
    let couponRejected: string | null = null;
    const trimmedCoupon = (couponCode || "").toString().trim();
    const normalizedCoupon = trimmedCoupon.toUpperCase();

    if (normalizedCoupon) {
      const loyalty = LOYALTY_COUPONS[normalizedCoupon];
      if (!loyalty) {
        // Not a loyalty reward — try it as a Stripe promotion code. Mirrors
        // computeDiscountBreakdown in the [Website] booking widget: same
        // checks, same order, so a code behaves identically on both surfaces.
        try {
          const listed = await stripe.promotionCodes.list({
            code: trimmedCoupon,
            active: true,
            limit: 20,
          });
          const matches = Array.isArray(listed?.data) ? listed.data : [];
          const promo = matches.find(
            (p: any) => (p?.code || "").trim().toLowerCase() === trimmedCoupon.toLowerCase(),
          );
          if (!promo) {
            couponRejected = "unknown_code";
            logStep("Discount code rejected: no matching Stripe promotion code", { trimmedCoupon });
          } else {
            const promoCoupon = promo.coupon;
            const restrictions = promo.restrictions || {};
            if (!promo.active || !promoCoupon || promoCoupon.valid === false) {
              couponRejected = "promo_inactive";
            } else if (promo.customer) {
              // Customer-restricted codes can't be safely honoured here.
              couponRejected = "promo_restricted";
            } else if (promo.expires_at && promo.expires_at * 1000 <= Date.now()) {
              couponRejected = "promo_expired";
            } else if (restrictions.first_time_transaction) {
              // Only Stripe-hosted checkout can enforce first-time-only.
              couponRejected = "promo_restricted";
            } else if (
              typeof restrictions.minimum_amount === "number" &&
              (String(restrictions.minimum_amount_currency || "eur").toLowerCase() !== "eur" ||
                originalAmount < restrictions.minimum_amount)
            ) {
              couponRejected = "promo_minimum";
            } else {
              let off = 0;
              if (typeof promoCoupon.percent_off === "number" && promoCoupon.percent_off > 0) {
                off = Math.round(originalAmount * promoCoupon.percent_off / 100);
                appliedDiscountPercent = promoCoupon.percent_off;
              } else if (typeof promoCoupon.amount_off === "number" && promoCoupon.amount_off > 0) {
                if (promoCoupon.currency && String(promoCoupon.currency).toLowerCase() !== "eur") {
                  couponRejected = "promo_currency";
                } else {
                  off = promoCoupon.amount_off;
                }
              } else {
                const eurOption = (promoCoupon.currency_options || {})["eur"];
                if (eurOption && typeof eurOption.amount_off === "number" && eurOption.amount_off > 0) {
                  off = eurOption.amount_off;
                }
              }
              if (!couponRejected) {
                if (off <= 0) {
                  couponRejected = "promo_no_discount";
                } else {
                  appliedDiscountAmount = Math.min(off, originalAmount);
                  amountInCents = originalAmount - appliedDiscountAmount;
                  discountApplied = true;
                  appliedPromotionCodeId = promo.id;
                  appliedCouponId = promoCoupon.id || "";
                  logStep("Marketing discount code applied", {
                    trimmedCoupon,
                    promotionCodeId: promo.id,
                    originalAmount,
                    newAmount: amountInCents,
                    percentOff: appliedDiscountPercent || null,
                  });
                }
              }
            }
            if (couponRejected) {
              logStep("Discount code rejected", { trimmedCoupon, reason: couponRejected });
            }
          }
        } catch (e) {
          couponRejected = "validation_error";
          logStep("Discount code lookup failed", { trimmedCoupon, error: String(e) });
        }

        // ── Acuity coupon fallback ────────────────────────────────────────
        // The clinic team creates most marketing coupons in Acuity (Business
        // Settings → Coupons), not Stripe. If Stripe knows nothing about the
        // code, ask Acuity's certificate check. Verified response shape for a
        // coupon: { couponID, type: "coupon", discountType: "price"|
        // "percentage", discountAmount, appointmentTypeIDs, expiration }.
        // On success we discount the Stripe charge here and stamp the code in
        // metadata so confirm-payment-and-book passes `certificate` on the
        // Acuity booking — Acuity then records the redemption itself.
        if (couponRejected === "unknown_code") {
          const acuityUserId = Deno.env.get("ACUITY_USER_ID");
          const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
          if (acuityUserId && acuityApiKey) {
            try {
              const checkUrl =
                "https://acuityscheduling.com/api/v1/certificates/check" +
                `?certificate=${encodeURIComponent(trimmedCoupon)}` +
                `&appointmentTypeID=${encodeURIComponent(String(appointmentTypeID))}` +
                `&email=${encodeURIComponent(email || "")}`;
              const certResp = await fetch(checkUrl, {
                headers: { Authorization: `Basic ${btoa(`${acuityUserId}:${acuityApiKey}`)}` },
              });
              if (certResp.ok) {
                const cert = await certResp.json();
                if (cert?.type === "coupon") {
                  const dt = String(cert.discountType || "").toLowerCase();
                  const da = Number(cert.discountAmount);
                  let off = 0;
                  if (dt === "price" && da > 0) {
                    off = Math.round(da * 100); // euros off → cents
                  } else if (dt.startsWith("percent") && da > 0) {
                    off = Math.round(originalAmount * da / 100);
                    appliedDiscountPercent = da;
                  }
                  if (off > 0) {
                    appliedDiscountAmount = Math.min(off, originalAmount);
                    amountInCents = originalAmount - appliedDiscountAmount;
                    discountApplied = true;
                    appliedAcuityCertificate = trimmedCoupon;
                    couponRejected = null;
                    logStep("Acuity coupon applied", {
                      trimmedCoupon,
                      couponID: cert.couponID,
                      discountType: cert.discountType,
                      discountAmount: cert.discountAmount,
                      originalAmount,
                      newAmount: amountInCents,
                    });
                  } else {
                    couponRejected = "coupon_no_discount";
                    logStep("Acuity coupon has no usable discount", { trimmedCoupon, cert });
                  }
                } else {
                  const certType = String(cert?.type ?? "").toLowerCase();
                  if (certType === "appointments" || certType === "counts" || certType === "minutes") {
                    // A session-bundle certificate (bought on fettle.ie / Acuity's
                    // store, or issued by the clinic). It can't discount a card
                    // payment, but it IS the client's prepaid sessions — so tell
                    // the UI, which links it to the account via
                    // redeem-package-code and books with a package credit.
                    packageCertificate = {
                      code: trimmedCoupon,
                      certificateId: typeof cert?.id === "number" ? cert.id : null,
                      type: certType,
                      name: String(cert?.name ?? ""),
                      productID: cert?.productID ? String(cert.productID) : "",
                    };
                    couponRejected = "acuity_package_code"; // kept for older UI builds
                    logStep("Acuity certificate is a session bundle — handing to the package flow", {
                      trimmedCoupon,
                      certId: cert?.id,
                      certType,
                      productID: cert?.productID ?? null,
                    });
                  } else {
                    // e.g. a monetary gift certificate — nothing we can apply here.
                    couponRejected = "acuity_unsupported";
                    logStep("Acuity certificate type not supported in the coupon field", {
                      trimmedCoupon,
                      certType,
                    });
                  }
                }
              } else {
                const errText = await certResp.text();
                if (/expired/i.test(errText)) couponRejected = "acuity_expired";
                else if (/appointment type|not valid for/i.test(errText)) couponRejected = "acuity_not_applicable";
                // invalid_certificate → keep unknown_code
                logStep("Acuity certificate check rejected", {
                  trimmedCoupon,
                  status: certResp.status,
                  error: errText.slice(0, 200),
                  reason: couponRejected,
                });
              }
            } catch (e) {
              // Fail soft: the code stays rejected as unknown, booking proceeds.
              logStep("Acuity certificate check failed (non-fatal)", { trimmedCoupon, error: String(e) });
            }
          } else {
            logStep("Acuity coupon fallback skipped: ACUITY env missing");
          }
        }
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
                appliedDiscountAmount = originalAmount - amountInCents;
                discountApplied = true;
              } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
                amountInCents = Math.max(originalAmount - coupon.amount_off, 0);
                appliedDiscountAmount = originalAmount - amountInCents;
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

    // Stripe rejects charges under €0.50. A 100%-off marketing code lands here
    // too — there's no no-charge booking path for coupons, so it reverts to
    // full price with a reason the UI explains.
    if (discountApplied && amountInCents < 50) {
      logStep("Discount would drop below Stripe minimum — reverting to full price", { amountInCents });
      amountInCents = originalAmount;
      discountApplied = false;
      appliedDiscountPercent = 0;
      appliedDiscountAmount = 0;
      appliedPromotionCodeId = "";
      appliedCouponId = "";
      appliedAcuityCertificate = "";
      couponRejected = "below_minimum";
    }

    // ── Session-bundle code entered as a coupon ───────────────────────────
    // Stop here: the client has prepaid sessions, so charging them (even at a
    // discount) would be wrong. The UI links the bundle to the account and
    // re-submits through book-with-package. No PaymentIntent is created.
    if (packageCertificate) {
      return new Response(JSON.stringify({
        packageCertificate,
        discountApplied: false,
        discountPercent: 0,
        discountAmount: 0,
        originalAmount,
        couponRejected,
        referralCreditApplied: 0,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // ── Referral credit (optional, opt-in via useReferralCredit) ──────────────
    // Applied AFTER any loyalty discount. NEVER blocks a booking — any problem
    // just means full price. The credit is only RESERVED here (stamped in
    // metadata); it is actually consumed in confirm-payment-and-book after the
    // booking succeeds. Dormant unless the caller explicitly opts in, so this
    // cannot affect normal bookings.
    let referralCreditApplied = 0;
    let referralFullyCovered = false;
    if (body.useReferralCredit === true) {
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
        const token = req.headers.get("Authorization")?.replace("Bearer ", "").trim();

        let uid: string | null = null;
        if (supabaseUrl && anonKey && token) {
          const authClient = createClient(supabaseUrl, anonKey);
          const { data: u } = await authClient.auth.getUser(token);
          uid = u.user?.id ?? null;
        }

        if (uid && supabaseUrl && serviceKey) {
          const admin = createClient(supabaseUrl, serviceKey);
          const { data: bal } = await admin.rpc("referral_available_balance", { uid });
          const balance = Number(bal || 0);
          if (balance > 0) {
            let apply = Math.min(balance, amountInCents);
            const remainder = amountInCents - apply;
            if (remainder === 0) {
              referralFullyCovered = true;
            } else if (remainder < 50) {
              // Stripe rejects charges under €0.50 — leave exactly that to charge.
              apply = amountInCents - 50;
            }
            referralCreditApplied = apply;
            if (!referralFullyCovered) amountInCents = amountInCents - apply;
            logStep("Referral credit applied", { balance, referralCreditApplied, referralFullyCovered, newAmount: amountInCents });
          }
        }
      } catch (e) {
        logStep("Referral credit skipped (non-fatal)", { error: String(e) });
        referralCreditApplied = 0;
        referralFullyCovered = false;
      }
    }

    // Fully covered by credit → no Stripe charge. The client books via the
    // dedicated no-charge path (book-with-credit) instead of confirming a PI.
    if (referralFullyCovered) {
      logStep("Booking fully covered by referral credit — skipping Stripe", { referralCreditApplied, originalAmount });
      return new Response(JSON.stringify({
        fullyCovered: true,
        referralCreditApplied,
        originalAmount,
        amount: 0,
        currency: "eur",
        discountApplied,
        discountPercent: appliedDiscountPercent,
        discountAmount: appliedDiscountAmount,
        couponRejected,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
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
      // Discount audit trail (empty unless a code was actually applied).
      // promotionCodeId/couponId identify the Stripe object behind a
      // marketing code; loyalty rewards leave promotionCodeId empty.
      couponCode: discountApplied ? normalizedCoupon : "",
      discountPercent: discountApplied && appliedDiscountPercent ? String(appliedDiscountPercent) : "",
      discountAmount: discountApplied ? String(appliedDiscountAmount) : "",
      promotionCodeId: appliedPromotionCodeId,
      couponId: appliedCouponId,
      // Non-empty ⇒ confirm-payment-and-book must send `certificate` on the
      // Acuity booking so the coupon is redeemed there.
      acuityCertificate: appliedAcuityCertificate,
      originalAmount: discountApplied ? String(originalAmount) : "",
      // Referral credit reserved for this booking; redeemed on confirm.
      referralCreditApplied: referralCreditApplied ? String(referralCreditApplied) : "",
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
      // Discount outcome — the UI uses these to show the discount or to
      // explain why a code wasn't applied. originalAmount lets it show was/now.
      // discountPercent is 0 for fixed-amount codes; discountAmount (cents off)
      // is set for every applied code.
      discountApplied,
      discountPercent: appliedDiscountPercent,
      discountAmount: appliedDiscountAmount,
      originalAmount,
      couponRejected,
      referralCreditApplied,
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
