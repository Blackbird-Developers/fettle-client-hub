import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-PASSWORD-RESET] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase configuration missing");
    }

    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const { email, redirectTo } = await req.json();

    if (!email) {
      throw new Error("Email is required");
    }

    logStep("Processing password reset request", { email });

    // Create Supabase admin client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Generate password reset link using Admin API
    const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: email,
      options: {
        redirectTo: redirectTo || 'https://my.fettle.ie/reset-password',
      },
    });

    if (linkError) {
      logStep("Failed to generate reset link", { error: linkError.message });
      throw new Error(linkError.message);
    }

    if (!data?.properties?.action_link) {
      throw new Error("Failed to generate password reset link");
    }

    const resetLink = data.properties.action_link;
    logStep("Reset link generated successfully");

    // Send email via Resend
    const resend = new Resend(resendApiKey);

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8f5f0;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px;">
      <h1 style="color: #c67c4e; font-size: 28px; margin: 0; font-weight: 600;">fettle<span style="font-size: 14px; color: #666;">.ie</span></h1>
      <p style="color: #666; margin: 8px 0 0 0; font-size: 14px;">Your therapy journey starts here</p>
    </div>

    <!-- Main Card -->
    <div style="background: white; border-radius: 16px; padding: 32px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
      <!-- Lock Icon -->
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: #fff3e0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
          <span style="font-size: 32px;">🔐</span>
        </div>
      </div>

      <h2 style="color: #1a1a1a; font-size: 24px; text-align: center; margin: 0 0 8px 0;">Reset Your Password</h2>
      <p style="color: #666; text-align: center; margin: 0 0 32px 0;">We received a request to reset your password.</p>

      <!-- Reset Button -->
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${resetLink}" style="display: inline-block; background: #c67c4e; color: white; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-weight: 600; font-size: 16px;">Reset Password</a>
      </div>

      <!-- Info Box -->
      <div style="background: #faf8f5; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #666; font-size: 14px; margin: 0;">
          <strong>Link expires in 1 hour.</strong><br>
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>

      <!-- Alternative Link -->
      <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e0e0e0;">
        <p style="color: #999; font-size: 12px; margin: 0 0 8px 0;">
          Having trouble with the button? Copy and paste this link:
        </p>
        <p style="color: #c67c4e; font-size: 12px; margin: 0; word-break: break-all;">
          ${resetLink}
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="text-align: center; margin-top: 32px;">
      <p style="color: #999; font-size: 12px; margin: 0;">
        © ${new Date().getFullYear()} Fettle Therapy. All rights reserved.
      </p>
    </div>
  </div>
</body>
</html>
    `;

    const emailResponse = await resend.emails.send({
      from: "Fettle <noreply@fettle.ie>",
      to: [email],
      subject: "Reset Your Password - Fettle",
      html: emailHtml,
    });

    logStep("Email sent successfully", { emailResponse });

    return new Response(JSON.stringify({
      success: true,
      message: "Password reset email sent successfully"
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
