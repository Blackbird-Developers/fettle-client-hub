import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

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

const formatTime = (datetime: string, timezone: string) => {
  const date = new Date(datetime);
  return date.toLocaleTimeString('en-IE', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone
  });
};

// Get short timezone name (e.g., "CET", "IST", "GMT")
const getTimezoneAbbr = (datetime: string, timezone: string) => {
  const date = new Date(datetime);
  return date.toLocaleTimeString('en-IE', {
    timeZoneName: 'short',
    timeZone: timezone
  }).split(' ').pop() || '';
};

const formatAmount = (amount: number, currency: string) => {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      to,
      firstName,
      sessionType,
      therapistName,
      datetime,
      duration,
      amount,
      currency,
      receiptUrl,
      timezone
    }: BookingEmailRequest = await req.json();

    // Use provided timezone or default to Ireland
    const userTimezone = timezone || DEFAULT_TIMEZONE;
    const timezoneAbbr = getTimezoneAbbr(datetime, userTimezone);

    console.log("Sending booking confirmation to:", to, "timezone:", userTimezone);

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation</title>
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
      <!-- Success Icon -->
      <div style="text-align: center; margin-bottom: 24px;">
        <div style="width: 64px; height: 64px; background: #e8f5e9; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
          <span style="font-size: 32px;">✓</span>
        </div>
      </div>
      
      <h2 style="color: #1a1a1a; font-size: 24px; text-align: center; margin: 0 0 8px 0;">Booking Confirmed!</h2>
      <p style="color: #666; text-align: center; margin: 0 0 32px 0;">Hi ${firstName}, your session is all set.</p>
      
      <!-- Session Details -->
      <div style="background: #faf8f5; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <h3 style="color: #1a1a1a; font-size: 16px; margin: 0 0 16px 0; font-weight: 600;">Session Details</h3>
        
        <div style="margin-bottom: 16px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; margin: 0 0 4px 0;">Session Type</p>
          <p style="color: #1a1a1a; font-size: 16px; margin: 0; font-weight: 500;">${sessionType}</p>
        </div>
        
        <div style="margin-bottom: 16px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; margin: 0 0 4px 0;">Therapist</p>
          <p style="color: #1a1a1a; font-size: 16px; margin: 0; font-weight: 500;">${therapistName}</p>
        </div>
        
        <div style="margin-bottom: 16px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; margin: 0 0 4px 0;">Date</p>
          <p style="color: #1a1a1a; font-size: 16px; margin: 0; font-weight: 500;">${formatDate(datetime, userTimezone)}</p>
        </div>

        <div style="margin-bottom: 16px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; margin: 0 0 4px 0;">Time</p>
          <p style="color: #1a1a1a; font-size: 16px; margin: 0; font-weight: 500;">${formatTime(datetime, userTimezone)} ${timezoneAbbr} (${duration} minutes)</p>
        </div>
        
        <div style="border-top: 1px solid #e0e0e0; padding-top: 16px; margin-top: 16px;">
          <p style="color: #666; font-size: 12px; text-transform: uppercase; margin: 0 0 4px 0;">Amount Paid</p>
          <p style="color: #c67c4e; font-size: 20px; margin: 0; font-weight: 600;">${formatAmount(amount, currency)}</p>
        </div>
      </div>
      
      ${receiptUrl ? `
      <!-- Receipt Button -->
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${receiptUrl}" style="display: inline-block; background: #c67c4e; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 500; font-size: 14px;">View Receipt</a>
      </div>
      ` : ''}
      
      <!-- Info Box -->
      <div style="background: #fff3e0; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #e65100; font-size: 14px; margin: 0;">
          <strong>💡 Tip:</strong> Add this session to your calendar so you don't forget!
        </p>
      </div>
      
      <!-- Need Help -->
      <div style="text-align: center; padding-top: 24px; border-top: 1px solid #e0e0e0;">
        <p style="color: #666; font-size: 14px; margin: 0;">
          Need to reschedule or have questions?<br>
          Contact us at <a href="mailto:operations@fettle.ie" style="color: #c67c4e;">operations@fettle.ie</a>
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
      to: [to],
      subject: `Booking Confirmed: ${sessionType} on ${formatDate(datetime, userTimezone)}`,
      html: emailHtml,
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
