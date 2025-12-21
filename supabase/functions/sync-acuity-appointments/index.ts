import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ACUITY_API_BASE = 'https://acuityscheduling.com/api/v1';

function logStep(step: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${step}`, data ? JSON.stringify(data) : '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Acuity sync function started");

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
    const authHeader = btoa(`${acuityUserId}:${acuityApiKey}`);

    // Parse request body for optional email filter
    let userEmail: string | null = null;
    try {
      const body = await req.json();
      userEmail = body.email || null;
    } catch {
      // No body or invalid JSON, sync all users
    }

    logStep("Fetching profiles to sync", { userEmail });

    // Get profiles to check
    let profilesQuery = supabase.from('profiles').select('user_id, email, first_name, last_name');
    if (userEmail) {
      profilesQuery = profilesQuery.eq('email', userEmail);
    }

    const { data: profiles, error: profilesError } = await profilesQuery;
    if (profilesError) {
      throw new Error(`Failed to fetch profiles: ${profilesError.message}`);
    }

    logStep("Found profiles", { count: profiles?.length });

    const syncResults: { email: string; changes: string[] }[] = [];
    const today = new Date();
    const minDate = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().split('T')[0];
    const maxDate = new Date(today.getFullYear(), today.getMonth() + 6, 0).toISOString().split('T')[0];

    for (const profile of profiles || []) {
      try {
        // Fetch appointments from Acuity for this user
        const appointmentsUrl = `${ACUITY_API_BASE}/appointments?minDate=${minDate}&maxDate=${maxDate}&max=100&email=${encodeURIComponent(profile.email)}`;
        
        const response = await fetch(appointmentsUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          logStep(`Failed to fetch appointments for ${profile.email}`, { status: response.status });
          continue;
        }

        const appointments = await response.json();
        logStep(`Fetched appointments for ${profile.email}`, { count: appointments.length });

        const changes: string[] = [];

        // Check for cancelled appointments and log activity
        for (const apt of appointments) {
          if (apt.canceled) {
            // Check if we already logged this cancellation
            const { data: existingActivity } = await supabase
              .from('user_activities')
              .select('id')
              .eq('user_id', profile.user_id)
              .eq('activity_type', 'session_cancelled')
              .eq('metadata->appointmentId', apt.id)
              .maybeSingle();

            if (!existingActivity) {
              // Log the cancellation as a new activity
              const appointmentDate = new Date(apt.datetime);
              await supabase.from('user_activities').insert({
                user_id: profile.user_id,
                activity_type: 'session_cancelled',
                title: `Session cancelled: ${apt.type}`,
                description: `Your session with ${apt.calendar} on ${appointmentDate.toLocaleDateString()} was cancelled`,
                metadata: { appointmentId: apt.id, calendar: apt.calendar, type: apt.type },
              });
              changes.push(`Logged cancellation for appointment ${apt.id}`);
            }
          }

          // Check for completed sessions
          const aptDate = new Date(apt.datetime);
          if (!apt.canceled && aptDate < today) {
            const { data: existingActivity } = await supabase
              .from('user_activities')
              .select('id')
              .eq('user_id', profile.user_id)
              .eq('activity_type', 'session_completed')
              .eq('metadata->appointmentId', apt.id)
              .maybeSingle();

            if (!existingActivity) {
              await supabase.from('user_activities').insert({
                user_id: profile.user_id,
                activity_type: 'session_completed',
                title: `Session completed: ${apt.type}`,
                description: `Completed session with ${apt.calendar}`,
                metadata: { appointmentId: apt.id, calendar: apt.calendar, type: apt.type },
              });
              changes.push(`Logged completion for appointment ${apt.id}`);
            }
          }
        }

        if (changes.length > 0) {
          syncResults.push({ email: profile.email, changes });
        }
      } catch (err) {
        logStep(`Error syncing ${profile.email}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    logStep("Sync completed", { results: syncResults });

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Acuity sync completed',
        syncedProfiles: profiles?.length || 0,
        changes: syncResults,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    logStep("Sync error", { error: error instanceof Error ? error.message : String(error) });
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
