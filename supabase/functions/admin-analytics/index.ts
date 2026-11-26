// admin-analytics — data for the admin Overview's "Progression over time" and
// "Customers in a time frame" boards. Counts from the acuity_appointments
// copy (kept up to date by acuity-appointments-mirror), never from Acuity
// directly. Admin-only: the caller's JWT and admin role are checked before
// any data is read.
//
//   GET ?from&to&group&compare&window&basis[&returning][&type][&calendar]
//       → the numbers for both boards (no names or contact details)
//   GET ?action=customers&segment=…&from&to&basis[&returning][&type][&calendar]
//       → the customers behind one number on the Customers board
//   GET ?action=funnel&from&to[&flow][&device][&path][&service][&therapist]
//       → the Booking funnel tab (anonymous counts from booking_funnel_events,
//         see ./funnel.ts and docs/BOOKING_FUNNEL_TRACKING.md)
//   GET ?action=marketing&from&to[&group][&compare]
//       → the Marketing tab (ad spend and results from marketing_daily, filled
//         by marketing-sync, against new customers; see ./marketing.ts)
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
  buildHistories,
  customerSeries,
  customerTotals,
  parseAnalyticsParams,
  parseCalendars,
  parseSessionRows,
  progressionSeries,
  progressionPeriodTotals,
  progressionTotals,
  returningMinGapDays,
  segmentMembers,
} from "./logic.ts";
import { consultationReport, parseConsultationParams, parseConsultationRows } from "./consultations.ts";
import {
  adoptionPeriodTotals,
  clinicalPeriodTotals,
  leadPeriodTotals,
  parseClinicalRows,
  parseLeadCustomers,
  parsePeriodsParams,
} from "./worklists.ts";
import { funnelReport, parseFunnelParams, parseFunnelRows, queryBounds } from "./funnel.ts";
import { marketingReport, parseMarketingParams, parseMarketingRows, parseSyncState, spanningRange } from "./marketing.ts";

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
  booking_source: string | null;
}

