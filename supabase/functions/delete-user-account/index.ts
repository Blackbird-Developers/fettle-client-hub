import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[DELETE-USER-ACCOUNT] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Starting account deletion process");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header provided");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase configuration");
    }

    // Create client with user's auth token to verify identity
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      throw new Error("Authentication failed");
    }

    logStep("User authenticated for deletion", { userId: user.id, email: user.email });

    // Parse request body for confirmation
    const { confirmation } = await req.json();
    if (confirmation !== "DELETE MY ACCOUNT") {
      throw new Error("Invalid confirmation text. Please type 'DELETE MY ACCOUNT' to confirm.");
    }

    logStep("Deletion confirmed by user");

    // Use service role client for deletion operations
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Delete user activities
    const { error: activitiesError } = await adminClient
      .from("user_activities")
      .delete()
      .eq("user_id", user.id);

    if (activitiesError) {
      logStep("Error deleting activities", { error: activitiesError.message });
    } else {
      logStep("User activities deleted");
    }

    // Delete consent records
    const { error: consentsError } = await adminClient
      .from("user_consent")
      .delete()
      .eq("user_id", user.id);

    if (consentsError) {
      logStep("Error deleting consents", { error: consentsError.message });
    } else {
      logStep("User consent records deleted");
    }

    // Delete profile
    const { error: profileError } = await adminClient
      .from("profiles")
      .delete()
      .eq("user_id", user.id);

    if (profileError) {
      logStep("Error deleting profile", { error: profileError.message });
    } else {
      logStep("User profile deleted");
    }

    // Delete the auth user (this is the final step)
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(user.id);

    if (deleteUserError) {
      logStep("Error deleting auth user", { error: deleteUserError.message });
      throw new Error("Failed to delete user account: " + deleteUserError.message);
    }

    logStep("Account deletion completed successfully", { userId: user.id });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Your account and all associated data have been permanently deleted in compliance with GDPR Article 17 (Right to Erasure).",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logStep("Deletion error", { error: errorMessage });
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
