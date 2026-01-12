import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
};

serve(async (req) => {
  console.log("user-roles function called:", req.method);

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    console.log("Auth header present:", !!authHeader);
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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    console.log("Admin role check:", { hasAdminRole, roleError, userId: user.id });

    if (roleError) {
      console.error("Error checking admin role:", roleError);
      return new Response(
        JSON.stringify({ error: "Error checking permissions", details: roleError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!hasAdminRole) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Admin access required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Use service role client for operations that need elevated privileges
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    switch (req.method) {
      case "GET": {
        // List all admin users with their profile info
        const role = url.searchParams.get("role") || "admin";

        // First get user_roles
        const { data: roles, error: rolesError } = await adminClient
          .from("user_roles")
          .select("id, user_id, role, created_at")
          .eq("role", role)
          .order("created_at", { ascending: true });

        if (rolesError) {
          console.error("Error fetching user roles:", rolesError);
          throw rolesError;
        }

        // Then get profiles for those users
        const userIds = roles?.map(r => r.user_id) || [];

        if (userIds.length === 0) {
          return new Response(JSON.stringify([]), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: profiles, error: profilesError } = await adminClient
          .from("profiles")
          .select("id, email, first_name, last_name")
          .in("id", userIds);

        if (profilesError) {
          console.error("Error fetching profiles:", profilesError);
          throw profilesError;
        }

        // Combine the data
        const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
        const data = roles?.map(r => ({
          ...r,
          profiles: profileMap.get(r.user_id) || null
        })) || [];

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "POST": {
        // Add a new admin role
        const body = await req.json();
        const { email, role = "admin" } = body;

        if (!email) {
          return new Response(
            JSON.stringify({ error: "Email is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Find user by email
        const { data: profile, error: profileError } = await adminClient
          .from("profiles")
          .select("id, email")
          .eq("email", email.toLowerCase())
          .single();

        if (profileError || !profile) {
          return new Response(
            JSON.stringify({ error: "User not found. They must have an account first." }),
            {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Insert the role
        const { data: newRole, error } = await adminClient
          .from("user_roles")
          .insert({
            user_id: profile.id,
            role: role,
            created_by: user.id,
          })
          .select("id, user_id, role, created_at")
          .single();

        if (error) {
          if (error.code === "23505") {
            return new Response(
              JSON.stringify({ error: "This user already has this role." }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          }
          console.error("Error adding role:", error);
          throw error;
        }

        console.log(`Admin ${user.id} added ${role} role to user ${profile.id}`);

        // Return with profile info
        const data = {
          ...newRole,
          profiles: {
            email: profile.email,
            first_name: null,
            last_name: null,
          }
        };

        // Get full profile info
        const { data: fullProfile } = await adminClient
          .from("profiles")
          .select("email, first_name, last_name")
          .eq("id", profile.id)
          .single();

        if (fullProfile) {
          data.profiles = fullProfile;
        }

        return new Response(JSON.stringify(data), {
          status: 201,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "DELETE": {
        // Remove a role
        const body = await req.json();
        const { userId, role = "admin" } = body;

        if (!userId) {
          return new Response(
            JSON.stringify({ error: "userId is required" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        // Prevent removing yourself as admin
        if (userId === user.id) {
          return new Response(
            JSON.stringify({ error: "Cannot remove your own admin role" }),
            {
              status: 400,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const { error } = await adminClient
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", role);

        if (error) {
          console.error("Error removing role:", error);
          throw error;
        }

        console.log(`Admin ${user.id} removed ${role} role from user ${userId}`);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(
          JSON.stringify({ error: "Method not allowed" }),
          {
            status: 405,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }
  } catch (error) {
    console.error("Error in user-roles function:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
