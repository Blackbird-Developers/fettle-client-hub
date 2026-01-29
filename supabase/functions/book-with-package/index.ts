import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[BOOK-WITH-PACKAGE] ${step}${detailsStr}`);
};

// Helper function to get Acuity certificate code for automatic deduction
// When you pass a certificate code to appointment creation, Acuity auto-deducts
async function getAcuityCertificateCode(
  acuityUserId: string,
  acuityApiKey: string,
  stripeSessionId: string | null
): Promise<{ code: string | null; error?: string }> {
  // Check if this package is linked to an Acuity certificate
  if (!stripeSessionId || !stripeSessionId.startsWith("acuity-cert-")) {
    logStep("Package not linked to Acuity certificate", { stripeSessionId });
    return { code: null }; // Not an Acuity-synced package
  }

  const certId = stripeSessionId.replace("acuity-cert-", "");
  const authHeader = btoa(`${acuityUserId}:${acuityApiKey}`);

  try {
    const getResponse = await fetch(`${ACUITY_API_BASE}/certificates/${certId}`, {
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/json",
      },
    });

    if (!getResponse.ok) {
      if (getResponse.status === 404) {
        logStep("Acuity certificate not found, may have been deleted", { certId });
        return { code: null }; // Certificate doesn't exist in Acuity anymore
      }
      const errorText = await getResponse.text();
      logStep("Failed to fetch Acuity certificate", { certId, status: getResponse.status, error: errorText });
      return { code: null, error: `Failed to fetch certificate: ${getResponse.status}` };
    }

    const certificate = await getResponse.json();
    logStep("Fetched Acuity certificate for booking", {
      certId,
      certificateCode: certificate.certificate,
      type: certificate.type,
      remainingMinutes: certificate.remainingMinutes,
      remainingCounts: certificate.remainingCounts
    });

    // Return the certificate code - Acuity will auto-deduct when this is used in booking
    return { code: certificate.certificate };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("Error fetching Acuity certificate", { certId, error: errorMessage });
    return { code: null, error: errorMessage };
  }
}

async function sendLowSessionsReminder(email: string, firstName: string, packageName: string, remainingSessions: number) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    logStep("RESEND_API_KEY not configured, skipping email");
    return;
  }

  const resend = new Resend(resendApiKey);

  try {
    await resend.emails.send({
      from: "Fettle <onboarding@resend.dev>",
      to: [email],
      subject: `Only ${remainingSessions} Session${remainingSessions === 1 ? '' : 's'} Remaining in Your Package`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
            .alert-box { background: #fef3c7; border: 2px solid #f59e0b; border-radius: 12px; padding: 25px; margin: 20px 0; text-align: center; }
            .credit-number { font-size: 56px; font-weight: bold; color: #d97706; }
            .cta-button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 15px; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">⚡ Low Credit Alert</h1>
            </div>
            <div class="content">
              <p>Hi ${firstName},</p>
              
              <div class="alert-box">
                <div class="credit-number">${remainingSessions}</div>
                <div style="font-size: 18px; color: #92400e; font-weight: 600;">
                  session${remainingSessions === 1 ? '' : 's'} remaining
                </div>
                <div style="margin-top: 10px; color: #78350f;">in your <strong>${packageName}</strong></div>
              </div>
              
              <p>To continue your therapy journey without interruption, consider purchasing a new package before you run out of credits.</p>
              
              <div style="text-align: center;">
                <a href="https://my.fettle.ie/dashboard" class="cta-button">View Packages</a>
              </div>
              
              <p style="margin-top: 25px;">Best regards,<br>The Fettle Team</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Fettle. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    logStep("Low sessions reminder email sent", { email, remainingSessions });
  } catch (error) {
    logStep("Failed to send low sessions reminder", { error: String(error) });
  }
}

// Default timezone if none provided
const DEFAULT_TIMEZONE = 'Europe/Dublin';

async function sendCreditUsedConfirmation(
  supabaseUrl: string,
  supabaseServiceKey: string,
  email: string,
  firstName: string,
  packageName: string,
  appointment: any,
  remainingSessions: number,
  totalSessions: number,
  timezone: string = DEFAULT_TIMEZONE
) {
  try {
    const userTimezone = timezone || DEFAULT_TIMEZONE;
    const timezoneAbbr = new Date(appointment.datetime).toLocaleTimeString('en-IE', {
      timeZoneName: 'short',
      timeZone: userTimezone
    }).split(' ').pop() || '';

    const response = await fetch(`${supabaseUrl}/functions/v1/send-credit-used-confirmation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        email,
        firstName,
        packageName,
        sessionDate: new Date(appointment.datetime).toLocaleDateString('en-IE', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: userTimezone
        }),
        sessionTime: new Date(appointment.datetime).toLocaleTimeString('en-IE', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: userTimezone
        }) + ` ${timezoneAbbr}`,
        therapistName: appointment.calendar || 'Your Therapist',
        remainingSessions,
        totalSessions,
      }),
    });

    if (!response.ok) {
      logStep("Credit used confirmation failed", { status: response.status });
    } else {
      logStep("Credit used confirmation sent");
    }
  } catch (error) {
    logStep("Failed to send credit used confirmation", { error: String(error) });
  }
}

