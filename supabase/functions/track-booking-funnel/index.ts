// track-booking-funnel — stores booking-funnel step events from the website
// (fettle.ie/our-therapists + /book-a-session) and the hub's /book wizard in
// booking_funnel_events. The admin Overview's "Booking funnel" tab reads them
// through admin-analytics.
//
// Public, no JWT (config.toml): visitors aren't logged in. Protections:
//   - only listed origins (fettle.ie, my.fettle.ie, + FUNNEL_EXTRA_ORIGINS)
//   - only known event names and fields (see logic.ts); personal data dropped
//   - body size, batch size and a per-IP rate limit
//   - event_id is unique, so a resent beacon is stored once
// About 1 request in 100 also deletes events older than 13 months
// (RETENTION_DAYS), so the table cleans itself without a scheduled job.
// The data is anonymous counts, so the worst a forger can do is skew the
// numbers; it can't read anything back.
//
// Body is JSON, sent as text/plain by navigator.sendBeacon (a JSON
// content type would need a CORS preflight, which beacons can't do).
// Always answers 204 for accepted requests, even if some events were skipped.
//
// DEPLOY: `supabase functions deploy track-booking-funnel` (needs the
// [functions.track-booking-funnel] verify_jwt = false entry in config.toml).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  MAX_BODY_BYTES,
  PURGE_CHANCE,
  RateLimiter,
  allowedOrigins,
  parsePayload,
  retentionCutoff,
} from "./logic.ts";

const ORIGINS = allowedOrigins(Deno.env.get("FUNNEL_EXTRA_ORIGINS"));
// 300 events a minute per IP: a full booking is ~15 events, so this only
// stops scripted floods (offices behind one IP are well under it).
const limiter = new RateLimiter(300, 60_000);

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

serve(async (req) => {
  const origin = (req.headers.get("origin") ?? "").replace(/\/+$/, "");
  if (!ORIGINS.has(origin)) return new Response(null, { status: 403 });
  const cors = corsHeaders(origin);
  const reply = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: body === undefined ? cors : { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { error: "too_large" });

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return reply(400, { error: "invalid_json" });
    }

    const parsed = parsePayload(body, Date.now());
    if (!parsed.ok) return reply(400, { error: parsed.error });
    if (parsed.rows.length === 0) return reply(204);

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (!limiter.take(ip, parsed.rows.length, Date.now())) return reply(429, { error: "rate_limited" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("track-booking-funnel: missing env");
      return reply(500, { error: "not_configured" });
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { error } = await admin
      .from("booking_funnel_events")
      .upsert(parsed.rows, { onConflict: "event_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    // Occasional clean-up of old events, so no scheduled job is needed.
    if (Math.random() < PURGE_CHANCE) {
      const { error: purgeError } = await admin
        .from("booking_funnel_events")
        .delete()
        .lt("occurred_at", retentionCutoff(Date.now()));
      if (purgeError) console.error("track-booking-funnel purge failed:", purgeError.message);
    }

    return reply(204);
  } catch (error) {
    console.error("track-booking-funnel failed:", error instanceof Error ? error.message : "unknown");
    return reply(500, { error: "internal_error" });
  }
});
