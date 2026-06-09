import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CONFIRM-PAYMENT-AND-BOOK] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Cleanup state, visible to the top-level catch. The chosen model is:
  // book Acuity first; keep the money only if booking succeeds, otherwise
  // return it. This guarantees that if ANYTHING throws after we reach the
  // booking stage (Acuity network error, JSON parse failure, etc.) the money
  // is still returned — closing the gap where an exception would leave the
  // payment captured with no booking and no refund.
  let stripeClient: Stripe | null = null;
  let activePaymentIntentId: string | null = null;
  let bookingStageReached = false;
  let captureMode: "manual" | "auto" = "auto";
  let bookingSucceeded = false;
  let terminalSettled = false;

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!stripeKey) throw new Error("Our payment system is temporarily unavailable. Please contact hello@fettle.ie for support.");
    if (!acuityUserId || !acuityApiKey) throw new Error("Our scheduling system is temporarily unavailable. Please contact hello@fettle.ie for support.");

    const { paymentIntentId } = await req.json();

    if (!paymentIntentId) {
      throw new Error("Payment information is missing. Please try again or contact hello@fettle.ie for support.");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
    stripeClient = stripe;
    activePaymentIntentId = paymentIntentId;

    // Retrieve the PaymentIntent to check status and get metadata
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    logStep("Retrieved PaymentIntent", {
      status: paymentIntent.status,
      metadata: paymentIntent.metadata
    });

    // IDEMPOTENCY GUARD — this function can be invoked more than once for the
    // same PaymentIntent: the client call, the redirect-return handler, and the
    // stripe-webhook backstop can all race. We persist the outcome onto the PI
    // metadata so repeat calls are no-ops instead of double-booking / double-refunding.
    if (paymentIntent.metadata?.acuity_appointment_id) {
      logStep("Already booked — returning existing appointment", {
        appointmentId: paymentIntent.metadata.acuity_appointment_id,
      });
      return new Response(JSON.stringify({
        success: true,
        alreadyBooked: true,
        appointment: { id: paymentIntent.metadata.acuity_appointment_id },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    if (paymentIntent.metadata?.booking_outcome) {
      // A previous run reached a terminal failure (refunded / canceled). Do not
      // retry booking — return a settled response so callers stop hammering.
      logStep("Already settled as failed — not re-attempting", {
        outcome: paymentIntent.metadata.booking_outcome,
      });
      return new Response(JSON.stringify({
        success: false,
        settled: true,
        outcome: paymentIntent.metadata.booking_outcome,
        error: "This booking could not be completed and the payment was already reversed. Please contact hello@fettle.ie if you need help.",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // For manual capture, status should be "requires_capture" after card authorization
    // For Google Pay / Apple Pay, it might be "processing" briefly
    // "succeeded" means payment was already captured (auto-capture or already processed)
    const validStatuses = ["requires_capture", "succeeded", "processing"];

    if (!validStatuses.includes(paymentIntent.status)) {
      throw new Error("Your payment could not be processed. Please try again or contact hello@fettle.ie for support.");
    }

    // Track whether we need to capture the payment later
    let needsCapture = paymentIntent.status === "requires_capture";

    // If already succeeded, payment was already captured - still need to create the Acuity appointment
    if (paymentIntent.status === "succeeded") {
      logStep("Payment already captured, proceeding to create Acuity appointment", { status: paymentIntent.status });
      needsCapture = false;
    }

    // If processing (Google Pay), wait a moment and re-check
    if (paymentIntent.status === "processing") {
      logStep("Payment is processing (Google Pay/Apple Pay), waiting...");
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

      const recheckIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      logStep("Rechecked PaymentIntent status", { status: recheckIntent.status });

      if (recheckIntent.status === "succeeded") {
        logStep("Payment succeeded after processing, proceeding to create Acuity appointment");
        needsCapture = false;
      } else if (recheckIntent.status === "requires_capture") {
        needsCapture = true;
      } else {
        throw new Error("Your payment is still being processed. Please wait a moment and try again, or contact hello@fettle.ie for support.");
      }
    }

    const metadata = paymentIntent.metadata;
    const {
      appointmentTypeID,
      appointmentTypeName,
      datetime,
      calendarID,
      firstName,
      lastName,
      email,
      phone,
      notes,
      calendarName,
      intakeFormFields,
      timezone,
    } = metadata;

    // Default timezone if none provided
    const userTimezone = timezone || 'Europe/Dublin';

    // Persist the booking outcome onto the PaymentIntent so this function is
    // idempotent across the client call, the redirect-return handler, and the
    // stripe-webhook backstop (see IDEMPOTENCY GUARD above).
    const markBooked = async (appointmentId: string | number) => {
      bookingSucceeded = true; // prevents the catch-block cleanup from refunding a real booking
      try {
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: { ...metadata, acuity_appointment_id: String(appointmentId) },
        });
        logStep("Marked PaymentIntent as booked", { appointmentId });
      } catch (e) {
        logStep("WARNING: failed to mark PI as booked (idempotency may be weakened)", { error: String(e) });
      }
    };
    const markSettledFailed = async (outcome: string) => {
      terminalSettled = true; // money already returned by the caller; don't return it twice
      try {
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: { ...metadata, booking_outcome: outcome },
        });
        logStep("Marked PaymentIntent as settled-failed", { outcome });
      } catch (e) {
        logStep("WARNING: failed to mark PI as settled-failed", { error: String(e) });
      }
    };

    // CONCURRENCY GUARD. The client call, the redirect-return handler, and the
    // stripe-webhook backstop can all run for this PaymentIntent at the same
    // time. The metadata idempotency check above is start-of-function only, so
    // two simultaneous calls both pass it, both create the Acuity appointment,
    // and one refunds the other's booking (appointment created AND refunded —
    // the exact bug seen in production). We serialize with an atomic DB claim:
    // exactly one invocation books; the rest wait for and mirror its outcome.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let claimAcquired = true; // fail-open: never block bookings if the lock infra is unavailable
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
        const { data, error } = await supabaseAdmin.rpc("claim_booking", {
          p_payment_intent_id: paymentIntentId,
        });
        if (error) {
          logStep("WARNING: claim_booking failed — proceeding WITHOUT concurrency lock", { error: error.message });
        } else {
          claimAcquired = data === true;
        }
      } catch (e) {
        logStep("WARNING: claim_booking threw — proceeding WITHOUT concurrency lock", { error: String(e) });
      }
    } else {
      logStep("WARNING: Supabase service env missing — no concurrency lock available");
    }

    if (!claimAcquired) {
      // Another invocation is actively booking this PaymentIntent. We must NOT
      // book or refund. Wait briefly for the winner to reach a terminal state
      // (stamped on the PI metadata) and return the SAME result, so this caller
      // sees a consistent outcome instead of a duplicate booking/refund.
      logStep("Another invocation holds the booking claim — mirroring its outcome", { paymentIntentId });
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const latest = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (latest.metadata?.acuity_appointment_id) {
          logStep("Winner booked — returning success", { appointmentId: latest.metadata.acuity_appointment_id });
          return new Response(JSON.stringify({
            success: true,
            alreadyBooked: true,
            appointment: { id: latest.metadata.acuity_appointment_id },
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
        }
        if (latest.metadata?.booking_outcome) {
          logStep("Winner settled as failed — returning settled response", { outcome: latest.metadata.booking_outcome });
          return new Response(JSON.stringify({
            success: false,
            settled: true,
            outcome: latest.metadata.booking_outcome,
            error: "This booking could not be completed and the payment was reversed. Please contact hello@fettle.ie if you need help.",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
        }
      }
      // Winner still working after the wait. Don't book/refund here — tell the
      // caller it's pending. The webhook backstop (which checks the PI directly)
      // will retry and reconcile if needed.
      logStep("Winner still processing after wait — returning pending", { paymentIntentId });
      return new Response(JSON.stringify({
        success: true,
        pending: true,
        message: "Your payment was received and your booking is being finalized. You'll receive a confirmation email shortly.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    // From here on the payment is confirmed (captured, or authorized for the
    // legacy manual-capture path). If we fail past this point we owe the
    // customer their money back — recorded for the top-level catch.
    bookingStageReached = true;
    captureMode = needsCapture ? "manual" : "auto";

    // STEP 1: Create appointment in Acuity FIRST (before capturing payment)
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);

    const appointmentBody: Record<string, any> = {
      appointmentTypeID: parseInt(appointmentTypeID),
      datetime,
      firstName,
      lastName,
      email,
    };

    if (calendarID) appointmentBody.calendarID = parseInt(calendarID);
    appointmentBody.phone = phone || "0000000000";
    if (notes) appointmentBody.notes = notes;

    // Add Acuity intake form fields if provided
    if (intakeFormFields) {
      try {
        const fields = JSON.parse(intakeFormFields);
        appointmentBody.fields = fields;
        logStep("Adding intake form fields", { fields });
      } catch (e) {
        logStep("Failed to parse intake form fields", { intakeFormFields, error: e });
      }
    }

    logStep("Creating Acuity appointment", appointmentBody);

    const acuityResponse = await fetch("https://acuityscheduling.com/api/v1/appointments", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${acuityAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(appointmentBody),
    });

    if (!acuityResponse.ok) {
      const errorText = await acuityResponse.text();
      logStep("Acuity API error", { status: acuityResponse.status, error: errorText });

      // Check if the error is about invalid intake form fields
      // If so, retry WITHOUT the invalid fields
      if (errorText.includes("invalid_fields") || errorText.includes("does not exist on this appointment")) {
        // Try to extract the invalid field ID from the error. Acuity returns
        // JSON, so the id is wrapped in escaped quotes (\"10466116\"); the
        // optional backslash lets this match both escaped and raw forms.
        const invalidFieldMatch = errorText.match(/(\d+)\\?" does not exist/);
        const invalidFieldId = invalidFieldMatch ? parseInt(invalidFieldMatch[1]) : null;

        if (invalidFieldId && appointmentBody.fields) {
          // Remove only the invalid field and retry
          appointmentBody.fields = appointmentBody.fields.filter(
            (f: { id: number }) => f.id !== invalidFieldId
          );
          logStep("Retrying without invalid field", { removedFieldId: invalidFieldId, remainingFields: appointmentBody.fields });
        } else {
          // Can't identify the specific field, remove all fields
          logStep("Retrying without any intake form fields");
          delete appointmentBody.fields;
        }

        const retryResponse = await fetch("https://acuityscheduling.com/api/v1/appointments", {
          method: "POST",
          headers: {
            "Authorization": `Basic ${acuityAuth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(appointmentBody),
        });

        if (retryResponse.ok) {
          const retryAppointment = await retryResponse.json();
          logStep("Acuity appointment created on retry", { appointmentId: retryAppointment.id });
          await markBooked(retryAppointment.id);

          // Continue with payment capture using the retry appointment
          if (needsCapture) {
            logStep("Capturing payment after successful booking", { paymentIntentId });
            try {
              await stripe.paymentIntents.capture(paymentIntentId);
              logStep("Payment captured successfully");
            } catch (captureError) {
              logStep("CRITICAL: Booking created but payment capture failed", {
                appointmentId: retryAppointment.id,
                error: captureError
              });
            }
          } else {
            logStep("Payment already captured, skipping capture step");
          }

          // Get receipt URL
          let receiptUrl = null;
          try {
            const charges = await stripe.charges.list({
              payment_intent: paymentIntentId,
              limit: 1,
            });
            if (charges.data.length > 0) {
              receiptUrl = charges.data[0].receipt_url;
            }
          } catch (e) {
            logStep("Could not get receipt URL", { error: e });
          }

          return new Response(JSON.stringify({
            success: true,
            appointment: {
              id: retryAppointment.id,
              datetime: retryAppointment.datetime,
              type: appointmentTypeName,
              therapist: calendarName,
            },
            receiptUrl,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }

        // Retry failed - check if it's a required field error
        const retryErrorText = await retryResponse.text();
        logStep("Retry failed", { error: retryErrorText });

        // If retry failed due to required field, try to add that field and retry again
        if (retryErrorText.includes("required_field")) {
          const requiredFieldMatch = retryErrorText.match(/"fieldID":(\d+)/);
          if (requiredFieldMatch) {
            const requiredFieldId = parseInt(requiredFieldMatch[1]);
            logStep("Found required field, retrying with it", { requiredFieldId });

            // Add the required field to existing fields (preserve others already present)
            const existingFields: { id: number; value: string }[] = appointmentBody.fields || [];
            const fieldAlreadyPresent = existingFields.some((f) => f.id === requiredFieldId);
            appointmentBody.fields = fieldAlreadyPresent
              ? existingFields
              : [...existingFields, { id: requiredFieldId, value: 'yes' }];
            logStep("Fields for final retry", { fields: appointmentBody.fields });

            const finalRetryResponse = await fetch("https://acuityscheduling.com/api/v1/appointments", {
              method: "POST",
              headers: {
                "Authorization": `Basic ${acuityAuth}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(appointmentBody),
            });

            if (finalRetryResponse.ok) {
              const finalAppointment = await finalRetryResponse.json();
              logStep("Acuity appointment created on final retry with required field", { appointmentId: finalAppointment.id });
              await markBooked(finalAppointment.id);

              // Capture payment if needed
              if (needsCapture) {
                logStep("Capturing payment after successful booking", { paymentIntentId });
                try {
                  await stripe.paymentIntents.capture(paymentIntentId);
                  logStep("Payment captured successfully");
                } catch (captureError) {
                  logStep("CRITICAL: Booking created but payment capture failed", {
                    appointmentId: finalAppointment.id,
                    error: captureError
                  });
                }
              } else {
                logStep("Payment already captured, skipping capture step");
              }

              // Get receipt URL
              let receiptUrl = null;
              try {
                const charges = await stripe.charges.list({
                  payment_intent: paymentIntentId,
                  limit: 1,
                });
                if (charges.data.length > 0) {
                  receiptUrl = charges.data[0].receipt_url;
                }
              } catch (e) {
                logStep("Could not get receipt URL", { error: e });
              }

              return new Response(JSON.stringify({
                success: true,
                appointment: {
                  id: finalAppointment.id,
                  datetime: finalAppointment.datetime,
                  type: appointmentTypeName,
                  therapist: calendarName,
                },
                receiptUrl,
              }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
              });
            }

            const finalErrorText = await finalRetryResponse.text();
            logStep("Final retry also failed", { error: finalErrorText });
          }
        }
      }

      // Reverse the payment since booking failed
      if (needsCapture) {
        logStep("Canceling payment authorization due to booking failure");
        try {
          await stripe.paymentIntents.cancel(paymentIntentId, {
            cancellation_reason: "abandoned",
          });
          logStep("Payment authorization canceled due to booking failure");
        } catch (cancelError) {
          logStep("Failed to cancel payment authorization", { error: cancelError });
        }
      } else {
        // Payment was auto-captured (Revolut, PayPal, etc.) — issue a full refund
        logStep("Payment already captured — issuing automatic refund due to booking failure");
        try {
          await stripe.refunds.create({ payment_intent: paymentIntentId });
          logStep("Refund issued successfully");
        } catch (refundError) {
          logStep("CRITICAL: Booking failed AND refund failed — manual refund needed", { error: refundError });
        }
      }

      // Mark the PI as terminally settled so the webhook backstop and any client
      // retry stop re-attempting this booking (and re-attempting the refund).
      await markSettledFailed(needsCapture ? "failed_canceled" : "failed_refunded");

      // Parse Acuity error for user-friendly message
      let userMessage = "We couldn't complete your booking at this time.";
      if (errorText.includes("not available")) {
        userMessage = "This time slot is no longer available. Please select a different time.";
      } else if (errorText.includes("already booked") || errorText.includes("conflict")) {
        userMessage = "This time slot has already been booked by someone else. Please select a different time.";
      } else if (errorText.includes("past")) {
        userMessage = "This time slot is in the past. Please select a future time.";
      } else if (errorText.includes("required_field")) {
        userMessage = "Some required information is missing. Please try again.";
      }
      const chargeNote = needsCapture
        ? "Your card has not been charged."
        : "A full refund has been issued to your payment method.";
      throw new Error(`${userMessage} ${chargeNote} Please contact hello@fettle.ie for support.`);
    }

    const appointment = await acuityResponse.json();
    logStep("Acuity appointment created", { appointmentId: appointment.id });
    await markBooked(appointment.id);

    // STEP 2: Capture the payment ONLY AFTER successful Acuity booking (if not already captured)
    if (needsCapture) {
      logStep("Capturing payment after successful booking", { paymentIntentId });

      try {
        const capturedPaymentIntent = await stripe.paymentIntents.capture(paymentIntentId);
        logStep("Payment captured successfully", {
          status: capturedPaymentIntent.status,
          amount: capturedPaymentIntent.amount
        });
      } catch (captureError) {
        // Payment capture failed but booking was created - log this critical error
        logStep("CRITICAL: Booking created but payment capture failed", {
          appointmentId: appointment.id,
          error: captureError
        });
        // Still return success since booking was created - payment can be handled manually
      }
    } else {
      logStep("Payment already captured, skipping capture step");
    }

    // Get receipt URL from the charge
    let receiptUrl = null;
    try {
      const charges = await stripe.charges.list({
        payment_intent: paymentIntentId,
        limit: 1,
      });
      if (charges.data.length > 0) {
        receiptUrl = charges.data[0].receipt_url;
      }
    } catch (e) {
      logStep("Could not get receipt URL", { error: e });
    }

    // Send confirmation email if Resend is configured
    if (resendApiKey) {
      try {
        const sessionDate = new Date(datetime);
        const formattedDate = sessionDate.toLocaleDateString('en-IE', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: userTimezone,
        });
        const formattedTime = sessionDate.toLocaleTimeString('en-IE', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: userTimezone,
        });
        const timezoneAbbr = sessionDate.toLocaleTimeString('en-IE', {
          timeZoneName: 'short',
          timeZone: userTimezone,
        }).split(' ').pop() || '';

        const amountPaid = (paymentIntent.amount / 100).toFixed(2);

        const emailHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Booking Confirmed ✓</h1>
            </div>
            <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 12px 12px;">
              <p style="font-size: 16px; margin-bottom: 20px;">Hi ${firstName},</p>
              <p style="font-size: 16px; margin-bottom: 20px;">Your therapy session has been successfully booked and paid for.</p>

              <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #667eea;">
                <h3 style="margin: 0 0 15px 0; color: #667eea;">Session Details</h3>
                <p style="margin: 5px 0;"><strong>Session:</strong> ${appointmentTypeName || 'Therapy Session'}</p>
                <p style="margin: 5px 0;"><strong>Therapist:</strong> ${calendarName || 'Your therapist'}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${formattedDate}</p>
                <p style="margin: 5px 0;"><strong>Time:</strong> ${formattedTime} ${timezoneAbbr}</p>
              </div>

              <div style="background: #e8f5e9; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <p style="margin: 0; color: #2e7d32;"><strong>Amount Paid:</strong> €${amountPaid}</p>
                ${receiptUrl ? `<p style="margin: 10px 0 0 0;"><a href="${receiptUrl}" style="color: #667eea;">View Receipt</a></p>` : ''}
              </div>

              <p style="font-size: 14px; color: #666;">If you need to reschedule or cancel, please contact us at least 24 hours before your appointment.</p>

              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="font-size: 12px; color: #999; text-align: center;">Fettle Therapy</p>
            </div>
          </body>
          </html>
        `;

        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Fettle <noreply@notifications.fettle.ie>",
            to: [email],
            subject: `Booking Confirmed: ${appointmentTypeName || 'Therapy Session'} on ${formattedDate}`,
            html: emailHtml,
          }),
        });

        if (emailResponse.ok) {
          logStep("Confirmation email sent successfully");
        } else {
          const emailError = await emailResponse.text();
          logStep("Failed to send confirmation email", { error: emailError });
        }
      } catch (emailError) {
        logStep("Error sending confirmation email", { error: emailError });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      appointment: {
        id: appointment.id,
        datetime: appointment.datetime,
        type: appointmentTypeName,
        therapist: calendarName,
      },
      receiptUrl,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });

    // GUARANTEED MONEY-BACK ON FAILURE.
    // If we got far enough that the payment was confirmed (booking stage
    // reached) but did NOT succeed in booking and have NOT already returned the
    // money on a known failure path, return it now. This covers unexpected
    // throws — Acuity network errors, timeouts, JSON parse failures — that would
    // otherwise strand a captured payment with no booking and no refund.
    if (stripeClient && activePaymentIntentId && bookingStageReached && !bookingSucceeded && !terminalSettled) {
      logStep("Returning money after unexpected failure", { captureMode, paymentIntentId: activePaymentIntentId });
      try {
        if (captureMode === "manual") {
          await stripeClient.paymentIntents.cancel(activePaymentIntentId, { cancellation_reason: "abandoned" });
          logStep("Cleanup: canceled authorization — no money was taken");
        } else {
          await stripeClient.refunds.create({ payment_intent: activePaymentIntentId });
          logStep("Cleanup: refunded captured payment");
        }
        // Mark terminal so the webhook backstop / client retry don't re-attempt.
        // Metadata updates merge per-key, so other metadata is preserved.
        await stripeClient.paymentIntents.update(activePaymentIntentId, {
          metadata: { booking_outcome: captureMode === "manual" ? "failed_canceled" : "failed_refunded" },
        });
      } catch (cleanupError) {
        // Refund failed — leave NOT marked so the webhook retries this PI.
        logStep("CRITICAL: failed to return money after error — MANUAL REFUND NEEDED", {
          paymentIntentId: activePaymentIntentId,
          error: String(cleanupError),
        });
      }
    }

    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
