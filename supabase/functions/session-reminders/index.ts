import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = 'https://acuityscheduling.com/api/v1';

interface SessionReminderRequest {
  // Optional: specific user email to check, otherwise checks all users
  userEmail?: string;
  // Days threshold for inactivity (default: 14)
  daysThreshold?: number;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const acuityUserId = Deno.env.get('ACUITY_USER_ID');
    const acuityApiKey = Deno.env.get('ACUITY_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!acuityUserId || !acuityApiKey) {
      throw new Error('Acuity credentials not configured');
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase credentials not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userEmail, daysThreshold = 14 }: SessionReminderRequest = await req.json().catch(() => ({}));

    console.log(`Checking for inactive users (threshold: ${daysThreshold} days)`);

    // Get all profiles (or specific user)
    let profilesQuery = supabase.from('profiles').select('*');
    if (userEmail) {
      profilesQuery = profilesQuery.eq('email', userEmail);
    }

    const { data: profiles, error: profilesError } = await profilesQuery;

    if (profilesError) {
      throw new Error(`Failed to fetch profiles: ${profilesError.message}`);
    }

    if (!profiles || profiles.length === 0) {
      console.log('No profiles found to check');
      return new Response(JSON.stringify({ message: 'No profiles to check', sent: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const authHeader = btoa(`${acuityUserId}:${acuityApiKey}`);
    const now = new Date();
    const thresholdDate = new Date(now.getTime() - (daysThreshold * 24 * 60 * 60 * 1000));
    let emailsSent = 0;

    for (const profile of profiles) {
      try {
        // Fetch appointments for this user from Acuity
        const response = await fetch(
          `${ACUITY_API_BASE}/appointments?email=${encodeURIComponent(profile.email)}`,
          {
            headers: {
              'Authorization': `Basic ${authHeader}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!response.ok) {
          console.error(`Failed to fetch appointments for ${profile.email}: ${response.status}`);
          continue;
        }

        const appointments = await response.json();

        // Filter to completed (past, non-cancelled) sessions
        const completedSessions = appointments.filter((apt: any) => {
          const aptDate = new Date(apt.datetime);
          return aptDate < now && !apt.canceled;
        });

        // Check if there are any upcoming sessions
        const upcomingSessions = appointments.filter((apt: any) => {
          const aptDate = new Date(apt.datetime);
          return aptDate > now && !apt.canceled;
        });

        // Skip if user has upcoming sessions scheduled
        if (upcomingSessions.length > 0) {
          console.log(`${profile.email} has upcoming sessions, skipping reminder`);
          continue;
        }

        // Find most recent completed session
        if (completedSessions.length === 0) {
          console.log(`${profile.email} has no completed sessions, skipping`);
          continue;
        }

        const sortedSessions = completedSessions.sort((a: any, b: any) => 
          new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
        );

        const lastSession = new Date(sortedSessions[0].datetime);

        // Check if last session was before the threshold
        if (lastSession < thresholdDate) {
          const daysSinceLastSession = Math.floor((now.getTime() - lastSession.getTime()) / (1000 * 60 * 60 * 24));
          
          console.log(`Sending reminder to ${profile.email} (${daysSinceLastSession} days since last session)`);

          const firstName = profile.first_name || 'there';

          const emailResponse = await resend.emails.send({
            from: "Fettle Therapy <reminders@fettle.ie>",
            to: [profile.email],
            subject: "We miss you! Time to book your next session?",
            html: `
              <!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                </head>
                <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #6366f1; margin-bottom: 10px;">Fettle</h1>
                  </div>
                  
                  <h2 style="color: #1f2937;">Hi ${firstName},</h2>
                  
                  <p>It's been ${daysSinceLastSession} days since your last therapy session, and we wanted to check in.</p>
                  
                  <p>Consistency is key to making progress on your wellbeing journey. Regular sessions help maintain momentum and build on the work you've already done.</p>
                  
                  <div style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 12px; padding: 24px; text-align: center; margin: 30px 0;">
                    <p style="color: white; margin: 0 0 16px 0; font-size: 16px;">Ready to continue your journey?</p>
                    <a href="https://fettle.ie/dashboard" style="display: inline-block; background: white; color: #6366f1; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Book Your Next Session</a>
                  </div>
                  
                  <p style="color: #6b7280; font-size: 14px;">If you have any questions or need to discuss your treatment plan, don't hesitate to reach out to us at <a href="mailto:operations@fettle.ie" style="color: #6366f1;">operations@fettle.ie</a>.</p>
                  
                  <p>Wishing you well,<br><strong>The Fettle Team</strong></p>
                  
                  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
                  
                  <p style="color: #9ca3af; font-size: 12px; text-align: center;">
                    You're receiving this email because you have an account with Fettle Therapy. 
                    If you'd like to stop receiving these reminders, please contact us.
                  </p>
                </body>
              </html>
            `,
          });

          console.log(`Email sent to ${profile.email}:`, emailResponse);
          emailsSent++;
        } else {
          console.log(`${profile.email} had a session within ${daysThreshold} days, no reminder needed`);
        }
      } catch (userError) {
        console.error(`Error processing ${profile.email}:`, userError);
      }
    }

    console.log(`Reminder check complete. Emails sent: ${emailsSent}`);

    return new Response(JSON.stringify({ 
      message: 'Reminder check complete', 
      profilesChecked: profiles.length,
      emailsSent 
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error in session-reminders function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
