// admin-clinical — data for the admin "Psychiatry" and "Assessments" pages:
// who is due a psychiatry follow-up call, and which assessment clients still
// need their next session booked. Admin-only: the caller's JWT and admin role
// are checked before any customer data is read. Acuity credentials stay
// server-side; the browser only receives the finished views.
//
// PRIVACY: responses contain client names/emails/phones for admins, but logs
// must stay counts-only — never log names, emails, phones or appointments.
// All status rules live in ./logic.ts (tested).
//
// DEPLOY: imports ../admin-customer-insights/logic.ts, so deploy with the
// Supabase CLI (`supabase functions deploy admin-clinical`), which bundles it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AcuityAppointment,
  addDays,
  fetchAppointmentsInWindows,
  groupCustomers,
  toDateString,
} from "../admin-customer-insights/logic.ts";
import {
  CLINICAL_LOOKBACK_DAYS,
  PSYCHIATRY_CONTACT_AFTER_DAYS,
  PSYCHIATRY_FOLLOW_UP_BY_DAYS,
  buildAssessmentView,
  buildPsychiatryView,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

/** Results per Acuity request for the window fetch. */
const WINDOW_LIMIT = 500;
/** How far ahead to look for booked follow-ups and next steps. */
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
    // status.
    async function acuityAppointments(params: URLSearchParams): Promise<AcuityAppointment[]> {
      params.set("excludeForms", "true");
      for (let attempt = 0; ; attempt++) {
        acuityRequests++;
        const response = await fetch(`${ACUITY_API_BASE}/appointments?${params}`, {
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

    // 1. Every non-cancelled appointment from the start of the lookback
    //    window to FUTURE_DAYS ahead, fetched in chunks so nothing is truncated.
    const fetched = await fetchAppointmentsInWindows(
      (minDate, maxDate) =>
        acuityAppointments(
          new URLSearchParams({ minDate, maxDate, max: String(WINDOW_LIMIT) })
        ),
      addDays(today, -(CLINICAL_LOOKBACK_DAYS + 1)),
      addDays(today, FUTURE_DAYS),
      { limit: WINDOW_LIMIT, chunkDays: 7, concurrency: ACUITY_CONCURRENCY }
    );
    const customers = groupCustomers(fetched.appointments);

    // 2. The two views.
    const psychiatry = buildPsychiatryView(customers, now);
    const assessments = buildAssessmentView(customers, now);

    const diagnostics = {
      windowAppointments: fetched.appointments.length,
      acuityRequests,
      durationMs: Date.now() - startedAt,
    };
    console.log("admin-clinical completed", {
      ...diagnostics,
      psychiatry: psychiatry.totals,
      assessments: assessments.totals,
      incompleteDates: fetched.incompleteDates.length,
    });

    return json({
      generatedAt: new Date(now).toISOString(),
      lookbackDays: CLINICAL_LOOKBACK_DAYS,
      psychiatryRule: {
        contactAfterDays: PSYCHIATRY_CONTACT_AFTER_DAYS,
        followUpByDays: PSYCHIATRY_FOLLOW_UP_BY_DAYS,
      },
      psychiatry,
      assessments,
      dataIssues: {
        incompleteDates: fetched.incompleteDates,
        psychiatryWithoutEmail: psychiatry.rows.filter((row) => !row.email).length,
        assessmentsWithoutEmail: assessments.rows.filter((row) => !row.email).length,
      },
      diagnostics,
    });
  } catch (error) {
    // Messages here are built without client data (see acuityAppointments).
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("admin-clinical failed:", message);
    return json({ error: message }, 500);
  }
});
