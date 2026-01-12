import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface AdminMetricsResponse {
  revenue: {
    totalRevenue: number;
    thisMonthRevenue: number;
    lastMonthRevenue: number;
    monthOverMonthChange: number;
    totalPackagesSold: number;
    averagePackageValue: number;
    thisMonthPackages: number;
  };
  sessions: {
    totalCompleted: number;
    totalUpcoming: number;
    thisMonthCompleted: number;
    lastMonthCompleted: number;
    monthOverMonthGrowth: number;
    uniqueClientsThisMonth: number;
    firstTimersThisMonth: number;
    canceledThisMonth: number;
  };
  engagement: {
    totalActiveCredits: number;
    uniqueClients: number;
    activePackageHolders: number;
    clientsWithoutPackages: number;
  };
  retention: {
    totalClients: number;
    firstSession: number;
    secondSession: number;
    thirdSession: number;
    fourthSession: number;
    firstToSecondRate: number;
    secondToThirdRate: number;
    thirdToFourthRate: number;
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Create Supabase client with user's JWT
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Verify user is authenticated
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", details: userError?.message }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check if user has admin role
    const { data: hasAdminRole, error: roleError } = await supabase.rpc(
      "has_role",
      { check_role: "admin" }
    );

    if (roleError || !hasAdminRole) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Admin metrics requested by user: ${user.id}`);

    // Fetch all required data in parallel
    const [packagesResult, clientsResult, appointmentsResult] =
      await Promise.all([
        // Fetch all packages
        supabase
          .from("user_packages")
          .select("*")
          .order("purchased_at", { ascending: false }),

        // Fetch all clients
        supabase
          .from("profiles")
          .select("id, email, created_at")
          .order("created_at", { ascending: false }),

        // Fetch appointments from Acuity via internal function call
        fetchAcuityAppointments(),
      ]);

    if (packagesResult.error) {
      throw new Error(`Failed to fetch packages: ${packagesResult.error.message}`);
    }
    if (clientsResult.error) {
      throw new Error(`Failed to fetch clients: ${clientsResult.error.message}`);
    }

    const packages = packagesResult.data || [];
    const clients = clientsResult.data || [];
    const appointments = appointmentsResult || [];

    // Calculate metrics
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Revenue Metrics
    const revenue = calculateRevenueMetrics(
      packages,
      thisMonthStart,
      lastMonthStart,
      lastMonthEnd
    );

    // Session Metrics
    const sessions = calculateSessionMetrics(
      appointments,
      now,
      thisMonthStart,
      lastMonthStart,
      lastMonthEnd
    );

    // Engagement Stats
    const engagement = calculateEngagementStats(packages, clients);

    // Retention Funnel
    const retention = calculateRetentionFunnel(appointments, now);

    const response: AdminMetricsResponse = {
      revenue,
      sessions,
      engagement,
      retention,
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in admin-metrics function:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function fetchAcuityAppointments(): Promise<any[]> {
  const acuityUserId = Deno.env.get("ACUITY_USER_ID");
  const acuityApiKey = Deno.env.get("ACUITY_API_KEY");

  if (!acuityUserId || !acuityApiKey) {
    console.warn("Acuity credentials not configured, returning empty appointments");
    return [];
  }

  const authHeader = btoa(`${acuityUserId}:${acuityApiKey}`);
  const today = new Date();
  const minDate = new Date(today.getFullYear(), today.getMonth() - 12, 1)
    .toISOString()
    .split("T")[0]; // 12 months ago for better metrics
  const maxDate = new Date(today.getFullYear(), today.getMonth() + 6, 0)
    .toISOString()
    .split("T")[0];

  try {
    // Fetch active appointments
    const activeResponse = await fetch(
      `https://acuityscheduling.com/api/v1/appointments?minDate=${minDate}&maxDate=${maxDate}&max=500`,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!activeResponse.ok) {
      console.error(`Acuity API error: ${activeResponse.status}`);
      return [];
    }

    const activeAppointments = await activeResponse.json();

    // Fetch cancelled appointments
    const cancelledResponse = await fetch(
      `https://acuityscheduling.com/api/v1/appointments?minDate=${minDate}&maxDate=${maxDate}&max=500&canceled=true`,
      {
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/json",
        },
      }
    );

    let cancelledAppointments: any[] = [];
    if (cancelledResponse.ok) {
      cancelledAppointments = await cancelledResponse.json();
    }

    return [...activeAppointments, ...cancelledAppointments];
  } catch (error) {
    console.error("Error fetching Acuity appointments:", error);
    return [];
  }
}

