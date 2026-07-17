import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";

function logStep(step: string, details?: unknown) {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SUBMIT-THERAPIST-REVIEW] ${step}${detailsStr}`);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Resolve the authenticated user (id + email) from the request's Supabase JWT.
// Returns null when the caller is not a real signed-in user (e.g. only the
// public anon key was presented). Reviews are tied to a real client identity.
async function getAuthenticatedUser(
  req: Request,
): Promise<{ id: string; email: string } | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const bearer = req.headers.get("Authorization")?.replace("Bearer ", "").trim();
  if (!supabaseUrl || !supabaseAnonKey || !bearer) return null;
  try {
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabaseAuth.auth.getUser(bearer);
    if (error || !data.user?.email) return null;
    return { id: data.user.id, email: data.user.email };
  } catch (_e) {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    logStep("Function started");

    const acuityUserId = Deno.env.get("ACUITY_USER_ID");
    const acuityApiKey = Deno.env.get("ACUITY_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!acuityUserId || !acuityApiKey) throw new Error("Acuity credentials not configured");
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Supabase credentials not configured");

    // 1) Authenticate — the review is bound to the caller's real identity. The
    //    client can never supply someone else's user id or email.
    const authedUser = await getAuthenticatedUser(req);
    if (!authedUser) {
      logStep("Rejected: no authenticated user");
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // 2) Parse & validate input. Note: therapist identity is NOT taken from the
    //    body — it is derived from the real Acuity appointment below.
    const body = await req.json().catch(() => ({}));
    const appointmentId = body?.appointmentId;
    const ratingRaw = body?.rating;
    const comment: string | null =
      typeof body?.comment === "string" && body.comment.trim().length > 0
        ? body.comment.trim().slice(0, 2000)
        : null;
    const publicConsent = body?.publicConsent === true;

    if (appointmentId === undefined || appointmentId === null || `${appointmentId}`.trim() === "") {
      return jsonResponse({ error: "Missing appointmentId" }, 400);
    }
    const rating = Number(ratingRaw);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return jsonResponse({ error: "Rating must be an integer from 1 to 5" }, 400);
    }

    const appointmentIdStr = `${appointmentId}`.trim();
    logStep("Validated input", { userId: authedUser.id, appointmentId: appointmentIdStr, rating });

    // 3) Fetch the appointment from Acuity and verify ownership + eligibility.
    const acuityAuthHeader = btoa(`${acuityUserId}:${acuityApiKey}`);
    const appointmentResponse = await fetch(
      `${ACUITY_API_BASE}/appointments/${encodeURIComponent(appointmentIdStr)}`,
      {
        headers: {
          "Authorization": `Basic ${acuityAuthHeader}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (appointmentResponse.status === 404) {
      logStep("Appointment not found", { appointmentId: appointmentIdStr });
      return jsonResponse({ error: "Appointment not found" }, 404);
    }
    if (!appointmentResponse.ok) {
      throw new Error(`Acuity API error: ${appointmentResponse.status}`);
    }

    const appointment = await appointmentResponse.json();

    // Ownership: the appointment's email must match the signed-in user's email.
    if (appointment.email?.toLowerCase() !== authedUser.email.toLowerCase()) {
      logStep("Rejected: appointment does not belong to caller", { appointmentId: appointmentIdStr });
      // 403 rather than 404 to be explicit; still leaks nothing about the appt.
      return jsonResponse({ error: "You can only review sessions you attended" }, 403);
    }

    // Eligibility: only past, non-cancelled (completed) sessions can be reviewed.
    if (appointment.canceled) {
      return jsonResponse({ error: "Cancelled sessions cannot be reviewed" }, 400);
    }
    const sessionTime = new Date(appointment.datetime).getTime();
    if (!Number.isFinite(sessionTime) || sessionTime > Date.now()) {
      return jsonResponse({ error: "You can only review sessions that have taken place" }, 400);
    }

    // Therapist identity comes from the source of truth (Acuity), not the client.
    const calendarId = Number(appointment.calendarID);
    const therapistName: string = appointment.calendar ?? "Therapist";
    if (!Number.isFinite(calendarId)) {
      throw new Error("Appointment is missing a therapist/calendar id");
    }

    logStep("Appointment verified", { calendarId, therapistName, datetime: appointment.datetime });

    // 4) Upsert the review with the service role (bypasses RLS). Conflict on
    //    (user_id, appointment_id) turns a re-submission into an edit.
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: review, error: upsertError } = await supabaseAdmin
      .from("therapist_reviews")
      .upsert(
        {
          user_id: authedUser.id,
          appointment_id: appointmentIdStr,
          calendar_id: calendarId,
          therapist_name: therapistName,
          rating,
          comment,
          public_consent: publicConsent,
        },
        { onConflict: "user_id,appointment_id" },
      )
      .select()
      .single();

    if (upsertError) {
      logStep("Upsert failed", { error: upsertError.message });
      throw new Error(upsertError.message);
    }

    logStep("Review saved", { reviewId: review?.id });
    return jsonResponse({ success: true, review });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });
    return jsonResponse({ error: errorMessage }, 500);
  }
});
