// admin-analytics — data for the admin Overview's "Progression over time" and
// "Customers in a time frame" boards. Counts from the acuity_appointments
// copy (kept up to date by acuity-appointments-mirror), never from Acuity
// directly. Admin-only: the caller's JWT and admin role are checked before
// any data is read.
//
//   GET ?from&to&group&compare&window&basis[&type][&calendar]
//       → the numbers for both boards (no names or contact details)
//   GET ?action=customers&segment=…&from&to&basis[&type][&calendar]
//       → the customers behind one number on the Customers board
//
// PRIVACY: the customers response holds client names, emails and phones for
// admins; logs stay counts-only. All definitions live in ./logic.ts (tested).
//
// DEPLOY: imports ../admin-customer-insights/logic.ts, so deploy with the
// Supabase CLI (`supabase functions deploy admin-analytics`).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPortalEmailSet, normalizeEmail } from "../admin-customer-insights/logic.ts";
import { API_BOOKED_BY } from "../acuity-appointments-mirror/logic.ts";
import {
  type CustomerSegment,
  CUSTOMER_SEGMENTS,
  RETURNING_MIN_GAP_DAYS,
  buildHistories,
  comparisonRange,
  customerSeries,
  customerTotals,
  parseAnalyticsParams,
  parseCalendars,
  parseSessionRows,
  progressionSeries,
  progressionTotals,
  segmentMembers,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const NOT_BUILT_MESSAGE =
  "The appointment data for these charts hasn't been copied from Acuity yet. It updates every hour — check back later.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface AppointmentDetail {
  id: number;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  type: string | null;
  datetime: string;
  scheduled_by: string | null;
  booked_by_client: boolean | null;
}

async function fetchAppointments(db: SupabaseClient, ids: number[]): Promise<Map<number, AppointmentDetail>> {
  const byId = new Map<number, AppointmentDetail>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await db
      .from("acuity_appointments")
      .select("id, email, phone, first_name, last_name, type, datetime, scheduled_by, booked_by_client")
      .in("id", ids.slice(i, i + 500));
    if (error) throw new Error(`Failed to read appointments: ${error.code}`);
    for (const row of data ?? []) byId.set(row.id, row);
  }
  return byId;
}

async function fetchPortalEmails(db: SupabaseClient): Promise<Set<string>> {
  const emails: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("profiles").select("email").order("id").range(from, from + 999);
    if (error) throw new Error(`Failed to fetch profiles: ${error.message}`);
    emails.push(...(data ?? []).map((p) => p.email));
    if (!data || data.length < 1000) break;
  }
  return buildPortalEmailSet(emails);
}

/** Who made the booking, for the list. */
function bookedBy(row: AppointmentDetail | undefined): string | null {
  if (!row || row.booked_by_client === null) return null;
  const by = (row.scheduled_by ?? "").trim().toLowerCase();
  if (by === "") return "Client (Acuity booking page)";
  if (by === API_BOOKED_BY) return "Client (website or hub)";
  return `Team (${row.scheduled_by})`;
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

    const { data: hasAdminRole, error: roleError } = await supabase.rpc("has_role", { check_role: "admin" });
    if (roleError || !hasAdminRole) {
      return json({ error: "Forbidden: Admin access required" }, 403);
    }

    const search = new URL(req.url).searchParams;
    const params = parseAnalyticsParams(search);
    if (typeof params === "string") return json({ error: params }, 400);

    const startedAt = Date.now();
    const now = startedAt;
    const db = createClient(supabaseUrl, supabaseServiceKey);

    const { data: state, error: stateError } = await db
      .from("acuity_sync_state")
      .select("last_refreshed_at, backfilled_from, backfill_complete")
      .eq("id", true)
      .maybeSingle();
    if (stateError) throw new Error(`Failed to read sync state: ${stateError.code}`);
    // The client shows `error` as the message; 200 so it reaches it.
    if (!state?.last_refreshed_at) return json({ error: NOT_BUILT_MESSAGE });

    const { data: raw, error: rowsError } = await db.rpc("admin_analytics_sessions");
    if (rowsError) throw new Error(`Failed to read sessions: ${rowsError.code}`);
    const histories = buildHistories(parseSessionRows(raw), params.filters);

    if (search.get("action") === "customers") {
      const segment = search.get("segment") as CustomerSegment;
      if (!CUSTOMER_SEGMENTS.includes(segment)) return json({ error: "Unknown segment" }, 400);

      const members = segmentMembers(histories, params.range, params.basis, segment, now);
      const ids = [...new Set(members.flatMap((m) => [m.sessionId, m.firstSessionId]))];
      const [details, portalEmails] = await Promise.all([fetchAppointments(db, ids), fetchPortalEmails(db)]);

      const customers = members.map((member) => {
        const row = details.get(member.sessionId);
        const first = details.get(member.firstSessionId);
        const email = normalizeEmail(row?.email ?? first?.email);
        const name = [row?.first_name, row?.last_name].map((p) => (p ?? "").trim()).filter(Boolean).join(" ");
        return {
          customerKey: member.customerKey,
          name: name || null,
          email,
          phone: row?.phone ?? first?.phone ?? null,
          firstSessionAt: first?.datetime ?? new Date(member.firstSessionAt).toISOString(),
          sessionAt: row?.datetime ?? null,
          sessionType: row?.type ?? null,
          bookedBy: bookedBy(row),
          portalAccount: email ? portalEmails.has(email) : null,
          progressionFrom: member.progressionFrom,
        };
      });

      console.log("admin-analytics customers", { segment, rows: customers.length, durationMs: Date.now() - startedAt });
      return json({ generatedAt: new Date(now).toISOString(), segment, range: params.range, customers });
    }

    const compare = comparisonRange(params.range, params.compareTo);
    const [{ count: pendingChecks, error: pendingError }, { data: rawCalendars, error: calendarsError }] =
      await Promise.all([
        db
          .from("acuity_appointments")
          .select("id", { count: "exact", head: true })
          .is("details_fetched_at", null)
          .eq("canceled", false)
          .in("kind", ["therapy", "intro", "assessment"]),
        db.rpc("admin_analytics_calendars"),
      ]);
    if (pendingError) throw new Error(`Failed to count lookups: ${pendingError.code}`);
    if (calendarsError) throw new Error(`Failed to read calendars: ${calendarsError.code}`);

    const body = {
      generatedAt: new Date(now).toISOString(),
      data: {
        lastRefreshedAt: state.last_refreshed_at,
        historyComplete: state.backfill_complete,
        historyFrom: state.backfilled_from,
        pendingBookedByChecks: pendingChecks ?? 0,
        calendars: parseCalendars(rawCalendars),
      },
      params: { ...params, compareRange: compare, returningMinGapDays: RETURNING_MIN_GAP_DAYS },
      progression: {
        totals: progressionTotals(histories, params.range, now, params.windowDays),
        compare: progressionTotals(histories, compare, now, params.windowDays),
        series: progressionSeries(histories, params.range, params.groupBy, now, params.windowDays),
      },
      customers: {
        totals: customerTotals(histories, params.range, params.basis),
        compare: customerTotals(histories, compare, params.basis),
        series: customerSeries(histories, params.range, params.groupBy, params.basis),
      },
    };

    console.log("admin-analytics summary", {
      customers: histories.length,
      periods: body.progression.series.length,
      durationMs: Date.now() - startedAt,
    });
    return json(body);
  } catch (error) {
    // Messages here are built without client data.
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("admin-analytics failed:", message);
    return json({ error: message }, 500);
  }
});