function calculateRevenueMetrics(
  packages: any[],
  thisMonthStart: Date,
  lastMonthStart: Date,
  lastMonthEnd: Date
) {
  let totalRevenue = 0;
  let thisMonthRevenue = 0;
  let lastMonthRevenue = 0;
  let thisMonthPackages = 0;

  packages.forEach((pkg) => {
    const purchaseDate = new Date(pkg.purchased_at);
    const amount = pkg.amount_paid || 0;

    totalRevenue += amount;

    if (purchaseDate >= thisMonthStart) {
      thisMonthRevenue += amount;
      thisMonthPackages++;
    } else if (purchaseDate >= lastMonthStart && purchaseDate <= lastMonthEnd) {
      lastMonthRevenue += amount;
    }
  });

  const monthOverMonthChange =
    lastMonthRevenue > 0
      ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
      : thisMonthRevenue > 0
      ? 100
      : 0;

  return {
    totalRevenue,
    thisMonthRevenue,
    lastMonthRevenue,
    monthOverMonthChange,
    totalPackagesSold: packages.length,
    averagePackageValue:
      packages.length > 0 ? Math.round(totalRevenue / packages.length) : 0,
    thisMonthPackages,
  };
}

function calculateSessionMetrics(
  appointments: any[],
  now: Date,
  thisMonthStart: Date,
  lastMonthStart: Date,
  lastMonthEnd: Date
) {
  let totalCompleted = 0;
  let totalUpcoming = 0;
  let thisMonthCompleted = 0;
  let lastMonthCompleted = 0;
  let canceledThisMonth = 0;

  const clientsThisMonth = new Set<string>();
  const clientsBeforeThisMonth = new Set<string>();

  appointments.forEach((apt) => {
    const aptDate = new Date(apt.datetime);
    const email = (apt.email || "").toLowerCase();

    if (apt.canceled) {
      if (aptDate >= thisMonthStart) {
        canceledThisMonth++;
      }
      return;
    }

    if (aptDate < now) {
      totalCompleted++;

      if (aptDate >= thisMonthStart) {
        thisMonthCompleted++;
        if (email) clientsThisMonth.add(email);
      } else {
        if (email) clientsBeforeThisMonth.add(email);
        if (aptDate >= lastMonthStart && aptDate <= lastMonthEnd) {
          lastMonthCompleted++;
        }
      }
    } else {
      totalUpcoming++;
    }
  });

  // First-timers: clients who have sessions this month but never before
  let firstTimersThisMonth = 0;
  clientsThisMonth.forEach((email) => {
    if (!clientsBeforeThisMonth.has(email)) {
      firstTimersThisMonth++;
    }
  });

  const monthOverMonthGrowth =
    lastMonthCompleted > 0
      ? Math.round(
          ((thisMonthCompleted - lastMonthCompleted) / lastMonthCompleted) * 100
        )
      : thisMonthCompleted > 0
      ? 100
      : 0;

  return {
    totalCompleted,
    totalUpcoming,
    thisMonthCompleted,
    lastMonthCompleted,
    monthOverMonthGrowth,
    uniqueClientsThisMonth: clientsThisMonth.size,
    firstTimersThisMonth,
    canceledThisMonth,
  };
}

function calculateEngagementStats(packages: any[], clients: any[]) {
  const totalCredits = packages.reduce(
    (sum, pkg) => sum + (pkg.remaining_sessions || 0),
    0
  );

  const activePackageHolders = new Set(
    packages.filter((pkg) => pkg.remaining_sessions > 0).map((pkg) => pkg.user_id)
  ).size;

  return {
    totalActiveCredits: totalCredits,
    uniqueClients: clients.length,
    activePackageHolders,
    clientsWithoutPackages: clients.length - activePackageHolders,
  };
}

function calculateRetentionFunnel(appointments: any[], now: Date) {
  const clientSessions = new Map<string, number>();

  appointments.forEach((apt) => {
    if (apt.canceled) return;
    const aptDate = new Date(apt.datetime);
    if (aptDate > now) return; // Skip future appointments

    const email = (apt.email || "").toLowerCase();
    if (email) {
      clientSessions.set(email, (clientSessions.get(email) || 0) + 1);
    }
  });

  const totalClients = clientSessions.size;
  let firstSession = 0;
  let secondSession = 0;
  let thirdSession = 0;
  let fourthSession = 0;

  clientSessions.forEach((count) => {
    if (count >= 1) firstSession++;
    if (count >= 2) secondSession++;
    if (count >= 3) thirdSession++;
    if (count >= 4) fourthSession++;
  });

  return {
    totalClients,
    firstSession,
    secondSession,
    thirdSession,
    fourthSession,
    firstToSecondRate:
      firstSession > 0 ? Math.round((secondSession / firstSession) * 100) : 0,
    secondToThirdRate:
      secondSession > 0 ? Math.round((thirdSession / secondSession) * 100) : 0,
    thirdToFourthRate:
      thirdSession > 0 ? Math.round((fourthSession / thirdSession) * 100) : 0,
  };
}
