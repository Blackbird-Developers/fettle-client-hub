// admin-bundles — data for the admin "Bundles" page: every session bundle
// (Acuity certificate) with credits used and left, expiry, last and next
// session, and a segment saying who needs a call.
// Admin-only: the caller's JWT and admin role are checked before any customer
// data is read. Acuity credentials and the service-role key stay server-side.
//
// Reads certificates straight from Acuity, not the hub's user_packages table:
// user_packages only has bundles for customers with a hub account.
//
// Building it walks a lot of Acuity history — longer than one edge-function
// call may run — so it's built in steps and saved:
//   - POST with x-cron-secret, from the admin-snapshots GitHub Actions
//     workflow (.github/scripts/build-bundles-snapshot.mjs), one step per call:
//       { step: "certificates" }  → every certificate, the keys that tie
//                                   appointments to a bundle, and the date
//                                   ranges to fetch
//       { step: "appointments", minDate, maxDate, match }
//                                 → that range's appointments a bundle can use
//       { step: "save", certificates, appointments, incompleteDates, diagnostics }
//                                 → matches Hub accounts, builds the view and
//                                   saves it to admin_snapshots
//   - GET from an admin: returns the saved copy at once, or says it hasn't
//     been built yet. Never calls Acuity.
//
// PRIVACY: step responses carry client data to the workflow, which must never
// print them; logs and the save response stay counts-only. All rules live in
// ./logic.ts (tested).
//
// DEPLOY: imports ../admin-customer-insights/logic.ts, so deploy with the
// Supabase CLI (`supabase functions deploy admin-bundles`), which bundles it.
// config.toml turns off the gateway JWT check so the workflow can call it;
// admin requests are checked here instead.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AcuityAppointment,
  addDays,
  buildPortalEmailSet,
  fetchAppointmentsInWindows,
  toDateString,
} from "../admin-customer-insights/logic.ts";
import {
  type AcuityCertificate,
  type BundleMatchKeys,
  appointmentsForBundles,
  buildBundlesView,
  bundleMatchKeys,
  dateRanges,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";
const SNAPSHOT_SOURCE = "admin-bundles";

/** Results per Acuity request for the appointment window. */
const WINDOW_LIMIT = 500;
/** How far back sessions are looked up (last session, first redemption):
 *  the longest segment window (expired with credits, last 180 days). */
const LOOKBACK_DAYS = 180;
/** How far ahead, for booked sessions. */
const FUTURE_DAYS = 90;
/** Days per "appointments" step, so each call stays well inside the limit. */
const RANGE_DAYS = 14;
/** Days per Acuity request within a step; a full one is split in half. */
const CHUNK_DAYS = 7;
const ACUITY_CONCURRENCY = 4;

const NOT_BUILT_MESSAGE =
  "The Bundles data hasn't been built yet. It's rebuilt from Acuity every hour — check back later.";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
    const isCron =
      req.method === "POST" && Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return json({ error: "Missing authorization header" }, 401);
      }
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

      const { data: snapshot, error: snapshotError } = await adminClient
        .from("admin_snapshots")
        .select("data")
        .eq("source", SNAPSHOT_SOURCE)
        .maybeSingle();
      if (snapshotError) {
        console.error("admin-bundles snapshot read failed:", snapshotError.code);
        return json({ error: "Couldn't read the saved Bundles data." }, 500);
      }
      // The client shows `error` as the message; 200 so it reaches it.
      if (!snapshot?.data) return json({ error: NOT_BUILT_MESSAGE });
      return json({ ...snapshot.data, fromSnapshot: true });
    }

    const body = await req.json().catch(() => ({}));
    const step = body?.step;
    const startedAt = Date.now();
    const today = toDateString(startedAt);

    if (step === "save") {
      const { certificates, appointments, incompleteDates, diagnostics } = body;
      if (!Array.isArray(certificates) || !Array.isArray(appointments) || !isStringArray(incompleteDates)) {
        return json({ error: "save needs certificates, appointments and incompleteDates" }, 400);
      }

      // Hub account emails (service role; email column only).
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
        certificates as AcuityCertificate[],
        appointments as AcuityAppointment[],
        buildPortalEmailSet(profileEmails),
        startedAt
      );

      const snapshot = {
        generatedAt: new Date(startedAt).toISOString(),
        lookbackDays: LOOKBACK_DAYS,
        bundles,
        dataIssues: {
          incompleteDates: [...incompleteDates].sort(),
          bundlesWithoutEmail: bundles.rows.filter((row) => !row.email).length,
          matchedByEmailOnly: bundles.rows.filter((row) => row.sessionsMatchedBy === "email").length,
        },
        diagnostics: {
          certificates: certificates.length,
          windowAppointments: count(diagnostics?.windowAppointments),
          acuityRequests: count(diagnostics?.acuityRequests),
          durationMs: count(diagnostics?.durationMs),
        },
      };

      const { error: saveError } = await adminClient
        .from("admin_snapshots")
        .upsert({ source: SNAPSHOT_SOURCE, data: snapshot, generated_at: snapshot.generatedAt });
      if (saveError) throw new Error(`Failed to save snapshot: ${saveError.code}`);

      console.log("admin-bundles saved", {
        ...snapshot.diagnostics,
        rows: bundles.rows.length,
        totals: bundles.totals,
        skipped: bundles.skipped,
        incompleteDates: incompleteDates.length,
      });
      // Counts only: the workflow prints this in GitHub's logs.
      return json({ saved: true, rows: bundles.rows.length, totals: bundles.totals });
    }

    if (step !== "certificates" && step !== "appointments") {
      return json({ error: "Unknown step" }, 400);
    }

    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    if (!acuityUserId || !acuityApiKey) {
      return json({ error: "Acuity credentials not configured" }, 500);
    }
    const acuityAuth = `Basic ${btoa(`${acuityUserId}:${acuityApiKey}`)}`;
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

    if (step === "certificates") {
      // Every certificate (Acuity has no paging here).
      const certificates = await acuityGet<AcuityCertificate[]>("/certificates");
      if (!Array.isArray(certificates)) throw new Error("Unexpected Acuity certificates response");
      const match = bundleMatchKeys(certificates);
      const ranges = dateRanges(addDays(today, -LOOKBACK_DAYS), addDays(today, FUTURE_DAYS), RANGE_DAYS);
      const durationMs = Date.now() - startedAt;
      console.log("admin-bundles certificates", {
        certificates: certificates.length,
        codes: match.codes.length,
        emails: match.emails.length,
        ranges: ranges.length,
        durationMs,
      });
      return json({ certificates, match, ranges, acuityRequests, durationMs });
    }

    // step === "appointments": one date range.
    const { minDate, maxDate, match } = body;
    if (
      typeof minDate !== "string" || !DATE_PATTERN.test(minDate) ||
      typeof maxDate !== "string" || !DATE_PATTERN.test(maxDate) ||
      minDate > maxDate ||
      !isStringArray(match?.codes) || !isStringArray(match?.emails)
    ) {
      return json({ error: "appointments needs minDate, maxDate and match" }, 400);
    }

    const fetched = await fetchAppointmentsInWindows(
      (from, to) =>
        acuityGet<AcuityAppointment[]>(
          `/appointments?${new URLSearchParams({
            minDate: from,
            maxDate: to,
            max: String(WINDOW_LIMIT),
            excludeForms: "true",
          })}`
        ),
      minDate,
      maxDate,
      { limit: WINDOW_LIMIT, chunkDays: CHUNK_DAYS, concurrency: ACUITY_CONCURRENCY }
    );
    const appointments = appointmentsForBundles(fetched.appointments, match as BundleMatchKeys);
    const durationMs = Date.now() - startedAt;
    console.log("admin-bundles appointments", {
      windowAppointments: fetched.appointments.length,
      kept: appointments.length,
      incompleteDates: fetched.incompleteDates.length,
      acuityRequests,
      durationMs,
    });
    return json({
      appointments,
      windowAppointments: fetched.appointments.length,
      incompleteDates: fetched.incompleteDates,
      acuityRequests,
      durationMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("admin-bundles failed:", message);
    return json({ error: message }, 500);
  }
});
