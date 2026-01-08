import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[CREDIT-USED-CONFIRMATION] ${step}${detailsStr}`);
};

interface CreditUsedRequest {
  email: string;
  firstName: string;
  packageName: string;
  sessionDate: string;
  sessionTime: string;
  therapistName: string;
  remainingSessions: number;
  totalSessions: number;
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
    const body: CreditUsedRequest = await req.json();

    const {
      email,
      firstName,
      packageName,
      sessionDate,
      sessionTime,
      therapistName,
      remainingSessions,
      totalSessions,
    } = body;

    logStep("Sending credit used confirmation", { email, remainingSessions });

    const usedSessions = totalSessions - remainingSessions;
    const progressPercent = Math.round((remainingSessions / totalSessions) * 100);

    const emailResponse = await resend.emails.send({
      from: "Fettle <onboarding@resend.dev>",
      to: [email],
      subject: `Session Booked - ${remainingSessions} credits remaining`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 30px; border-radius: 12px 12px 0 0; text-align: center; }
            .content { background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; }
            .credit-box { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 20px 0; }
            .credit-number { font-size: 48px; font-weight: bold; color: #10b981; }
            .progress-bar { background: #e5e7eb; border-radius: 999px; height: 12px; overflow: hidden; margin: 15px 0; }
            .progress-fill { background: #10b981; height: 100%; border-radius: 999px; }
            .session-details { background: white; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; }
            .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1 style="margin: 0;">Session Confirmed! ✓</h1>
            </div>
            <div class="content">
              <p>Hi ${firstName},</p>
              <p>Your session has been booked using your package credits.</p>
              
              <div class="session-details">
                <strong>📅 ${sessionDate}</strong><br>
                <strong>🕐 ${sessionTime}</strong><br>
                <strong>👤 ${therapistName}</strong>
              </div>
              
              <div class="credit-box" style="text-align: center;">
                <div class="credit-number">${remainingSessions}</div>
                <div style="color: #6b7280;">credits remaining</div>
                <div class="progress-bar">
                  <div class="progress-fill" style="width: ${progressPercent}%;"></div>
                </div>
                <div style="font-size: 14px; color: #6b7280;">
                  ${usedSessions} of ${totalSessions} sessions used from <strong>${packageName}</strong>
                </div>
              </div>
              
              ${remainingSessions <= 2 ? `
              <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
                <strong>⚡ Running low on credits!</strong><br>
                <span style="font-size: 14px;">Consider purchasing a new package to continue your therapy journey.</span>
              </div>
              ` : ''}
              
              <p>We look forward to seeing you!</p>
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

    logStep("Email sent successfully");

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
