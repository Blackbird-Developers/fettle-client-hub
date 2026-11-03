import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { bookingConfirmationHtml, bookingConfirmationText, formatSessionWhen } from "../_shared/bookingConfirmationEmail.ts";
import { isServiceRoleRequest } from "../_shared/serviceAuth.ts";

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
  /** Optional: when sent, the date and time are formatted like every other booking email. */
  datetime?: string;
  timezone?: string;
  sessionType?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only our own functions (book-with-package) may send this email.
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
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
      datetime,
      timezone,
      sessionType,
    } = body;

    logStep("Sending credit used confirmation", { email, remainingSessions });

    const when = datetime ? formatSessionWhen(datetime, timezone) : { dateLabel: sessionDate, timeLabel: sessionTime };
    const emailInput = {
      firstName,
      sessionType: sessionType || "Therapy Session",
      therapistName,
      dateLabel: when.dateLabel,
      timeLabel: when.timeLabel,
      payment: { kind: "bundle" as const, packageName, remainingSessions, totalSessions },
    };

    await resend.emails.send({
      from: "Fettle <noreply@notifications.fettle.ie>",
      to: [email],
      subject: `Session Booked - ${remainingSessions} credits remaining`,
      html: bookingConfirmationHtml(emailInput),
      text: bookingConfirmationText(emailInput),
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
