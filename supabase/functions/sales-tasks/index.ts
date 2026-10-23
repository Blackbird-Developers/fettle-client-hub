// sales-tasks — prepares the admin "Sales Tasks" list: works out who needs a
// call today and saves them as tasks, in seven sections (see logic.ts):
// progressions 1→2 … 4→5 and hot leads, assessments and psychiatry from
// Acuity; stalled and nearly-done bundles from admin-bundles' saved snapshot;
// follow-ups and no-answer sequences from the hub's own tables. Hot leads
// are only Courtney's (SALES_TASK_CALENDARS in logic.ts).
//   - POST with x-cron-secret, from the sales-tasks GitHub Actions workflow
//     every morning
//   - POST from an admin ("Prepare today's list" / "Refresh" on the page);
//     the caller's JWT and admin role are checked first
// Both do the same idempotent run (see ./logic.ts): new tasks are added once
// per event, unfinished tasks are carried over, priorities are re-scored and
// tasks whose lead has since booked are closed. The page reads the saved
// tasks straight from the database (admin-only RLS).
//
// PRIVACY: logs and the run summary stay counts-only — never names, emails,
// phones or appointments.
//
// DEPLOY: imports ../admin-customer-insights, ../admin-leads,
// ../admin-clinical and ../admin-bundles, so deploy with the Supabase CLI
// (`supabase functions deploy sales-tasks`), which bundles them.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type AcuityAppointment,
  type HistoryCheck,
  type HistoryLookup,
  ACTIVE_WINDOW_DAYS,
  PROGRESSION_RANGES,
  addDays,
  buildPortalEmailSet,
  buildProgressionView,
  evaluateHistory,
  fetchAppointmentsInWindows,
  groupCustomers,
  mapWithConcurrency,
  progressionCandidates,
  toDateString,
} from "../admin-customer-insights/logic.ts";
import type { BundleRow } from "../admin-bundles/logic.ts";
import {
  LEAD_LOOKBACK_DAYS,
  buildLeadsView,
  evaluateLeadHistory,
  leadCandidates,
} from "../admin-leads/logic.ts";
import type { RecentAttempt } from "../admin-leads/score.ts";
import {
  CLINICAL_LOOKBACK_DAYS,
  buildAssessmentView,
  buildPsychiatryView,
} from "../admin-clinical/logic.ts";
import {
  type FollowupRow,
  type SavedTask,
  type SequenceRow,
  arrangeCandidates,
  assessmentCandidates,
  bundleTaskCandidates,
  candidateKeys,
  createdEvent,
  dublinDate,
  followupTaskCandidates,
  hotLeadCandidates,
  mergeCandidateSets,
  noAnswerTaskCandidates,
  planDailyRun,
  progressionTaskCandidates,
  psychiatryCandidates,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";
const WINDOW_LIMIT = 500;
const LOOKBACK_DAYS = Math.max(LEAD_LOOKBACK_DAYS, CLINICAL_LOOKBACK_DAYS, ACTIVE_WINDOW_DAYS);
/** Results per progression history lookup (as admin-customer-insights). */
const HISTORY_LIMIT = 200;
const HISTORY_START_DATE = "2010-01-01";
/** Ended no-answer sequences read, so their open tasks close. */
const ENDED_SEQUENCE_DAYS = 60;
/** How far ahead to look for bookings that resolve a task. */
const FUTURE_DAYS = 180;
const ACUITY_CONCURRENCY = 4;
/** Contact attempts this old or newer are read (lookback plus a margin). */
const ATTEMPTS_DAYS = LOOKBACK_DAYS + 30;
/** A run still "running" after this long is treated as crashed. */
const STALE_RUN_MS = 10 * 60_000;
const SAVED_COLUMNS =
  "id, dedupe_key, customer_key, kind, status, trigger_at, due_on, priority, score, carried_over_count, last_carried_on, created_on";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// Reads every row of a query, 1000 at a time.
async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Failed to read ${what}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

// Returns the caller's label for the run log ("cron" or their email), or a
// Response refusing them.
async function authorise(req: Request, supabaseUrl: string, anonKey: string): Promise<string | Response> {
  const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return "cron";

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization header" }, 401);
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", { check_role: "admin" });
  if (roleError || !isAdmin) return json({ error: "Forbidden: Admin access required" }, 403);
  return user.email ?? "admin";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = await authorise(req, supabaseUrl, anonKey);
  if (caller instanceof Response) return caller;

  const acuityUserId = Deno.env.get("ACUITY_USER_ID");
  const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
  if (!acuityUserId || !acuityApiKey) {
    return json({ error: "Acuity credentials not configured" }, 500);
  }
  const acuityAuth = `Basic ${btoa(`${acuityUserId}:${acuityApiKey}`)}`;

  const db: SupabaseClient = createClient(supabaseUrl, serviceKey);
  const startedAt = Date.now();
  const now = startedAt;
  const runOn = dublinDate(now);

  // One run at a time: refuse while another started recently and hasn't finished.
  const { data: existingRun, error: runReadError } = await db
    .from("sales_task_runs")
    .select("status, started_at, runs_today")
    .eq("run_on", runOn)
    .maybeSingle();
  if (runReadError) {
    return json({ error: `Failed to read runs: ${runReadError.message}` }, 500);
  }
  if (existingRun?.status === "running" && now - Date.parse(existingRun.started_at) < STALE_RUN_MS) {
    return json({ error: "Today's list is already being prepared. Try again in a minute." }, 409);
  }
  const { error: runWriteError } = await db.from("sales_task_runs").upsert({
    run_on: runOn,
    status: "running",
    started_at: new Date(now).toISOString(),
    finished_at: null,
    triggered_by: caller,
    runs_today: (existingRun?.runs_today ?? 0) + 1,
    error: null,
  });
  if (runWriteError) {
    return json({ error: `Failed to start the run: ${runWriteError.message}` }, 500);
  }

  try {
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

    // 1. One Acuity fetch shared by the Acuity-based sources.
    const today = toDateString(now);
    const fetched = await fetchAppointmentsInWindows(
      (minDate, maxDate) =>
        acuityAppointments(new URLSearchParams({ minDate, maxDate, max: String(WINDOW_LIMIT) })),
      addDays(today, -(LOOKBACK_DAYS + 1)),
      addDays(today, FUTURE_DAYS),
      { limit: WINDOW_LIMIT, chunkDays: 7, concurrency: ACUITY_CONCURRENCY }
    );
    const customers = groupCustomers(fetched.appointments);

    // 2. Hub data: portal accounts, contact attempts, staff outcomes and
    //    follow-up dates, no-answer sequences, the saved Bundles view.
    const [profileEmails, attempts, followupRows, sequences, bundlesSnapshot] = await Promise.all([
      readAll<{ email: string | null }>(
        (from, to) => db.from("profiles").select("email").order("id").range(from, to),
        "profiles"
      ),
      readAll<RecentAttempt>(
        (from, to) =>
          db
            .from("customer_contact_attempts")
            .select("customer_key, outcome, created_at")
            .gte("created_at", new Date(now - ATTEMPTS_DAYS * 86_400_000).toISOString())
            .order("created_at")
            .range(from, to),
        "contact attempts"
      ),
      readAll<FollowupRow>(
        (from, to) =>
          db
            .from("customer_followups")
            // Every row: one whose outcome was cleared closes its follow-up task.
            .select("customer_key, customer_name, outcome, outcome_at, follow_up_due")
            .order("customer_key")
            .range(from, to),
        "follow-ups"
      ),
      readAll<SequenceRow>(
        (from, to) =>
          db
            .from("no_answer_sequences")
            .select(
              "customer_key, customer_name, customer_phone, status, attempts_done, started_at, next_due_on, closed_at, closed_reason"
            )
            .or(
              `status.eq.active,closed_at.gte."${new Date(now - ENDED_SEQUENCE_DAYS * 86_400_000).toISOString()}"`
            )
            .order("id")
            .range(from, to),
        "no-answer sequences"
      ),
      db
        .from("admin_snapshots")
        .select("data, generated_at")
        .eq("source", "admin-bundles")
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) throw new Error(`Failed to read the Bundles snapshot: ${error.message}`);
          return data as { data: { bundles?: { rows?: BundleRow[] } }; generated_at: string } | null;
        }),
    ]);

    // 3. Progression: number each recent customer's sessions from their
    //    full history (one Acuity lookup each, as the Progression pages do).
    const progression = progressionCandidates(customers, now);
    const history = new Map(
      await mapWithConcurrency(
        progression,
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
      )
    );

    // 4. The seven sources. Hot leads skip admin-leads' per-lead history
    //    lookup (one Acuity call each) to keep the run short; the window's
    //    history is used instead, which only affects two small score parts.
    const portalEmails = buildPortalEmailSet(profileEmails.map((p) => p.email));
    const leads = leadCandidates(customers, now);
    const leadRows = buildLeadsView(
      leads,
      new Map(leads.map((lead) => [lead.customer.key, evaluateLeadHistory(null, lead, now)])),
      portalEmails,
      now
    ).rows;
    const stages = PROGRESSION_RANGES.map((fromSession) =>
      buildProgressionView(progression, history, portalEmails, now, fromSession)
    );
    // No snapshot yet: no bundle tasks, and open ones are left as they are.
    const bundleRows = bundlesSnapshot?.data?.bundles?.rows ?? [];
    const followups = new Map(followupRows.map((row) => [row.customer_key, row]));
    const directory = new Map(customers.map((c) => [c.key, { name: c.name, email: c.email, phone: c.phone }]));
    const inNoAnswerSequence = new Set(
      sequences.filter((row) => row.status === "active").map((row) => row.customer_key)
    );
    // Each customer once, in their first section; hot leads only Courtney's.
    const { candidates, resolutions } = arrangeCandidates(
      mergeCandidateSets(
        progressionTaskCandidates(stages, attempts, followups, now),
        bundleTaskCandidates(bundleRows, attempts, followups, now),
        followupTaskCandidates(followupRows, directory, now),
        noAnswerTaskCandidates(sequences, directory, now),
        hotLeadCandidates(leadRows, attempts, followups, now),
        psychiatryCandidates(buildPsychiatryView(customers, now).rows, attempts, now),
        assessmentCandidates(buildAssessmentView(customers, now).rows, attempts, now)
      ),
      inNoAnswerSequence
    );

    // 5. Saved tasks: every pending one, plus any that already used a
    //    candidate's event (so finished tasks aren't recreated).
    const pending = await readAll<SavedTask>(
      (from, to) => db.from("sales_tasks").select(SAVED_COLUMNS).eq("status", "pending").order("id").range(from, to),
      "pending tasks"
    );
    const byId = new Map(pending.map((task) => [task.id, task]));
    for (const keys of chunk(candidateKeys(candidates), 100)) {
      const { data, error } = await db.from("sales_tasks").select(SAVED_COLUMNS).in("dedupe_key", keys);
      if (error) throw new Error(`Failed to read tasks: ${error.message}`);
      for (const task of data ?? []) byId.set(task.id, task as SavedTask);
    }

    // 6. Plan and apply.
    const plan = planDailyRun({
      candidates,
      resolutions,
      saved: [...byId.values()],
      now,
      newId: () => crypto.randomUUID(),
    });

    const events = [...plan.events];
    let inserted = 0;
    for (const rows of chunk(plan.inserts, 100)) {
      // ignoreDuplicates: a task another run saved first is left as it is.
      const { data, error } = await db
        .from("sales_tasks")
        .upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(`Failed to add tasks: ${error.message}`);
      const savedIds = new Set((data ?? []).map((row) => row.id));
      inserted += savedIds.size;
      events.push(...rows.filter((row) => savedIds.has(row.id)).map(createdEvent));
    }

    // Only still-pending tasks are touched, so one staff completed while
    // this ran stays completed; its events are dropped.
    const skipped = new Set<string>();
    await mapWithConcurrency(plan.updates, 5, async (update) => {
      const { data, error } = await db
        .from("sales_tasks")
        .update(update.patch)
        .eq("id", update.id)
        .eq("status", "pending")
        .select("id");
      if (error) throw new Error(`Failed to update a task: ${error.message}`);
      if (!data || data.length === 0) skipped.add(update.id);
    });

    const keptEvents = events.filter((event) => !skipped.has(event.task_id));
    for (const rows of chunk(keptEvents, 500)) {
      const { error } = await db.from("sales_task_events").insert(rows);
      if (error) throw new Error(`Failed to log task events: ${error.message}`);
    }

    const summary = {
      ...plan.summary,
      created: inserted,
      updatesSkipped: skipped.size,
      candidates: candidates.length,
      historyLookups: progression.length,
      bundleRows: bundleRows.length,
      activeSequences: inNoAnswerSequence.size,
      windowAppointments: fetched.appointments.length,
      incompleteDates: fetched.incompleteDates.length,
      acuityRequests,
      durationMs: Date.now() - startedAt,
    };
    await db
      .from("sales_task_runs")
      .update({ status: "done", finished_at: new Date().toISOString(), summary })
      .eq("run_on", runOn);
    console.log("sales-tasks completed", { caller: caller === "cron" ? "cron" : "admin", ...summary });

    return json({ runOn, summary });
  } catch (error) {
    // Messages here are built without client data (see acuityAppointments).
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("sales-tasks failed:", message);
    await db
      .from("sales_task_runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), error: message.slice(0, 500) })
      .eq("run_on", runOn);
    return json({ error: message }, 500);
  }
});
