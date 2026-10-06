// admin-customer-insights — data for the admin "Portal adoption" and
// "Progression" pages (Session 1–2 … 4–5). Admin-only: the caller's JWT and admin role are checked
// before any customer data is read. Acuity credentials and the service-role
// key stay server-side; the browser only receives the finished views.
//
// PRIVACY: responses contain client names/emails/phones for admins, but logs
// must stay counts-only — never log names, emails, phones or appointments.
// All classification, matching and scoring lives in ./logic.ts (tested).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AcuityAppointment,
  type HistoryCheck,
  type HistoryLookup,
  ACTIVE_WINDOW_DAYS,
  ADOPTION_LEGEND,
  PROGRESSION_PERIODS,
  PROGRESSION_RANGES,
  addDays,
  buildAdoptionView,
  buildPortalEmailSet,
  buildProgressionView,
  evaluateHistory,
  fetchAppointmentsInWindows,
  groupCustomers,
  mapWithConcurrency,
  progressionCandidates,
  progressionLegend,
  summarizeUnknownTypes,
  toDateString,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

/** Results per Acuity request for the active-window fetch. */
const WINDOW_LIMIT = 500;
/** Results per history lookup; a full page marks history as unverifiable. */
const HISTORY_LIMIT = 200;
/** Earliest date searched when checking a customer's history. */
const HISTORY_START_DATE = "2010-01-01";
/** How far ahead to look for booked second / next sessions. */
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

    // 1. Every non-cancelled appointment from just before the active window
    //    to FUTURE_DAYS ahead, fetched in chunks so nothing is truncated.
    const fetched = await fetchAppointmentsInWindows(
      (minDate, maxDate) =>
        acuityAppointments(
          new URLSearchParams({ minDate, maxDate, max: String(WINDOW_LIMIT) })
        ),
      addDays(today, -(ACTIVE_WINDOW_DAYS + 1)),
      addDays(today, FUTURE_DAYS),
      { limit: WINDOW_LIMIT, chunkDays: 7, concurrency: ACUITY_CONCURRENCY }
    );
    const customers = groupCustomers(fetched.appointments);

    // 2. All portal account emails. Service role is needed to see every
    //    profile; only the email column is read. Paged past the 1000-row cap.
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

    // 3. For everyone with a completed session in the window, count their
    //    earlier sessions so window sessions can be numbered. Acuity's
    //    email search ignores case, so one lookup per customer is enough.
    const candidates = progressionCandidates(customers, now);
    const checks = await mapWithConcurrency(
      candidates,
      ACUITY_CONCURRENCY,
      async ({ customer, firstInWindowAt }): Promise<[string, HistoryCheck]> => {
        let lookup: HistoryLookup | null = null;
        if (customer.email) {
          try {
            const appointments = await acuityAppointments(
              new URLSearchParams({
                email: customer.email,
                minDate: HISTORY_START_DATE,
                maxDate: addDays(toDateString(firstInWindowAt), 1),
                max: String(HISTORY_LIMIT),
                direction: "ASC",
              })
            );
            lookup = { appointments, limit: HISTORY_LIMIT };
          } catch {
            lookup = { appointments: null, limit: HISTORY_LIMIT };
          }
        }
        return [customer.key, evaluateHistory(lookup, firstInWindowAt)];
      }
    );
    const history = new Map(checks);

    const adoption = buildAdoptionView(customers, portalEmails, now);
    const progression = PROGRESSION_RANGES.map((fromSession) => ({
      ...buildProgressionView(candidates, history, portalEmails, now, fromSession),
      legend: progressionLegend(fromSession),
    }));
    const unverifiedHistory = [...history.values()].filter(
      (check) => check.status === "unverified"
    ).length;

    const diagnostics = {
      windowAppointments: fetched.appointments.length,
      customersInWindow: customers.length,
      historyLookups: candidates.length,
      acuityRequests,
      durationMs: Date.now() - startedAt,
    };
    console.log("admin-customer-insights completed", {
      ...diagnostics,
      adoptionRows: adoption.rows.length,
      progressionRows: progression.map((view) => view.rows.length),
      incompleteDates: fetched.incompleteDates.length,
    });

    return json({
      generatedAt: new Date(now).toISOString(),
      activeWindowDays: ACTIVE_WINDOW_DAYS,
      progressionPeriods: PROGRESSION_PERIODS,
      adoption: { ...adoption, legend: ADOPTION_LEGEND },
      progression,
      dataIssues: {
        incompleteDates: fetched.incompleteDates,
        unknownTypes: summarizeUnknownTypes(fetched.appointments),
        customersWithoutEmail: adoption.totals.noEmail,
        customersWithoutPhone: adoption.totals.noPhone,
        unverifiedHistory,
      },
      diagnostics,
    });
  } catch (error) {
    // Messages here are built without client data (see acuityAppointments).
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("admin-customer-insights failed:", message);
    return json({ error: message }, 500);
  }
});
