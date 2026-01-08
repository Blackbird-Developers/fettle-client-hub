import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[MONTHLY-CREDIT-SUMMARY] ${step}${detailsStr}`);
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
      throw new Error("RESEND_API_KEY not configured");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const resend = new Resend(resendApiKey);

    // Get all users with active packages (remaining_sessions > 0)
    const { data: packages, error: packagesError } = await supabase
      .from('user_packages')
      .select('*, profiles!inner(email, first_name, last_name)')
      .gt('remaining_sessions', 0);

    if (packagesError) {
      throw new Error(`Failed to fetch packages: ${packagesError.message}`);
    }

    logStep("Found packages with credits", { count: packages?.length || 0 });

    // Group packages by user
    const userPackages = new Map<string, any[]>();
    for (const pkg of packages || []) {
      const userId = pkg.user_id;
      if (!userPackages.has(userId)) {
        userPackages.set(userId, []);
      }
      userPackages.get(userId)!.push(pkg);
    }

    let emailsSent = 0;
    const errors: string[] = [];

    for (const [userId, pkgs] of userPackages) {
      try {
        const profile = pkgs[0].profiles;
        if (!profile?.email) continue;

        const totalRemaining = pkgs.reduce((sum, p) => sum + p.remaining_sessions, 0);
        const totalPurchased = pkgs.reduce((sum, p) => sum + p.total_sessions, 0);
        const totalUsed = totalPurchased - totalRemaining;

        const packageRows = pkgs.map(p => `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">${p.package_name}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${p.remaining_sessions}</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${p.total_sessions}</td>
          </tr>
        `).join('');

        await resend.emails.send({
          from: "Fettle <onboarding@resend.dev>",
          to: [profile.email],
          subject: `Your Monthly Credit Summary - ${totalRemaining} sessions available`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
                .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
                .stats-grid { display: flex; gap: 15px; margin: 25px 0; }
                .stat-box { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; flex: 1; text-align: center; }
                .stat-number { font-size: 32px; font-weight: bold; color: #10b981; }
                .stat-label { font-size: 14px; color: #6b7280; }
                table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; }
                th { background: #f3f4f6; padding: 12px; text-align: left; font-weight: 600; }
                .cta-button { display: inline-block; background: #10b981; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 20px; }
                .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1 style="margin: 0;">📊 Monthly Credit Summary</h1>
                  <p style="margin: 10px 0 0 0; opacity: 0.9;">Your therapy session overview</p>
                </div>
                <div class="content">
                  <p>Hi ${profile.first_name || 'there'},</p>
                  <p>Here's your monthly summary of package credits:</p>
                  
                  <div class="stats-grid">
                    <div class="stat-box">
                      <div class="stat-number">${totalRemaining}</div>
                      <div class="stat-label">Credits Available</div>
                    </div>
                    <div class="stat-box">
                      <div class="stat-number">${totalUsed}</div>
                      <div class="stat-label">Sessions Used</div>
                    </div>
                  </div>
                  
                  <h3 style="margin-top: 30px;">Package Breakdown</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>Package</th>
                        <th style="text-align: center;">Remaining</th>
                        <th style="text-align: center;">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${packageRows}
                    </tbody>
                  </table>
                  
                  ${totalRemaining <= 3 ? `
                  <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 25px 0;">
                    <strong>⚡ Credits running low!</strong><br>
                    <span style="font-size: 14px;">You have ${totalRemaining} session${totalRemaining === 1 ? '' : 's'} remaining. Consider purchasing a new package to continue your therapy journey.</span>
                  </div>
                  ` : ''}
                  
                  <div style="text-align: center;">
                    <a href="https://my.fettle.ie/dashboard" class="cta-button">Book Your Next Session</a>
                  </div>
                  
                  <p style="margin-top: 30px;">Keep up the great work on your wellness journey!</p>
                  <p>Best regards,<br>The Fettle Team</p>
                </div>
                <div class="footer">
                  <p>© ${new Date().getFullYear()} Fettle. All rights reserved.</p>
                </div>
              </div>
            </body>
            </html>
          `,
        });

        emailsSent++;
        logStep("Email sent", { email: profile.email });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`User ${userId}: ${msg}`);
        logStep("Failed to send email", { userId, error: msg });
      }
    }

    logStep("Monthly summary complete", { emailsSent, errors: errors.length });

    return new Response(JSON.stringify({ 
      success: true, 
      emailsSent,
      errors: errors.length > 0 ? errors : undefined
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
