import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[EXPORT-USER-DATA] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting user data export");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Missing Supabase configuration");
    }

    // Create client with user's auth token
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      throw new Error("Authentication failed");
    }

    logStep("User authenticated", { userId: user.id, email: user.email });

    // Fetch profile data
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      logStep("Error fetching profile", { error: profileError.message });
    }

    // Fetch user activities
    const { data: activities, error: activitiesError } = await supabase
      .from("user_activities")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (activitiesError) {
      logStep("Error fetching activities", { error: activitiesError.message });
    }

    // Fetch consent records
    const { data: consents, error: consentsError } = await supabase
      .from("user_consent")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (consentsError) {
      logStep("Error fetching consents", { error: consentsError.message });
    }

    // Compile all user data - GDPR Article 20 compliant format
    const exportData = {
      export_date: new Date().toISOString(),
      data_controller: "Fettle Therapy Services",
      jurisdiction: "Ireland (GDPR & Irish Data Protection Act 2018)",
      user_account: {
        id: user.id,
        email: user.email,
        email_confirmed_at: user.email_confirmed_at,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
      },
      profile: profile || null,
      activities: activities || [],
      consent_records: consents || [],
      data_categories_collected: [
        "Account information (email, name)",
        "Session booking history",
        "Activity logs",
        "Consent records",
      ],
      your_rights: {
        right_to_access: "This export fulfills your right to access your personal data",
        right_to_rectification: "You can update your profile information at any time",
        right_to_erasure: "You can request deletion of your account and all associated data",
        right_to_data_portability: "This export is provided in a machine-readable JSON format",
        right_to_object: "Contact us to object to any data processing",
        right_to_withdraw_consent: "You can withdraw consent through your profile settings",
      },
      contact_for_data_protection: {
        email: "privacy@fettle.ie",
        address: "Dublin, Ireland",
      },
    };

    logStep("Data export completed", {
      profileFound: !!profile,
      activitiesCount: activities?.length || 0,
      consentsCount: consents?.length || 0,
    });

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="fettle-data-export-${new Date().toISOString().split("T")[0]}.json"`,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logStep("Export error", { error: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