async function fetchAppointments(db: SupabaseClient, ids: number[]): Promise<Map<number, AppointmentDetail>> {
  const byId = new Map<number, AppointmentDetail>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await db
      .from("acuity_appointments")
      .select("id, email, phone, first_name, last_name, type, datetime, scheduled_by, booked_by_client, booking_source")
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
  if (by === API_BOOKED_BY) {
    if (row.booking_source === "website") return "Client (website)";
    if (row.booking_source === "hub") return "Client (hub)";
    if (row.booking_source === "main_account") return "Main account, no online payment (Art, or a package)";
    return "Client (website or hub)";
  }
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

    // Comparison figures for the operational Session Nâ€“N+1 Progression pages.
    // These use the saved full history, so comparing with last year never
    // expands the live Acuity request made by admin-customer-insights.
    if (search.get("action") === "progression-period") {
      const from = search.get("from");
      const to = search.get("to");
      const stage = Number(search.get("stage"));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "") || from! > to!) {
        return json({ error: "from and to must be dates, from first" }, 400);
      }
      if (![1, 2, 3, 4].includes(stage)) return json({ error: "stage must be 1, 2, 3 or 4" }, 400);
      const db = createClient(supabaseUrl, supabaseServiceKey);
      const { data: raw, error: rowsError } = await db.rpc("admin_analytics_sessions");
      if (rowsError) throw new Error(`Failed to read sessions: ${rowsError.code}`);
      const totals = progressionPeriodTotals(buildHistories(parseSessionRows(raw)), { from: from!, to: to! }, stage as 1 | 2 | 3 | 4);
      return json({ range: { from, to }, stage, totals });
    }

    // Booking funnel tab: its own data (booking_funnel_events), not the Acuity copy.
    if (search.get("action") === "funnel") {
      const funnelParams = parseFunnelParams(search);
      if (typeof funnelParams === "string") return json({ error: funnelParams }, 400);
      const startedAt = Date.now();
      const db = createClient(supabaseUrl, supabaseServiceKey);
      const bounds = queryBounds(funnelParams.range);
      const [{ data: raw, error: rowsError }, { data: trackingStart, error: startError }] = await Promise.all([
        db.rpc("admin_funnel_sessions", { p_from: bounds.from, p_to: bounds.to }),
        db.rpc("admin_funnel_tracking_start"),
      ]);
      if (rowsError) throw new Error(`Failed to read funnel sessions: ${rowsError.code}`);
      if (startError) throw new Error(`Failed to read tracking start: ${startError.code}`);
      const report = funnelReport(parseFunnelRows(raw), funnelParams);
      console.log("admin-analytics funnel", { sessions: report.sessions, durationMs: Date.now() - startedAt });
      return json({
        generatedAt: new Date().toISOString(),
        trackingStart: trackingStart ?? null,
        params: funnelParams,
        funnel: report,
      });
    }

    // Marketing tab: ad figures (marketing_daily, filled by marketing-sync)
    // against new customers from the Acuity copy (booking date basis, no
    // filters, the same count as the Customers board).
    if (search.get("action") === "marketing") {
      const marketingParams = parseMarketingParams(search);
      if (typeof marketingParams === "string") return json({ error: marketingParams }, 400);
      const startedAt = Date.now();
      const db = createClient(supabaseUrl, supabaseServiceKey);
      const compare = marketingParams.compareRange;
      const span = spanningRange(marketingParams.range, compare);

      const [
        { data: acuityState, error: acuityStateError },
        { data: rawSessions, error: sessionsError },
        { data: rawDays, error: daysError },
        { data: rawStatus, error: statusError },
      ] = await Promise.all([
        db.from("acuity_sync_state").select("last_refreshed_at").eq("id", true).maybeSingle(),
        db.rpc("admin_analytics_sessions"),
        db.rpc("admin_marketing_daily", { p_from: span.from, p_to: span.to }),
        db
          .from("marketing_sync_state")
          .select("channel, last_attempt_at, last_success_at, last_error, history_from"),
      ]);
      if (acuityStateError) throw new Error(`Failed to read sync state: ${acuityStateError.code}`);
      if (!acuityState?.last_refreshed_at) return json({ error: NOT_BUILT_MESSAGE });
      if (sessionsError) throw new Error(`Failed to read sessions: ${sessionsError.code}`);
      if (daysError) throw new Error(`Failed to read marketing figures: ${daysError.code}`);
      if (statusError) throw new Error(`Failed to read marketing sync state: ${statusError.code}`);

      const histories = buildHistories(parseSessionRows(rawSessions));
      const series = customerSeries(histories, marketingParams.range, marketingParams.groupBy, "booking");
      const days = parseMarketingRows(rawDays);
      const report = marketingReport({
        params: marketingParams,
        compareRange: compare,
        days,
        statuses: parseSyncState(rawStatus),
        newCustomers: customerTotals(histories, marketingParams.range, "booking").new,
        compareNewCustomers: customerTotals(histories, compare, "booking").new,
        newCustomersByPeriod: new Map(series.map((point) => [point.period.key, point.new])),
      });

      console.log("admin-analytics marketing", { days: days.length, durationMs: Date.now() - startedAt });
      return json({ generatedAt: new Date().toISOString(), ...report });
    }

    // Free consultations tab: Let's Talk / Introduction Chat calls from the
    // Acuity copy, against each person's paid sessions (no session filters).
    if (search.get("action") === "consultations") {
      const consultationParams = parseConsultationParams(search);
      if (typeof consultationParams === "string") return json({ error: consultationParams }, 400);
      const startedAt = Date.now();
      const db = createClient(supabaseUrl, supabaseServiceKey);
      const [
        { data: acuityState, error: acuityStateError },
        { data: rawSessions, error: sessionsError },
        { data: rawCalls, error: callsError },
      ] = await Promise.all([
        db
          .from("acuity_sync_state")
          .select("last_refreshed_at, backfilled_from, backfill_complete")
          .eq("id", true)
          .maybeSingle(),
        db.rpc("admin_analytics_sessions"),
        db.rpc("admin_analytics_consultations"),
      ]);
      if (acuityStateError) throw new Error(`Failed to read sync state: ${acuityStateError.code}`);
      if (!acuityState?.last_refreshed_at) return json({ error: NOT_BUILT_MESSAGE });
      if (sessionsError) throw new Error(`Failed to read sessions: ${sessionsError.code}`);
      if (callsError) throw new Error(`Failed to read free consultations: ${callsError.code}`);

      const calls = parseConsultationRows(rawCalls);
      const report = consultationReport({
        calls,
        histories: buildHistories(parseSessionRows(rawSessions)),
        params: consultationParams,
        now: startedAt,
      });
      console.log("admin-analytics consultations", { calls: calls.length, durationMs: Date.now() - startedAt });
      return json({
        generatedAt: new Date(startedAt).toISOString(),
        data: {
          lastRefreshedAt: acuityState.last_refreshed_at,
          historyComplete: acuityState.backfill_complete,
          historyFrom: acuityState.backfilled_from,
        },
        params: consultationParams,
        ...report,
      });
    }

    // Period figures for the work-list pages (Hot leads, Psychiatry,
    // Assessments, Portal adoption), from the Acuity copy, for the date
    // picker's period and comparison.
    if (search.get("action") === "periods") {
      const periodsParams = parsePeriodsParams(search);
      if (typeof periodsParams === "string") return json({ error: periodsParams }, 400);
      const startedAt = Date.now();
      const db = createClient(supabaseUrl, supabaseServiceKey);
      const { data: acuityState, error: acuityStateError } = await db
        .from("acuity_sync_state")
        .select("last_refreshed_at")
        .eq("id", true)
        .maybeSingle();
      if (acuityStateError) throw new Error(`Failed to read sync state: ${acuityStateError.code}`);
      if (!acuityState?.last_refreshed_at) return json({ error: NOT_BUILT_MESSAGE });

      const { range, compareRange } = periodsParams;
      let totals: unknown;
      let compare: unknown;
      if (periodsParams.list === "leads") {
        const { data: raw, error } = await db.rpc("admin_analytics_lead_rows");
        if (error) throw new Error(`Failed to read lead rows: ${error.code}`);
        const customers = parseLeadCustomers(raw);
        totals = leadPeriodTotals(customers, range, startedAt);
        compare = leadPeriodTotals(customers, compareRange, startedAt);
      } else if (periodsParams.list === "clinical") {
        const { data: raw, error } = await db.rpc("admin_analytics_clinical_rows");
        if (error) throw new Error(`Failed to read clinical rows: ${error.code}`);
        const rows = parseClinicalRows(raw);
        totals = clinicalPeriodTotals(rows, range, startedAt);
        compare = clinicalPeriodTotals(rows, compareRange, startedAt);
      } else {
        const [{ data: raw, error }, portalEmails] = await Promise.all([
          db.rpc("admin_analytics_sessions"),
          fetchPortalEmails(db),
        ]);
        if (error) throw new Error(`Failed to read sessions: ${error.code}`);
        const histories = buildHistories(parseSessionRows(raw));
        totals = adoptionPeriodTotals(histories, portalEmails, range, startedAt);
        compare = adoptionPeriodTotals(histories, portalEmails, compareRange, startedAt);
      }
      console.log("admin-analytics periods", { list: periodsParams.list, durationMs: Date.now() - startedAt });
      return json({
        generatedAt: new Date(startedAt).toISOString(),
        data: { lastRefreshedAt: acuityState.last_refreshed_at },
        params: periodsParams,
        totals,
        compare,
      });
    }

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
    const minGapDays = returningMinGapDays(params.returning);

    if (search.get("action") === "customers") {
      const segment = search.get("segment") as CustomerSegment;
      if (!CUSTOMER_SEGMENTS.includes(segment)) return json({ error: "Unknown segment" }, 400);

      const members = segmentMembers(histories, params.range, params.basis, segment, now, minGapDays);
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

    const compare = params.compareRange;
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
      params: { ...params, compareRange: compare, returningMinGapDays: minGapDays },
      progression: {
        totals: progressionTotals(histories, params.range, now, params.windowDays),
        compare: progressionTotals(histories, compare, now, params.windowDays),
        series: progressionSeries(histories, params.range, params.groupBy, now, params.windowDays),
      },
      customers: {
        totals: customerTotals(histories, params.range, params.basis, minGapDays),
        compare: customerTotals(histories, compare, params.basis, minGapDays),
        series: customerSeries(histories, params.range, params.groupBy, params.basis, minGapDays),
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
