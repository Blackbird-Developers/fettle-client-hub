// admin-leads — data for the admin "Hot leads" page: people who missed a free
// "Let's Talk" call or were quoted, and whether they've booked since.
// Admin-only: the caller's JWT and admin role are checked before any customer
// data is read. Acuity credentials and the service-role key stay server-side.
//
// PRIVACY: responses contain client names/emails/phones for admins, but logs
// must stay counts-only — never log names, emails, phones or appointments.
// All matching and status rules live in ./logic.ts (tested).
//
// DEPLOY: imports ../admin-customer-insights/logic.ts, so deploy with the
// Supabase CLI (`supabase functions deploy admin-leads`), which bundles it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AcuityAppointment,
  type HistoryLookup,
  addDays,
  buildPortalEmailSet,
  fetchAppointmentsInWindows,
  groupCustomers,
  mapWithConcurrency,
  toDateString,
} from "../admin-customer-insights/logic.ts";
import {
  type LeadHistory,
  LEAD_LOOKBACK_DAYS,
  buildLeadsView,
  evaluateLeadHistory,
  leadCandidates,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

/** Results per Acuity request for the lookback-window fetch. */
const WINDOW_LIMIT = 500;
/** Results per history lookup; a full page marks history as unverifiable. */
const HISTORY_LIMIT = 200;
/** Earliest date searched when checking a lead's history. */
const HISTORY_START_DATE = "2010-01-01";
/** How far ahead to look for sessions or calls booked since the lead. */
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
    // status — the URL can contain a client's email.
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
    //    window to FUTURE_DAYS ahead (labels come with the list).
    const fetched = await fetchAppointmentsInWindows(
      (minDate, maxDate) =>
        acuityAppointments(
          new URLSearchParams({ minDate, maxDate, max: String(WINDOW_LIMIT) })
        ),
      addDays(today, -(LEAD_LOOKBACK_DAYS + 1)),
      addDays(today, FUTURE_DAYS),
      { limit: WINDOW_LIMIT, chunkDays: 7, concurrency: ACUITY_CONCURRENCY }
    );
    const customers = groupCustomers(fetched.appointments);
    const candidates = leadCandidates(customers, now);

    // 2. Portal account emails (service role; email column only).
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
    const portalEmails = buildPortalEmailSet(profileEmails);

    // 3. Each lead's earlier history (past sessions, earlier no-shows), one
    //    lookup per lead by email.
    const checks = await mapWithConcurrency(
      candidates,
      ACUITY_CONCURRENCY,
      async (candidate): Promise<[string, LeadHistory]> => {
        const email = candidate.customer.email;
        let lookup: HistoryLookup | null = null;
        if (email) {
          try {
            const appointments = await acuityAppointments(
              new URLSearchParams({
                email,
                minDate: HISTORY_START_DATE,
                maxDate: addDays(toDateString(candidate.leadAt), 1),
                max: String(HISTORY_LIMIT),
                direction: "ASC",
              })
            );
            lookup = { appointments, limit: HISTORY_LIMIT };
          } catch {
            lookup = { appointments: null, limit: HISTORY_LIMIT };
          }
        }
        return [candidate.customer.key, evaluateLeadHistory(lookup, candidate, now)];
      }
    );

    const leads = buildLeadsView(candidates, new Map(checks), portalEmails, now);

    const diagnostics = {
      windowAppointments: fetched.appointments.length,
      leads: candidates.length,
      acuityRequests,
      durationMs: Date.now() - startedAt,
    };
    console.log("admin-leads completed", {
      ...diagnostics,
      totals: leads.totals,
      incompleteDates: fetched.incompleteDates.length,
    });

    return json({
      generatedAt: new Date(now).toISOString(),
      lookbackDays: LEAD_LOOKBACK_DAYS,
      leads,
      dataIssues: {
        incompleteDates: fetched.incompleteDates,
        leadsWithoutEmail: leads.rows.filter((row) => !row.email).length,
        unverifiedHistory: leads.rows.filter((row) => row.historyStatus === "unverified").length,
      },
      diagnostics,
    });
  } catch (error) {
    // Messages here are built without client data (see acuityAppointments).
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("admin-leads failed:", message);
    return json({ error: message }, 500);
  }
});
