// admin-bundles — data for the admin "Bundles" page: every session bundle
// (Acuity certificate) with credits used and left, expiry, last and next
// session, and a segment saying who needs a call.
// Admin-only: the caller's JWT and admin role are checked before any customer
// data is read. Acuity credentials and the service-role key stay server-side.
//
// Reads certificates straight from Acuity, not the hub's user_packages table:
// user_packages only has bundles for customers with a hub account.
//
// PRIVACY: responses contain client names/emails/phones for admins, but logs
// must stay counts-only. All rules live in ./logic.ts (tested).
//
// DEPLOY: imports ../admin-customer-insights/logic.ts, so deploy with the
// Supabase CLI (`supabase functions deploy admin-bundles`), which bundles it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AcuityAppointment,
  addDays,
  buildPortalEmailSet,
  fetchAppointmentsInWindows,
  toDateString,
} from "../admin-customer-insights/logic.ts";
import { type AcuityCertificate, buildBundlesView } from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

/** Results per Acuity request for the appointment window. */
const WINDOW_LIMIT = 500;
/** How far back sessions are looked up (last session, first redemption). */
const LOOKBACK_DAYS = 365;
/** How far ahead, for booked sessions. */
const FUTURE_DAYS = 180;
const ACUITY_CONCURRENCY = 4;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: hasAdminRole, error: roleError } = await supabase.rpc(
      "has_role",
      { check_role: "admin" }
    );
    if (roleError || !hasAdminRole) {
      return json({ error: "Forbidden: Admin access required" }, 403);
    }

    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    if (!acuityUserId || !acuityApiKey) {
      return json({ error: "Acuity credentials not configured" }, 500);
    }
    const acuityAuth = `Basic ${btoa(`${acuityUserId}:${acuityApiKey}`)}`;

    const startedAt = Date.now();
    const now = startedAt;
    const today = toDateString(now);
    let acuityRequests = 0;

    // Retries rate limits and server errors. Error messages carry only the
    // status — URLs can contain client data.
    async function acuityGet<T>(path: string): Promise<T> {
      for (let attempt = 0; ; attempt++) {
        acuityRequests++;
        const response = await fetch(`${ACUITY_API_BASE}${path}`, {
          headers: { Authorization: acuityAuth, "Content-Type": "application/json" },
        });
        if (response.ok) return await response.json();
        const retryable = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        if (!retryable || attempt >= 2) {
          throw new Error(`Acuity API error: ${response.status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    // 1. Every certificate (Acuity has no paging here; the count is reported).
    const certificates = await acuityGet<AcuityCertificate[]>("/certificates");
    if (!Array.isArray(certificates)) throw new Error("Unexpected Acuity certificates response");

    // 2. Appointments over the last year and the months ahead.
    const fetched = await fetchAppointmentsInWindows(
      (minDate, maxDate) =>
        acuityGet<AcuityAppointment[]>(
          `/appointments?${new URLSearchParams({
            minDate,
            maxDate,
            max: String(WINDOW_LIMIT),
            excludeForms: "true",
          })}`
        ),
      addDays(today, -LOOKBACK_DAYS),
      addDays(today, FUTURE_DAYS),
      { limit: WINDOW_LIMIT, chunkDays: 7, concurrency: ACUITY_CONCURRENCY }
    );

    // 3. Hub account emails (service role; email column only).
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const profileEmails: string[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await adminClient
        .from("profiles")
        .select("email")
        .order("id")
        .range(from, from + 999);
      if (error) throw new Error(`Failed to fetch profiles: ${error.message}`);
      profileEmails.push(...(data ?? []).map((p) => p.email));
      if (!data || data.length < 1000) break;
    }

    const bundles = buildBundlesView(
      certificates,
      fetched.appointments,
      buildPortalEmailSet(profileEmails),
      now
    );

    const diagnostics = {
      certificates: certificates.length,
      windowAppointments: fetched.appointments.length,
      acuityRequests,
      durationMs: Date.now() - startedAt,
    };
    console.log("admin-bundles completed", {
      ...diagnostics,
      totals: bundles.totals,
      skipped: bundles.skipped,
      incompleteDates: fetched.incompleteDates.length,
    });

    return json({
      generatedAt: new Date(now).toISOString(),
      lookbackDays: LOOKBACK_DAYS,
      bundles,
      dataIssues: {
        incompleteDates: fetched.incompleteDates,
        bundlesWithoutEmail: bundles.rows.filter((row) => !row.email).length,
        matchedByEmailOnly: bundles.rows.filter((row) => row.sessionsMatchedBy === "email").length,
      },
      diagnostics,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("admin-bundles failed:", message);
    return json({ error: message }, 500);
  }
});
