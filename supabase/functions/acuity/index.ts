import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { forbidden, getCaller, sameEmail, unauthorized } from "../_shared/auth.ts";
import { bookingConfirmationHtml, bookingConfirmationText, formatSessionWhen } from "../_shared/bookingConfirmationEmail.ts";
import { sendPushToUser, sessionLink } from "../_shared/push.ts";
import { requireSupportedAppVersion } from "../_shared/appVersion.ts";
import { hasSessionStarted, TOO_LATE_MESSAGE } from "../_shared/sessionTiming.ts";

// AUTH (see docs/edge-function-auth.md):
//   get-appointment-types, get-calendars, get-availability, get-times
//       public catalogue data; the anon key is enough (the website calls
//       these with the anon key, before and after sign-in).
//   get-appointments, cancel-appointment, reschedule
//       user JWT; only the caller's own appointments (Acuity email = JWT email).
//   book-appointment
//       retired: it booked straight into Acuity with no payment. Bookings go
//       through confirm-payment-and-book / book-with-package / book-with-credit.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-app-version',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ACUITY_API_BASE = 'https://acuityscheduling.com/api/v1';

// Resolve the authenticated user's email from the request's Supabase JWT.
// Returns null if the caller is not a real signed-in user (e.g. only the
// public anon key was presented). Appointment data is PHI, so the
// get-appointments action uses this to scope results to the caller's own
// email and rejects anonymous callers.
async function getAuthenticatedEmail(req: Request): Promise<string | null> {
  return (await getCaller(req))?.email ?? null;
}

