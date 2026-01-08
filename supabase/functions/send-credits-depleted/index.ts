import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREDITS-DEPLETED] ${step}${detailsStr}`);
};

interface CreditsDepletedRequest {
  email: string;
  firstName: string;
  packageName: string;
  totalSessionsCompleted: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      throw new Error("RESEND_API_KEY not configured");
    }

    const resend = new Resend(resendApiKey);
    const body: CreditsDepletedRequest = await req.json();

    const { email, firstName, packageName, totalSessionsCompleted } = body;

    logStep("Sending credits depleted email", { email, totalSessionsCompleted });

    await resend.emails.send({
      from: "Fettle <onboarding@resend.dev>",
      to: [email],
      subject: "You've completed your session package! 🎉",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 40px 30px; border-radius: 12px 12px 0 0; text-align: center; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
            .achievement-box { background: white; border: 2px solid #10b981; border-radius: 12px; padding: 25px; margin: 25px 0; text-align: center; }
            .achievement-number { font-size: 64px; font-weight: bold; color: #10b981; line-height: 1; }
            .achievement-label { font-size: 18px; color: #6b7280; margin-top: 5px; }
            .cta-section { background: linear-gradient(135deg, #f59e0b, #d97706); border-radius: 12px; padding: 25px; margin: 25px 0; text-align: center; color: white; }
            .cta-button { display: inline-block; background: white; color: #d97706; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; margin-top: 15px; }
            .benefits-list { background: white; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .benefit-item { display: flex; align-items: center; margin: 10px 0; }
            .benefit-icon { color: #10b981; margin-right: 10px; font-size: 18px; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0; font-size: 28px;">Congratulations, ${firstName}! 🎉</h1>
              <p style="margin: 15px 0 0 0; opacity: 0.9; font-size: 16px;">You've completed your therapy package</p>
            </div>
            <div class="content">
              <div class="achievement-box">
                <div class="achievement-number">${totalSessionsCompleted}</div>
                <div class="achievement-label">sessions completed</div>
                <p style="margin-top: 15px; color: #374151;">from your <strong>${packageName}</strong></p>
              </div>
              
              <p>We're so proud of the commitment you've shown to your mental health and wellbeing. Every session is a step forward on your journey.</p>
              
              <div class="cta-section">
                <h2 style="margin: 0 0 10px 0;">Ready to continue?</h2>
                <p style="margin: 0; opacity: 0.9;">Keep the momentum going with a new session package</p>
                <a href="https://my.fettle.ie/dashboard" class="cta-button">View Packages</a>
              </div>
              
              <div class="benefits-list">
                <h3 style="margin-top: 0;">Why continue with a package?</h3>
                <div class="benefit-item">
                  <span class="benefit-icon">✓</span>
                  <span>Save up to 15% compared to single sessions</span>
                </div>
                <div class="benefit-item">
                  <span class="benefit-icon">✓</span>
                  <span>Maintain consistency in your therapy journey</span>
                </div>
                <div class="benefit-item">
                  <span class="benefit-icon">✓</span>
                  <span>Credits never expire - use at your own pace</span>
                </div>
              </div>
              
              <p>Thank you for choosing Fettle for your therapy needs. We're here whenever you're ready to continue.</p>
              
              <p>Warmly,<br>The Fettle Team</p>
            </div>
            <div class="footer">
              <p>© ${new Date().getFullYear()} Fettle. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    logStep("Credits depleted email sent successfully");

    return new Response(JSON.stringify({ success: true }), {
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
