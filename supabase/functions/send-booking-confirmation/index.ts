import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { bookingConfirmationHtml, bookingConfirmationText, formatSessionWhen } from "../_shared/bookingConfirmationEmail.ts";
import { isServiceRoleRequest } from "../_shared/serviceAuth.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BookingEmailRequest {
  to: string;
  firstName: string;
  sessionType: string;
  therapistName: string;
  datetime: string;
  duration: number;
  amount: number;
  currency: string;
  receiptUrl?: string;
  timezone?: string;
}

// Default to Europe/Dublin (Ireland) if no timezone provided
const DEFAULT_TIMEZONE = 'Europe/Dublin';

const formatDate = (datetime: string, timezone: string) => {
  const date = new Date(datetime);
  return date.toLocaleDateString('en-IE', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone
  });
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only our own functions (service-role key) may send this email.
  if (!isServiceRoleRequest(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const {
      to,
      firstName,
      sessionType,
      therapistName,
      datetime,
      amount,
      receiptUrl,
      timezone
    }: BookingEmailRequest = await req.json();

    // Use provided timezone or default to Ireland
    const userTimezone = timezone || DEFAULT_TIMEZONE;

    console.log("Sending booking confirmation to:", to, "timezone:", userTimezone);

    const when = formatSessionWhen(datetime, userTimezone);
    const emailInput = {
      firstName,
      sessionType,
      therapistName,
      dateLabel: when.dateLabel,
      timeLabel: when.timeLabel,
      payment: { kind: "card" as const, amountCents: amount, receiptUrl },
    };

    const emailResponse = await resend.emails.send({
      from: "Fettle <noreply@notifications.fettle.ie>",
      to: [to],
      subject: `Booking Confirmed: ${sessionType} on ${formatDate(datetime, userTimezone)}`,
      html: bookingConfirmationHtml(emailInput),
      text: bookingConfirmationText(emailInput),
    });

    console.log("Email sent successfully:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending booking confirmation:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
