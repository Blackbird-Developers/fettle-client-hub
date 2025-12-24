import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[BOOK-WITH-PACKAGE] ${step}${detailsStr}`);
};

async function sendLowSessionsReminder(email: string, firstName: string, packageName: string) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    logStep("RESEND_API_KEY not configured, skipping email");
    return;
  }

  const resend = new Resend(resendApiKey);

  try {
    await resend.emails.send({
      from: "Therapy Sessions <onboarding@resend.dev>",
      to: [email],
      subject: "Only 1 Session Remaining in Your Package",
      html: `
        <h1>Hi ${firstName},</h1>
        <p>This is a friendly reminder that you have <strong>only 1 session remaining</strong> in your <strong>${packageName}</strong> package.</p>
        <p>To continue your therapy journey without interruption, consider purchasing a new package before your last session.</p>
        <p>Best regards,<br>Your Therapy Team</p>
      `,
    });
    logStep("Low sessions reminder email sent", { email });
  } catch (error) {
    logStep("Failed to send low sessions reminder", { error: String(error) });
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

    // Book appointment in Acuity
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);
    
    const appointmentData: Record<string, any> = {
      appointmentTypeID,
      datetime,
      firstName,
      lastName,
      email,
    };

    if (calendarID) appointmentData.calendarID = calendarID;
    if (phone) appointmentData.phone = phone;
    if (notes) appointmentData.notes = notes;

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

      // Send reminder email if only 1 session remaining
      const newRemaining = userPackage.remaining_sessions - 1;
      if (newRemaining === 1) {
        await sendLowSessionsReminder(email, firstName, userPackage.package_name);
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
