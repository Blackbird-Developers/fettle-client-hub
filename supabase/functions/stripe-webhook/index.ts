import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

// Stripe webhook safety net.
//
// WHY THIS EXISTS:
// Session payments are auto-captured the instant the customer confirms on the
// client (create-payment-intent uses automatic_payment_methods with no manual
// capture). The Acuity appointment, however, is only created when the client
// subsequently calls confirm-payment-and-book. If the browser never gets there
// — closed tab, dropped Revolut/PayPal redirect, lost network — the money is
// captured but no booking and no refund happen, and nothing is even logged.
//
// This webhook is invoked by Stripe directly (server-to-server), so it fires
// regardless of what the client does. On payment_intent.succeeded it completes
// the booking via the (now idempotent) confirm-payment-and-book function.
//
// ACTIVATION (one-time, outside this code):
//   1. Stripe Dashboard → Developers → Webhooks → Add endpoint:
//        https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//      Events: payment_intent.succeeded  (add payment_intent.payment_failed if desired)
//   2. Copy the endpoint's "Signing secret" (whsec_...) and set it as a Supabase
//      secret:  supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//   3. config.toml already sets verify_jwt = false for this function (Stripe
//      cannot send a Supabase JWT — we authenticate via the Stripe signature).

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[STRIPE-WEBHOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!stripeKey || !webhookSecret || !supabaseUrl || !supabaseAnonKey) {
    logStep("ERROR: webhook not configured", {
      hasStripeKey: !!stripeKey,
      hasWebhookSecret: !!webhookSecret,
      hasSupabaseUrl: !!supabaseUrl,
      hasAnonKey: !!supabaseAnonKey,
    });
    // 500 → Stripe will retry once configured.
    return new Response("Webhook not configured", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

  // Signature verification MUST use the raw request body.
  const signature = req.headers.get("stripe-signature");
  const rawBody = await req.text();

  if (!signature) {
    logStep("Missing stripe-signature header");
    return new Response("Missing signature", { status: 400 });
  }

  let event: Stripe.Event;
  try {
    // constructEventAsync + SubtleCryptoProvider is required in Deno (the sync
    // variant relies on Node's crypto, which is unavailable here).
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch (err) {
    logStep("Signature verification failed", { error: String(err) });
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  logStep("Event received", { type: event.type, id: event.id });

  try {
    if (event.type !== "payment_intent.succeeded") {
      // We only care about successful captures here. Ack everything else.
      return new Response(JSON.stringify({ received: true, ignored: event.type }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    const pi = event.data.object as Stripe.PaymentIntent;
    const md = pi.metadata || {};

    // ORIGIN GUARD. This Stripe account is SHARED with the separate [Website]
    // booking app, which books + fulfils its own appointments. Stripe broadcasts
    // payment_intent.succeeded for the whole account, so this webhook also hears
    // [Website]'s payments. Without this guard we try to re-book a slot [Website]
    // already booked, Acuity rejects the duplicate, and we refund/cancel a
    // perfectly good booking. Only ever act on payments THIS app created —
    // identified by the source marker (create-payment-intent) with the
    // [MyFettleHub] description as a fallback for payments created before the
    // marker was added.
    const isOurs =
      md.source === "myfettlehub" ||
      (typeof pi.description === "string" && pi.description.startsWith("[MyFettleHub]"));
    if (!isOurs) {
      logStep("PI not originated by MyFettleHub — ignoring (likely [Website])", {
        paymentIntentId: pi.id,
        source: md.source || null,
      });
      return ack();
    }

    // Already fulfilled or already settled-failed by confirm-payment-and-book?
    if (md.acuity_appointment_id) {
      logStep("Already booked — nothing to do", { paymentIntentId: pi.id, appointmentId: md.acuity_appointment_id });
      return ack();
    }
    if (md.booking_outcome) {
      logStep("Already settled (failed/refunded) — nothing to do", { paymentIntentId: pi.id, outcome: md.booking_outcome });
      return ack();
    }

    // Session bookings carry appointmentTypeID. Package purchases carry packageId
    // and are completed by their own client flow + sync-acuity-packages
    // reconciliation, so we don't backstop them here.
    if (!md.appointmentTypeID) {
      logStep("PI is not a session booking — skipping", { paymentIntentId: pi.id, hasPackageId: !!md.packageId });
      return ack();
    }

    logStep("Backstop: completing session booking", { paymentIntentId: pi.id, email: md.email });

    const resp = await fetch(`${supabaseUrl}/functions/v1/confirm-payment-and-book`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
      body: JSON.stringify({ paymentIntentId: pi.id }),
    });

    const bodyText = await resp.text();
    logStep("confirm-payment-and-book responded", { status: resp.status, body: bodyText.slice(0, 500) });

    // Don't trust the response shape — read the durable outcome straight off the
    // PaymentIntent. confirm-payment-and-book stamps acuity_appointment_id on
    // success and booking_outcome on terminal failure. If neither is present the
    // attempt was transient (Acuity down, timeout) → return 500 so Stripe retries
    // (it backs off for up to ~3 days, which gives us a real recovery window).
    const refreshed = await stripe.paymentIntents.retrieve(pi.id);
    if (refreshed.metadata?.acuity_appointment_id) {
      logStep("Backstop booking confirmed", { appointmentId: refreshed.metadata.acuity_appointment_id });
      return ack();
    }
    if (refreshed.metadata?.booking_outcome) {
      logStep("Backstop settled as terminal failure", { outcome: refreshed.metadata.booking_outcome });
      return ack();
    }

    logStep("Backstop did not settle — asking Stripe to retry", { paymentIntentId: pi.id });
    return new Response(JSON.stringify({ received: true, settled: false }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  } catch (err) {
    logStep("Handler error — asking Stripe to retry", { error: String(err) });
    return new Response(JSON.stringify({ received: true, error: String(err) }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});

function ack(): Response {
  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