async function sendCreditsDepletedEmail(
  supabaseUrl: string,
  supabaseServiceKey: string,
  email: string,
  firstName: string,
  packageName: string,
  totalSessionsCompleted: number
) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-credits-depleted`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        email,
        firstName,
        packageName,
        totalSessionsCompleted,
      }),
    });

    if (!response.ok) {
      logStep("Credits depleted email failed", { status: response.status });
    } else {
      logStep("Credits depleted email sent");
    }
  } catch (error) {
    logStep("Failed to send credits depleted email", { error: String(error) });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
      throw new Error("Supabase configuration missing");
    }

    if (!acuityUserId || !acuityApiKey) {
      throw new Error("Acuity configuration missing");
    }

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
    
    if (userError || !userData.user) {
      throw new Error("User not authenticated");
    }

    const userId = userData.user.id;
    logStep("User authenticated", { userId });

    const body = await req.json();
    const {
      packageId,
      appointmentTypeID,
      datetime,
      calendarID,
      firstName,
      lastName,
      email,
      phone,
      notes,
      intakeFormFields, // Acuity intake form fields array
      timezone, // User's timezone for email formatting
    } = body;

    logStep("Received booking data", { packageId, appointmentTypeID, datetime });

    if (!packageId || !appointmentTypeID || !datetime || !firstName || !lastName || !email) {
      throw new Error("Missing required fields");
    }

    // Use service role to access/update packages
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user has this package with remaining sessions
    const { data: userPackage, error: packageError } = await supabaseAdmin
      .from('user_packages')
      .select('*')
      .eq('id', packageId)
      .eq('user_id', userId)
      .single();

    if (packageError || !userPackage) {
      throw new Error("Package not found");
    }

    if (userPackage.remaining_sessions <= 0) {
      throw new Error("No remaining sessions in this package");
    }

    if (userPackage.expires_at && new Date(userPackage.expires_at) < new Date()) {
      throw new Error("This package has expired");
    }

    logStep("Package verified", {
      packageId,
      remainingSessions: userPackage.remaining_sessions
    });

    // Check if package is linked to Acuity certificate and get code for auto-deduction
    const certResult = await getAcuityCertificateCode(
      acuityUserId,
      acuityApiKey,
      userPackage.stripe_session_id
    );
    const acuityCertificateCode = certResult.code;
    if (acuityCertificateCode) {
      logStep("Will use Acuity certificate for booking", { certificateCode: acuityCertificateCode });
    }

    // Book appointment in Acuity
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);

    const appointmentData: Record<string, any> = {
      appointmentTypeID,
      datetime,
      firstName,
      lastName,
      email,
      // Phone is required by Acuity - use provided value or placeholder
      phone: phone || "0000000000",
    };

    if (calendarID) appointmentData.calendarID = calendarID;
    if (notes) appointmentData.notes = notes;

    // If package is linked to Acuity certificate, include code for auto-deduction
    if (acuityCertificateCode) {
      appointmentData.certificate = acuityCertificateCode;
      logStep("Adding certificate to appointment for auto-deduction", { certificate: acuityCertificateCode });
    }

    // Add Acuity intake form fields if provided
    if (intakeFormFields && Array.isArray(intakeFormFields)) {
      appointmentData.fields = intakeFormFields;
      logStep("Adding intake form fields", { fields: intakeFormFields });
    }

    const acuityResponse = await fetch('https://acuityscheduling.com/api/v1/appointments', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${acuityAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(appointmentData),
    });

    if (!acuityResponse.ok) {
      const errorText = await acuityResponse.text();
      logStep("Acuity booking failed", { status: acuityResponse.status, error: errorText });

      // Check if the error is about invalid intake form fields
      // If so, retry WITHOUT the fields (they may not be required for this appointment type)
      if (errorText.includes("invalid_fields") || errorText.includes("does not exist on this appointment")) {
        logStep("Retrying without intake form fields");
        delete appointmentData.fields;

        const retryResponse = await fetch('https://acuityscheduling.com/api/v1/appointments', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${acuityAuth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(appointmentData),
        });

        if (retryResponse.ok) {
          const retryAppointment = await retryResponse.json();
          logStep("Acuity appointment created on retry (without intake fields)", { appointmentId: retryAppointment.id });

          // Deduct session from package
          const { error: updateError } = await supabaseAdmin
            .from('user_packages')
            .update({
              remaining_sessions: userPackage.remaining_sessions - 1,
              updated_at: new Date().toISOString()
            })
            .eq('id', packageId)
            .eq('user_id', userId);

          if (updateError) {
            logStep("Failed to deduct session", { error: updateError });
          } else {
            logStep("Session deducted from package", {
              newRemaining: userPackage.remaining_sessions - 1
            });

            // Note: Acuity certificate is auto-deducted when certificate code is passed to appointment
            if (acuityCertificateCode) {
              logStep("Acuity certificate was auto-deducted via appointment booking");
            }

            const newRemaining = userPackage.remaining_sessions - 1;

            // Send emails
            await sendCreditUsedConfirmation(
              supabaseUrl,
              supabaseServiceKey,
              email,
              firstName,
              userPackage.package_name,
              retryAppointment,
              newRemaining,
              userPackage.total_sessions,
              timezone
            );

            if (newRemaining <= 2 && newRemaining > 0) {
              await sendLowSessionsReminder(email, firstName, userPackage.package_name, newRemaining);
            }

            if (newRemaining === 0) {
              await sendCreditsDepletedEmail(
                supabaseUrl,
                supabaseServiceKey,
                email,
                firstName,
                userPackage.package_name,
                userPackage.total_sessions
              );
            }
          }

          return new Response(JSON.stringify({
            success: true,
            appointment: {
              id: retryAppointment.id,
              datetime: retryAppointment.datetime,
              type: retryAppointment.type,
              calendar: retryAppointment.calendar,
              firstName: retryAppointment.firstName,
              lastName: retryAppointment.lastName,
              email: retryAppointment.email,
            },
            remainingSessions: userPackage.remaining_sessions - 1,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          });
        }

        // Retry also failed
        const retryErrorText = await retryResponse.text();
        logStep("Retry also failed", { error: retryErrorText });
      }

      throw new Error(`Failed to book appointment: ${errorText}`);
    }

    const appointment = await acuityResponse.json();
    logStep("Appointment booked in Acuity", { appointmentId: appointment.id });

    // Deduct session from package
    const { error: updateError } = await supabaseAdmin
      .from('user_packages')
      .update({ 
        remaining_sessions: userPackage.remaining_sessions - 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', packageId)
      .eq('user_id', userId);

    if (updateError) {
      logStep("Failed to deduct session", { error: updateError });
      // Note: appointment is already booked, log error but continue
    } else {
      logStep("Session deducted from package", {
        newRemaining: userPackage.remaining_sessions - 1
      });

      // Note: Acuity certificate is auto-deducted when certificate code is passed to appointment
      if (acuityCertificateCode) {
        logStep("Acuity certificate was auto-deducted via appointment booking");
      }

      // Send emails for package bookings
      const newRemaining = userPackage.remaining_sessions - 1;

      // Send credit used confirmation email
      await sendCreditUsedConfirmation(
        supabaseUrl,
        supabaseServiceKey,
        email,
        firstName,
        userPackage.package_name,
        appointment,
        newRemaining,
        userPackage.total_sessions,
        timezone
      );
      
      // Send low credit reminder if 2 or fewer sessions remaining (but not 0)
      if (newRemaining <= 2 && newRemaining > 0) {
        await sendLowSessionsReminder(email, firstName, userPackage.package_name, newRemaining);
      }
      
      // Send credits depleted email when they hit 0
      if (newRemaining === 0) {
        await sendCreditsDepletedEmail(
          supabaseUrl,
          supabaseServiceKey,
          email,
          firstName,
          userPackage.package_name,
          userPackage.total_sessions
        );
      }
    }

    return new Response(JSON.stringify({
      success: true,
      appointment: {
        id: appointment.id,
        datetime: appointment.datetime,
        type: appointment.type,
        calendar: appointment.calendar,
        firstName: appointment.firstName,
        lastName: appointment.lastName,
        email: appointment.email,
      },
      remainingSessions: userPackage.remaining_sessions - 1,
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