// After a reschedule: hub records, confirmation email and push. Each step is
// best-effort and logged; none can undo or fail the move itself.
async function afterReschedule(
  userId: string,
  email: string,
  before: any,
  moved: any,
  requestTimezone: unknown,
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const admin = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;

  let timezone = typeof requestTimezone === 'string' && requestTimezone ? requestTimezone : '';
  if (!timezone && admin) {
    try {
      const { data } = await admin.from('profiles').select('timezone').eq('user_id', userId).maybeSingle();
      timezone = data?.timezone || '';
    } catch (_e) { /* default below */ }
  }
  const { dateLabel, timeLabel } = formatSessionWhen(moved.datetime, timezone || 'Europe/Dublin');
  const therapist = String(moved.calendar || before.calendar || '').trim();

  if (admin) {
    // Activity feed (the web's RecentActivity knows session_booked).
    try {
      await admin.from('user_activities').insert({
        user_id: userId,
        activity_type: 'session_booked',
        title: `Session rescheduled: ${moved.type || before.type || 'Therapy session'}`,
        description: `Moved to ${dateLabel} at ${timeLabel}${therapist ? ` with ${therapist}` : ''}`,
        metadata: { appointmentId: moved.id, rescheduled: true, previousDatetime: before.datetime, datetime: moved.datetime },
      });
    } catch (e) {
      console.error('Reschedule: activity insert failed', String(e).slice(0, 200));
    }
    // Admin mirror, so the admin area shows the new time before the next sync.
    try {
      await admin.from('acuity_appointments').update({ datetime: moved.datetime }).eq('id', moved.id);
    } catch (e) {
      console.error('Reschedule: mirror update failed', String(e).slice(0, 200));
    }
  }

  // Stripe metadata `datetime` feeds Invoices and the cancel-refund fallback.
  const stripeKey = Deno.env.get('RESTRICTED_API_KEY');
  if (stripeKey) {
    try {
      const query = encodeURIComponent(`metadata['acuity_appointment_id']:'${moved.id}'`);
      const search = await fetch(`https://api.stripe.com/v1/payment_intents/search?query=${query}&limit=5`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      if (search.ok) {
        const found = await search.json();
        for (const pi of found?.data ?? []) {
          await fetch(`https://api.stripe.com/v1/payment_intents/${pi.id}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ 'metadata[datetime]': moved.datetime, 'metadata[rescheduled_from]': before.datetime }),
          });
        }
      }
    } catch (e) {
      console.error('Reschedule: Stripe metadata update failed', String(e).slice(0, 200));
    }
  }

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    try {
      const emailInput = {
        firstName: moved.firstName || before.firstName || '',
        sessionType: moved.type || before.type || 'Therapy Session',
        therapistName: therapist,
        dateLabel,
        timeLabel,
        payment: { kind: 'referral' as const }, // not shown for a rescheduled session
        rescheduled: true,
      };
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Fettle <noreply@notifications.fettle.ie>',
          to: [email],
          subject: `Session moved: ${emailInput.sessionType} on ${dateLabel}`,
          html: bookingConfirmationHtml(emailInput),
          text: bookingConfirmationText(emailInput),
        }),
      });
      if (!resp.ok) console.error('Reschedule: email failed', resp.status);
    } catch (e) {
      console.error('Reschedule: email threw', String(e).slice(0, 200));
    }
  }

  if (admin) {
    await sendPushToUser(admin, userId, 'booking_updates', {
      title: 'Session moved',
      body: `${moved.type || 'Your session'}${therapist ? ` with ${therapist}` : ''} is now ${dateLabel} at ${timeLabel}.`,
      path: sessionLink(moved.id),
      data: { kind: 'session_rescheduled', appointmentId: moved.id },
    });
  }
}

// The caller's own, not-yet-started appointment, or the response to send.
async function loadOwnUpcomingAppointment(
  req: Request,
  acuityAuth: string,
  appointmentId: unknown,
): Promise<{ ok: true; appt: any; email: string; userId: string } | { ok: false; response: Response }> {
  const caller = await getCaller(req);
  if (!caller) return { ok: false, response: unauthorized(corsHeaders) };

  const id = parseInt(String(appointmentId ?? ''), 10);
  if (!id) return { ok: false, response: jsonResponse({ error: 'Missing appointmentId' }, 400) };

  const resp = await fetch(`${ACUITY_API_BASE}/appointments/${id}`, {
    headers: { 'Authorization': `Basic ${acuityAuth}`, 'Content-Type': 'application/json' },
  });
  if (!resp.ok) {
    return { ok: false, response: jsonResponse({ error: "We couldn't find that session." }, 404) };
  }
  const appt = await resp.json();
  if (!sameEmail(appt.email, caller.email)) return { ok: false, response: forbidden(corsHeaders) };
  if (appt.canceled) {
    return { ok: false, response: jsonResponse({ error: 'This session has already been cancelled.', code: 'cancelled' }, 400) };
  }
  if (hasSessionStarted(appt.datetime)) {
    return { ok: false, response: jsonResponse({ error: TOO_LATE_MESSAGE, code: 'too_late' }, 400) };
  }
  return { ok: true, appt, email: caller.email, userId: caller.userId };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const tooOld = requireSupportedAppVersion(req, corsHeaders);
  if (tooOld) return tooOld;

  const acuityUserId = Deno.env.get('ACUITY_USER_ID');
  const acuityApiKey = Deno.env.get('ACUITY_API_KEY');

  if (!acuityUserId || !acuityApiKey) {
    console.error('Missing Acuity credentials');
    return new Response(
      JSON.stringify({ error: 'Acuity credentials not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const authHeader = btoa(`${acuityUserId}:${acuityApiKey}`);

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    console.log(`Acuity API request: action=${action}`);

    switch (action) {
      case 'get-appointments': {
        // SECURITY: appointments are PHI. Require a real authenticated user and
        // ALWAYS scope the query to that user's own email. The client-supplied
        // `email` param is IGNORED — previously any holder of the public anon key
        // could pass an arbitrary email to read another client's appointments, or
        // omit it entirely to dump the whole clinic's schedule.
        const authedEmail = await getAuthenticatedEmail(req);
        if (!authedEmail) {
          console.warn('get-appointments rejected: no authenticated user');
          return new Response(
            JSON.stringify({ error: 'Unauthorized' }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Fetch appointments for the authenticated client
        // Include minDate to get future appointments (Acuity defaults to past only)
        const today = new Date();
        const minDate = new Date(today.getFullYear(), today.getMonth() - 3, 1).toISOString().split('T')[0]; // 3 months ago
        const maxDate = new Date(today.getFullYear(), today.getMonth() + 6, 0).toISOString().split('T')[0]; // 6 months ahead

        // Build base URL - fetch both active and cancelled appointments.
        // email is the authenticated user's, not the client-supplied param.
        const baseParams = `minDate=${minDate}&maxDate=${maxDate}&max=100&email=${encodeURIComponent(authedEmail)}`;
        
        // Fetch active appointments
        const activeUrl = `${ACUITY_API_BASE}/appointments?${baseParams}`;
        console.log(`Fetching active appointments from: ${activeUrl}`);
        
        const activeResponse = await fetch(activeUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!activeResponse.ok) {
          const errorText = await activeResponse.text();
          console.error(`Acuity API error: ${activeResponse.status} - ${errorText}`);
          throw new Error(`Acuity API error: ${activeResponse.status}`);
        }

        const activeAppointments = await activeResponse.json();
        console.log(`Found ${activeAppointments.length} active appointments`);
        
        // Fetch cancelled appointments separately (Acuity requires canceled=true filter)
        const cancelledUrl = `${ACUITY_API_BASE}/appointments?${baseParams}&canceled=true`;
        console.log(`Fetching cancelled appointments from: ${cancelledUrl}`);
        
        const cancelledResponse = await fetch(cancelledUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });
        
        let cancelledAppointments: unknown[] = [];
        if (cancelledResponse.ok) {
          cancelledAppointments = await cancelledResponse.json();
          console.log(`Found ${cancelledAppointments.length} cancelled appointments`);
        } else {
          console.log('Could not fetch cancelled appointments');
        }
        
        // Combine both arrays
        const allAppointments = [...activeAppointments, ...cancelledAppointments];
        console.log(`Total appointments: ${allAppointments.length}`);
        
        return new Response(JSON.stringify(allAppointments), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-appointment-types': {
        const response = await fetch(`${ACUITY_API_BASE}/appointment-types`, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Acuity API error: ${response.status}`);
        }

        const types = await response.json();
        console.log(`Found ${types.length} appointment types`);
        
        return new Response(JSON.stringify(types), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-availability': {
        const appointmentTypeId = url.searchParams.get('appointmentTypeId');
        const month = url.searchParams.get('month'); // Format: YYYY-MM
        const calendarId = url.searchParams.get('calendarId');
        
        if (!appointmentTypeId || !month) {
          return new Response(
            JSON.stringify({ error: 'Missing appointmentTypeId or month parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let availabilityUrl = `${ACUITY_API_BASE}/availability/dates?appointmentTypeID=${encodeURIComponent(appointmentTypeId)}&month=${encodeURIComponent(month)}`;
        if (calendarId) {
          availabilityUrl += `&calendarID=${encodeURIComponent(calendarId)}`;
        }

        const response = await fetch(availabilityUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Acuity API error: ${response.status}`);
        }

        const availability = await response.json();
        return new Response(JSON.stringify(availability), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-times': {
        const appointmentTypeId = url.searchParams.get('appointmentTypeId');
        const date = url.searchParams.get('date'); // Format: YYYY-MM-DD
        const calendarId = url.searchParams.get('calendarId');

        if (!appointmentTypeId || !date) {
          return new Response(
            JSON.stringify({ error: 'Missing appointmentTypeId or date parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let timesUrl = `${ACUITY_API_BASE}/availability/times?appointmentTypeID=${encodeURIComponent(appointmentTypeId)}&date=${encodeURIComponent(date)}`;
        if (calendarId) {
          timesUrl += `&calendarID=${encodeURIComponent(calendarId)}`;
        }

        const response = await fetch(timesUrl, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Acuity API error: ${response.status}`);
        }

        const times = await response.json();
        return new Response(JSON.stringify(times), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'book-appointment': {
        if (req.method !== 'POST') {
          return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Retired. It forwarded any payload to Acuity, so anyone holding the
        // anon key could book a session without paying. Nothing calls it.
        return jsonResponse({
          error: 'This booking route is no longer available. Please refresh the page or update the app.',
          code: 'gone',
        }, 410);
      }

      case 'cancel-appointment': {
        if (req.method !== 'POST') {
          return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Cancels without a refund. Clients cancel through
        // cancel-session-with-refund; this stays for free (bundle/credit)
        // sessions and is limited to the caller's own upcoming appointment.
        const { appointmentId } = await req.json();
        const own = await loadOwnUpcomingAppointment(req, authHeader, appointmentId);
        if (!own.ok) return own.response;
        console.log('Cancelling appointment:', own.appt.id);

        const response = await fetch(`${ACUITY_API_BASE}/appointments/${own.appt.id}/cancel`, {
          method: 'PUT',
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to cancel appointment: ${response.status}`);
        }

        const result = await response.json();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'reschedule': {
        // Move the caller's own upcoming session to another free time with
        // the same therapist. Replaces opening Acuity's confirmation page in a
        // new tab (Sessions.tsx), which doesn't work well in the app.
        //   POST { appointmentId, datetime, timezone? }
        //   → { success, appointment: { id, datetime, previousDatetime, type, therapist } }
        if (req.method !== 'POST') {
          return jsonResponse({ error: 'Method not allowed' }, 405);
        }
        const body = await req.json().catch(() => ({}));
        const own = await loadOwnUpcomingAppointment(req, authHeader, body?.appointmentId);
        if (!own.ok) return own.response;
        const appt = own.appt;

        const newDatetime = String(body?.datetime ?? '');
        const newMs = Date.parse(newDatetime);
        if (!newDatetime || Number.isNaN(newMs)) {
          return jsonResponse({ error: 'Please choose a new time.', code: 'invalid_datetime' }, 400);
        }
        if (newMs <= Date.now()) {
          return jsonResponse({ error: 'Please choose a time in the future.', code: 'invalid_datetime' }, 400);
        }
        if (Math.abs(newMs - Date.parse(appt.datetime)) < 60 * 1000) {
          return jsonResponse({ error: 'That is already the time of this session.', code: 'same_time' }, 400);
        }

        // Acuity checks the new slot is free (no admin override), and keeps
        // the session's therapist, certificate and payment.
        const rescheduleResp = await fetch(`${ACUITY_API_BASE}/appointments/${appt.id}/reschedule`, {
          method: 'PUT',
          headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ datetime: newDatetime, calendarID: appt.calendarID }),
        });
        if (!rescheduleResp.ok) {
          const errorText = await rescheduleResp.text();
          console.error(`Reschedule failed: ${rescheduleResp.status} - ${errorText.slice(0, 300)}`);
          const taken = /not available|no longer available|already booked|conflict/i.test(errorText);
          return jsonResponse({
            error: taken
              ? 'That time is no longer available. Please choose another.'
              : "We couldn't move your session. Please try again or contact hello@fettle.ie.",
            code: taken ? 'slot_unavailable' : 'reschedule_failed',
          }, taken ? 409 : 502);
        }
        const moved = await rescheduleResp.json();
        console.log('Appointment rescheduled:', moved.id);

        // Hub records, email and push: best-effort, the move already happened.
        await afterReschedule(own.userId, own.email, appt, moved, body?.timezone);

        return jsonResponse({
          success: true,
          appointment: {
            id: moved.id,
            datetime: moved.datetime,
            previousDatetime: appt.datetime,
            type: moved.type,
            therapist: moved.calendar,
          },
        });
      }

      case 'get-calendars': {
        const response = await fetch(`${ACUITY_API_BASE}/calendars`, {
          headers: {
            'Authorization': `Basic ${authHeader}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Acuity API error: ${response.status}`);
        }

        const calendars = await response.json();
        console.log(`Found ${calendars.length} calendars`);
        
        return new Response(JSON.stringify(calendars), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Unknown action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Error in acuity function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
