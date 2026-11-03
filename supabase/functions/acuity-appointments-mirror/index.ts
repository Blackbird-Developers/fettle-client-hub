// acuity-appointments-mirror — keeps public.acuity_appointments, a copy of
// every Acuity appointment, up to date for the admin Overview analytics
// (admin-analytics). Those need each client's full booking history and who
// made each booking, neither of which Acuity can give on page load.
//
// Run by the admin-snapshots GitHub Actions workflow
// (.github/scripts/sync-acuity-appointments.mjs), POST with x-cron-secret,
// one step per call so no call runs past the edge-function time limit:
//   { step: "plan" }                → the date ranges for this run
//   { step: "range", minDate, maxDate, backfill? }
//                                   → copies that range's appointments,
//                                     cancelled included; a history range
//                                     also moves acuity_sync_state on
//   { step: "prune", minDate, maxDate, seenIds }
//                                   → removes rows in the refresh window that
//                                     Acuity no longer returns (deleted there)
//   { step: "details", limit }      → looks up scheduledBy for up to `limit`
//                                     sessions still waiting for it
//   { step: "sources", limit }      → matches up to `limit` main-account
//                                     bookings to website / hub Stripe payments
//   { step: "state", refreshed?, summary?, error? }
//                                   → records the run in acuity_sync_state
//
// PRIVACY: rows hold client names and contact details. Step responses carry
// only counts, dates and appointment ids; logs stay counts-only.
//
// DEPLOY: imports ../admin-customer-insights/logic.ts, so deploy with the
// Supabase CLI (`supabase functions deploy acuity-appointments-mirror`).
// Reads Stripe with RESTRICTED_API_KEY (as unpaid-sessions does).
// config.toml turns off the gateway JWT check so the workflow can call it;
// the cron secret is checked here instead.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fetchAppointmentsInWindows,
  mapWithConcurrency,
  toDateString,
} from "../admin-customer-insights/logic.ts";
import { TRACKING_START } from "../admin-analytics/logic.ts";
import {
  type AcuityMirrorAppointment,
  type BookingPayment,
  type MirrorRow,
  type StripePaymentIntent,
  HISTORY_START_DATE,
  PAYMENT_AFTER_BOOKING_MS,
  PAYMENT_BEFORE_BOOKING_MS,
  RANGE_DAYS,
  backfillRanges,
  bookingSourceFromPayments,
  dateRanges,
  idsToPrune,
  isBookedByClient,
  nextBackfilledFrom,
  refreshWindow,
  sourceFromScheduledBy,
  toBookingPayment,
  toMirrorRow,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

/** Results per Acuity request; a full one is split in half. */
const WINDOW_LIMIT = 500;
/** Days per Acuity request within a step. */
const CHUNK_DAYS = 7;
const ACUITY_CONCURRENCY = 4;
/** Most detail lookups per "details" step. */
const MAX_DETAILS_PER_STEP = 200;
/** Most "details" steps per run, so a run leaves Acuity room for the rest of the admin area. */
const MAX_DETAIL_STEPS_PER_RUN = 25;
/** Main-account bookings matched to Stripe per "sources" step. Taken in
 *  booking order, so one step's payments span a few days at most. */
const MAX_SOURCES_PER_STEP = 100;
const MAX_SOURCE_STEPS_PER_RUN = 20;
/** Longest stretch of bookings matched in one "sources" step. */
const SOURCE_SPAN_MS = 3 * 24 * 60 * 60 * 1000;
/** Most Stripe payments read per "sources" step. */
const MAX_PAYMENTS_PER_STEP = 3000;
/** Bookings this recent wait a run, so the hub has stamped its payment. */
const SOURCE_SETTLE_MS = 60 * 60 * 1000;
const UPSERT_BATCH = 500;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const isDateRange = (minDate: unknown, maxDate: unknown): boolean =>
  typeof minDate === "string" && DATE_PATTERN.test(minDate) &&
  typeof maxDate === "string" && DATE_PATTERN.test(maxDate) &&
  minDate <= maxDate;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("REMINDER_CRON_SECRET");
    const isCron =
      req.method === "POST" && Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;
    if (!isCron) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const step = body?.step;
    const startedAt = Date.now();
    const today = toDateString(startedAt);

    const { data: state, error: stateError } = await db
      .from("acuity_sync_state")
      .select("backfilled_from, backfill_complete")
      .eq("id", true)
      .maybeSingle();
    if (stateError) throw new Error(`Failed to read sync state: ${stateError.code}`);

    if (step === "plan") {
      const window = refreshWindow(today);
      return json({
        refreshWindow: window,
        refreshRanges: dateRanges(window.minDate, window.maxDate, RANGE_DAYS),
        backfillRanges: state?.backfill_complete ? [] : backfillRanges(state?.backfilled_from ?? null, today),
        detailsPerStep: MAX_DETAILS_PER_STEP,
        maxDetailSteps: MAX_DETAIL_STEPS_PER_RUN,
        // The workflow runs "sources" only when these are here, so it keeps
        // working against a copy of this function deployed before the step.
        sourcesPerStep: MAX_SOURCES_PER_STEP,
        maxSourceSteps: MAX_SOURCE_STEPS_PER_RUN,
      });
    }

    if (step === "state") {
      const update: Record<string, unknown> = { updated_at: new Date(startedAt).toISOString() };
      if (body.refreshed === true) {
        update.last_refreshed_at = new Date(startedAt).toISOString();
        update.last_error = null;
      }
      if (body.summary && typeof body.summary === "object") update.last_run_summary = body.summary;
      if (typeof body.error === "string") update.last_error = body.error.slice(0, 500);
      const { error } = await db.from("acuity_sync_state").update(update).eq("id", true);
      if (error) throw new Error(`Failed to save sync state: ${error.code}`);
      return json({ ok: true });
    }

    if (step === "prune") {
      if (!isDateRange(body.minDate, body.maxDate) || !Array.isArray(body.seenIds)) {
        return json({ error: "prune needs minDate, maxDate and seenIds" }, 400);
      }
      const window = { minDate: body.minDate as string, maxDate: body.maxDate as string };
      const stored: { id: number; datetime: string }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db
          .from("acuity_appointments")
          .select("id, datetime")
          .gte("datetime", `${window.minDate}T00:00:00Z`)
          .lte("datetime", `${window.maxDate}T23:59:59Z`)
          .order("id")
          .range(from, from + 999);
        if (error) throw new Error(`Failed to read appointments: ${error.code}`);
        stored.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const ids = idsToPrune(stored, new Set(body.seenIds.map(Number)), window);
      for (let i = 0; i < ids.length; i += UPSERT_BATCH) {
        const { error } = await db.from("acuity_appointments").delete().in("id", ids.slice(i, i + UPSERT_BATCH));
        if (error) throw new Error(`Failed to remove appointments: ${error.code}`);
      }
      return json({ checked: stored.length, removed: ids.length, durationMs: Date.now() - startedAt });
    }

    if (step === "sources") {
      const limit = Math.min(Math.max(Number(body.limit) || 0, 1), MAX_SOURCES_PER_STEP);
      const stripeKey = Deno.env.get("RESTRICTED_API_KEY");
      if (!stripeKey) return json({ error: "Stripe key not configured" }, 500);

      const { data: queue, error: queueError } = await db.rpc("acuity_sources_queue", {
        p_since: `${TRACKING_START}T00:00:00Z`,
        p_settled_before: new Date(startedAt - SOURCE_SETTLE_MS).toISOString(),
        p_limit: limit,
      });
      if (queueError) throw new Error(`Failed to read the sources queue: ${queueError.code}`);
      const queued = ((queue ?? []) as { id: number; email: string | null; datetime_created: string | null }[]).map(
        (row) => ({
          id: Number(row.id),
          email: row.email,
          createdAt: row.datetime_created ? Date.parse(row.datetime_created) : null,
        })
      );
      // Only bookings made within SOURCE_SPAN_MS of the first, so the payments
      // read stay few; the rest wait for the next step.
      const firstCreated = queued.find((b) => b.createdAt !== null)?.createdAt ?? null;
      const bookings = queued.filter(
        (b) => b.createdAt === null || firstCreated === null || b.createdAt <= firstCreated + SOURCE_SPAN_MS
      );
      if (bookings.length === 0) return json({ checked: 0, remaining: 0, durationMs: Date.now() - startedAt });

      // Every website or hub payment made around these bookings.
      const times = bookings.map((b) => b.createdAt).filter((t): t is number => t !== null);
      const payments: BookingPayment[] = [];
      let paymentsRead = 0;
      if (times.length > 0) {
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        const created = {
          gte: Math.floor((Math.min(...times) - PAYMENT_BEFORE_BOOKING_MS) / 1000),
          lte: Math.ceil((Math.max(...times) + PAYMENT_AFTER_BOOKING_MS) / 1000),
        };
        for await (const pi of stripe.paymentIntents.list({ created, limit: 100 })) {
          paymentsRead++;
          const payment = toBookingPayment(pi as unknown as StripePaymentIntent);
          if (payment) payments.push(payment);
          if (paymentsRead >= MAX_PAYMENTS_PER_STEP) {
            // Too many to be sure of a match; try again next run rather than guess.
            throw new Error(`More than ${MAX_PAYMENTS_PER_STEP} Stripe payments around one batch`);
          }
        }
      }

      const ids = bookings.map((b) => String(b.id));
      const { data: redemptions, error: redemptionsError } = await db
        .from("referral_redemptions")
        .select("booking_ref")
        .in("booking_ref", ids);
      if (redemptionsError) throw new Error(`Failed to read referral redemptions: ${redemptionsError.code}`);
      const referralIds = new Set((redemptions ?? []).map((r) => String(r.booking_ref)));

      const counts: Record<string, number> = {};
      const checkedAt = new Date().toISOString();
      for (const booking of bookings) {
        const source = bookingSourceFromPayments(booking, payments, referralIds);
        counts[source] = (counts[source] ?? 0) + 1;
        const { error } = await db
          .from("acuity_appointments")
          .update({ booking_source: source, source_checked_at: checkedAt })
          .eq("id", booking.id);
        if (error) throw new Error(`Failed to save a booking source: ${error.code}`);
      }

      const { data: rest, error: restError } = await db.rpc("acuity_sources_queue", {
        p_since: `${TRACKING_START}T00:00:00Z`,
        p_settled_before: new Date(startedAt - SOURCE_SETTLE_MS).toISOString(),
        p_limit: 1,
      });
      if (restError) throw new Error(`Failed to read the sources queue: ${restError.code}`);

      console.log("acuity-appointments-mirror sources", { checked: bookings.length, paymentsRead, ...counts });
      return json({
        checked: bookings.length,
        sources: counts,
        paymentsRead,
        remaining: (rest ?? []).length,
        durationMs: Date.now() - startedAt,
      });
    }

    if (step !== "range" && step !== "details") {
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
    // status, never a URL or client data. 404 returns null.
    async function acuityGet<T>(path: string): Promise<T | null> {
      for (let attempt = 0; ; attempt++) {
        acuityRequests++;
        const response = await fetch(`${ACUITY_API_BASE}${path}`, {
          headers: { Authorization: acuityAuth, "Content-Type": "application/json" },
        });
        if (response.ok) return await response.json();
        await response.body?.cancel();
        if (response.status === 404) return null;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= 2) {
          throw new Error(`Acuity API error: ${response.status}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }

    if (step === "details") {
      const limit = Math.min(Math.max(Number(body.limit) || 0, 1), MAX_DETAILS_PER_STEP);
      const { data: queue, error: queueError } = await db.rpc("acuity_details_queue", { p_limit: limit });
      if (queueError) throw new Error(`Failed to read the lookup queue: ${queueError.code}`);
      const ids = (queue ?? []).map(Number);

      let checked = 0;
      let removed = 0;
      let failed = 0;
      await mapWithConcurrency(ids, ACUITY_CONCURRENCY, async (id) => {
        try {
          const detail = await acuityGet<{ scheduledBy?: string | null }>(`/appointments/${id}`);
          if (detail === null) {
            // Deleted in Acuity since it was copied.
            const { error } = await db.from("acuity_appointments").delete().eq("id", id);
            if (error) throw new Error(error.code);
            removed++;
            return;
          }
          const scheduledBy = (detail.scheduledBy ?? "").trim();
          // Main-account bookings get their source from the "sources" step.
          const source = sourceFromScheduledBy(scheduledBy);
          const now = new Date().toISOString();
          const { error } = await db
            .from("acuity_appointments")
            .update({
              scheduled_by: scheduledBy || null,
              booked_by_client: isBookedByClient(scheduledBy),
              details_fetched_at: now,
              ...(source ? { booking_source: source, source_checked_at: now } : {}),
            })
            .eq("id", id);
          if (error) throw new Error(error.code);
          checked++;
        } catch {
          // Left in the queue for the next run.
          failed++;
        }
      });

      const { count: remaining, error: countError } = await db
        .from("acuity_appointments")
        .select("id", { count: "exact", head: true })
        .is("details_fetched_at", null)
        .eq("canceled", false)
        .in("kind", ["therapy", "intro", "assessment"]);
      if (countError) throw new Error(`Failed to count the lookup queue: ${countError.code}`);

      console.log("acuity-appointments-mirror details", { checked, removed, failed, remaining, acuityRequests });
      return json({ checked, removed, failed, remaining: remaining ?? 0, acuityRequests, durationMs: Date.now() - startedAt });
    }

    // step === "range"
    const { minDate, maxDate } = body;
    if (!isDateRange(minDate, maxDate)) {
      return json({ error: "range needs minDate and maxDate" }, 400);
    }

    // Acuity lists active and cancelled appointments separately.
    const fetchState = (canceled: boolean) =>
      fetchAppointmentsInWindows(
        async (from, to) =>
          (await acuityGet<AcuityMirrorAppointment[]>(
            `/appointments?${new URLSearchParams({
              minDate: from,
              maxDate: to,
              max: String(WINDOW_LIMIT),
              canceled: String(canceled),
              excludeForms: "true",
            })}`
          )) ?? [],
        minDate,
        maxDate,
        { limit: WINDOW_LIMIT, chunkDays: CHUNK_DAYS, concurrency: ACUITY_CONCURRENCY }
      );
    const [active, cancelled] = [await fetchState(false), await fetchState(true)];

    const rows = [...active.appointments, ...cancelled.appointments]
      .map((appt) => toMirrorRow(appt as AcuityMirrorAppointment, startedAt))
      .filter((row): row is MirrorRow => row !== null);
    // One row per id (a cancelled copy wins: it can't be un-cancelled).
    const byId = new Map(rows.map((row) => [row.id, row]));
    const unique = [...byId.values()];

    for (let i = 0; i < unique.length; i += UPSERT_BATCH) {
      const { error } = await db
        .from("acuity_appointments")
        .upsert(unique.slice(i, i + UPSERT_BATCH), { onConflict: "id" });
      if (error) throw new Error(`Failed to save appointments: ${error.code}`);
    }

    const incompleteDates = [...new Set([...active.incompleteDates, ...cancelled.incompleteDates])].sort();

    // A history range moves the "copied from" date on, if it joins up. A day
    // with more than WINDOW_LIMIT appointments can't be fetched in full; it's
    // reported in incompleteDates rather than retried forever.
    if (body.backfill === true) {
      const backfilledFrom = nextBackfilledFrom(state?.backfilled_from ?? null, today, minDate, maxDate);
      const { error } = await db
        .from("acuity_sync_state")
        .update({
          backfilled_from: backfilledFrom,
          backfill_complete: backfilledFrom !== null && backfilledFrom <= HISTORY_START_DATE,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true);
      if (error) throw new Error(`Failed to save sync state: ${error.code}`);
    }

    return json({
      saved: unique.length,
      cancelled: cancelled.appointments.length,
      ids: unique.map((row) => row.id),
      incompleteDates,
      acuityRequests,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    // Messages here are built without client data.
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("acuity-appointments-mirror failed:", message);
    return json({ error: message }, 500);
  }
});
