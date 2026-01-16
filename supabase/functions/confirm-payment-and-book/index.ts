import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";

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

  try {
    logStep("Function started");

    const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!stripeKey) throw new Error("RESTRICTED_API_KEY is not set");
    if (!acuityUserId || !acuityApiKey) throw new Error("Acuity credentials not set");

    const { paymentIntentId } = await req.json();

    if (!paymentIntentId) {
      throw new Error("Missing paymentIntentId");
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Retrieve the PaymentIntent to check status and get metadata
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    logStep("Retrieved PaymentIntent", { 
      status: paymentIntent.status, 
      metadata: paymentIntent.metadata 
    });

    if (paymentIntent.status !== "succeeded") {
      throw new Error(`Payment not successful. Status: ${paymentIntent.status}`);
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
    } = metadata;

    // Create appointment in Acuity
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);
    
    const appointmentBody: Record<string, any> = {
      appointmentTypeID: parseInt(appointmentTypeID),
      datetime,
      firstName,
      lastName,
      email,
    };

    if (calendarID) appointmentBody.calendarID = parseInt(calendarID);
    if (phone) appointmentBody.phone = phone;
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
      throw new Error(`Acuity booking failed: ${errorText}`);
    }

    const appointment = await acuityResponse.json();
    logStep("Acuity appointment created", { appointmentId: appointment.id });

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
        });
        const formattedTime = sessionDate.toLocaleTimeString('en-IE', {
          hour: '2-digit',
          minute: '2-digit',
        });

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
                <p style="margin: 5px 0;"><strong>Time:</strong> ${formattedTime}</p>
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
            from: "Fettle <noreply@fettle.ie>",
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
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
