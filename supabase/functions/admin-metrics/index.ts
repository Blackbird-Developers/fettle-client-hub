import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const acuityUserId = Deno.env.get('ACUITY_USER_ID')!;
    const acuityApiKey = Deno.env.get('ACUITY_API_KEY')!;

    // Verify admin role
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if user is admin
    const { data: roleData } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Forbidden - Admin access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch all appointments from Acuity - paginate to get all
    const acuityAuth = btoa(`${acuityUserId}:${acuityApiKey}`);
    
    // Fetch appointments from the last 2 years to get comprehensive data
    const today = new Date();
    const minDate = new Date(today.getFullYear() - 2, 0, 1).toISOString().split('T')[0];
    const maxDate = new Date(today.getFullYear(), today.getMonth() + 6, 0).toISOString().split('T')[0];
    
    const allAppointments: any[] = [];
    let page = 1;
    const maxPerPage = 100;
    let hasMore = true;
    
    // Fetch active appointments with pagination
    while (hasMore) {
      const offset = (page - 1) * maxPerPage;
      const response = await fetch(
        `https://acuityscheduling.com/api/v1/appointments?minDate=${minDate}&maxDate=${maxDate}&max=${maxPerPage}&direction=DESC`,
        {
          headers: {
            'Authorization': `Basic ${acuityAuth}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error(`Acuity API error: ${response.status}`);
        throw new Error('Failed to fetch appointments from Acuity');
      }

      const batch = await response.json();
      allAppointments.push(...batch);
      
      // Acuity returns fewer than max if there are no more
      hasMore = batch.length === maxPerPage && page < 10; // Safety limit of 10 pages (1000 appointments)
      page++;
    }
    
    // Also fetch cancelled appointments
    const cancelledResponse = await fetch(
      `https://acuityscheduling.com/api/v1/appointments?minDate=${minDate}&maxDate=${maxDate}&max=500&canceled=true`,
      {
        headers: {
          'Authorization': `Basic ${acuityAuth}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    if (cancelledResponse.ok) {
      const cancelledBatch = await cancelledResponse.json();
      allAppointments.push(...cancelledBatch);
    }
    
    const appointments = allAppointments;
    console.log(`Fetched ${appointments.length} total appointments`);

    // Fetch all profiles for user count
    const { data: profiles, error: profilesError } = await supabaseClient
      .from('profiles')
      .select('id, user_id, created_at, email');

    if (profilesError) throw profilesError;

    // Fetch all packages
    const { data: packages, error: packagesError } = await supabaseClient
      .from('user_packages')
      .select('*');

    if (packagesError) throw packagesError;

    // Calculate metrics
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    // Group appointments by email to track retention
    const appointmentsByClient: Record<string, any[]> = {};
    appointments.forEach((apt: any) => {
      const email = apt.email?.toLowerCase();
      if (email) {
        if (!appointmentsByClient[email]) {
          appointmentsByClient[email] = [];
        }
        appointmentsByClient[email].push(apt);
      }
    });

    // Sort each client's appointments by date
    Object.keys(appointmentsByClient).forEach(email => {
      appointmentsByClient[email].sort((a, b) => 
        new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
      );
    });

    // Calculate retention funnel
    const totalClients = Object.keys(appointmentsByClient).length;
    let clientsWith2Plus = 0;
    let clientsWith3Plus = 0;
    let clientsWith4Plus = 0;
    let firstTimersThisMonth = 0;
    let completedSessionsThisMonth = 0;
    let completedSessionsLastMonth = 0;

    Object.entries(appointmentsByClient).forEach(([email, apts]) => {
      const completedApts = apts.filter((a: any) => 
        new Date(a.datetime) < now && !a.canceled
      );
      
      if (completedApts.length >= 2) clientsWith2Plus++;
      if (completedApts.length >= 3) clientsWith3Plus++;
      if (completedApts.length >= 4) clientsWith4Plus++;

      // Check if first appointment was this month
      if (completedApts.length > 0) {
        const firstAptDate = new Date(completedApts[0].datetime);
        if (firstAptDate >= thisMonth) {
          firstTimersThisMonth++;
        }
      }

      // Count sessions this month and last month
      completedApts.forEach((apt: any) => {
        const aptDate = new Date(apt.datetime);
        if (aptDate >= thisMonth && aptDate < now) {
          completedSessionsThisMonth++;
        }
        if (aptDate >= lastMonth && aptDate <= endOfLastMonth) {
          completedSessionsLastMonth++;
        }
      });
    });

    // Revenue metrics
    const totalPackageRevenue = packages?.reduce((sum, pkg) => sum + Number(pkg.amount_paid), 0) || 0;
    const packagesThisMonth = packages?.filter(pkg => new Date(pkg.purchased_at) >= thisMonth) || [];
    const revenueThisMonth = packagesThisMonth.reduce((sum, pkg) => sum + Number(pkg.amount_paid), 0);
    const packagesLastMonth = packages?.filter(pkg => {
      const date = new Date(pkg.purchased_at);
      return date >= lastMonth && date <= endOfLastMonth;
    }) || [];
    const revenueLastMonth = packagesLastMonth.reduce((sum, pkg) => sum + Number(pkg.amount_paid), 0);

    // Active sessions remaining
    const totalActiveCredits = packages?.reduce((sum, pkg) => sum + pkg.remaining_sessions, 0) || 0;

    // Users registered this month
    const usersThisMonth = profiles?.filter(p => new Date(p.created_at) >= thisMonth).length || 0;
    const usersLastMonth = profiles?.filter(p => {
      const date = new Date(p.created_at);
      return date >= lastMonth && date <= endOfLastMonth;
    }).length || 0;

    // Upcoming appointments
    const upcomingAppointments = appointments.filter((apt: any) => 
      new Date(apt.datetime) > now && !apt.canceled
    ).length;

    const metrics = {
      // Overview
      totalUsers: profiles?.length || 0,
      usersThisMonth,
      usersLastMonth,
      totalClients,
      
      // Retention Funnel
      retentionFunnel: {
        firstSession: totalClients,
        secondSession: clientsWith2Plus,
        thirdSession: clientsWith3Plus,
        fourthPlusSession: clientsWith4Plus,
      },
      retentionRates: {
        firstToSecond: totalClients > 0 ? Math.round((clientsWith2Plus / totalClients) * 100) : 0,
        secondToThird: clientsWith2Plus > 0 ? Math.round((clientsWith3Plus / clientsWith2Plus) * 100) : 0,
        thirdToFourth: clientsWith3Plus > 0 ? Math.round((clientsWith4Plus / clientsWith3Plus) * 100) : 0,
      },

      // Session Metrics
      firstTimersThisMonth,
      completedSessionsThisMonth,
      completedSessionsLastMonth,
      sessionGrowth: completedSessionsLastMonth > 0 
        ? Math.round(((completedSessionsThisMonth - completedSessionsLastMonth) / completedSessionsLastMonth) * 100)
        : 0,
      upcomingAppointments,

      // Revenue
      totalPackageRevenue,
      revenueThisMonth,
      revenueLastMonth,
      revenueGrowth: revenueLastMonth > 0 
        ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
        : 0,
      packagesThisMonth: packagesThisMonth.length,
      averagePackageValue: packagesThisMonth.length > 0 
        ? Math.round(revenueThisMonth / packagesThisMonth.length)
        : 0,

      // Engagement
      totalActiveCredits,
      totalPackagesSold: packages?.length || 0,
    };

    return new Response(JSON.stringify(metrics), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error fetching admin metrics:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
