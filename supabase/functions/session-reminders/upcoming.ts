// session-reminders { mode: "upcoming" }: push reminders 24 hours and 1 hour
// before each session, to clients who have the app.
//
// Run every 15 minutes by .github/workflows/session-push-reminders.yml. Each
// (appointment, 24h|1h) pair is pushed once (public.push_sends), so overlapping
// runs and the 15-minute slack never repeat a reminder. A session booked less
// than an hour before it starts gets only the 1-hour reminder.
//
// Push only: Acuity already emails its own appointment reminders. This adds
// the app notification next to that email; it doesn't replace it.
import { formatSessionWhen } from "../_shared/bookingConfirmationEmail.ts";
import { markPushedOnce, sendPushToUser, sessionLink } from "../_shared/push.ts";

const ACUITY_API_BASE = "https://acuityscheduling.com/api/v1";
const HOUR_MS = 60 * 60 * 1000;

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export interface UpcomingResult {
  appUsers: number;
  appointmentsChecked: number;
  sent24h: number;
  sent1h: number;
}

export async function runUpcomingReminders(
  admin: SupabaseAdmin,
  acuityAuth: string,
  now: Date = new Date(),
): Promise<UpcomingResult> {
  const result: UpcomingResult = { appUsers: 0, appointmentsChecked: 0, sent24h: 0, sent1h: 0 };

  // Only clients with the app installed can get a push.
  const { data: tokenRows, error: tokenError } = await admin.from("device_tokens").select("user_id");
  if (tokenError) throw new Error(`device_tokens: ${tokenError.message}`);
  const userIds = [...new Set((tokenRows ?? []).map((r: { user_id: string }) => r.user_id))];
  result.appUsers = userIds.length;
  if (userIds.length === 0) return result;

  const byEmail = new Map<string, { userId: string; timezone: string | null }>();
  for (let i = 0; i < userIds.length; i += 200) {
    const { data: profiles } = await admin
      .from("profiles").select("user_id, email, timezone").in("user_id", userIds.slice(i, i + 200));
    for (const p of profiles ?? []) {
      if (p.email) byEmail.set(String(p.email).trim().toLowerCase(), { userId: p.user_id, timezone: p.timezone });
    }
  }

  // Every appointment starting in the next 24 hours (date range is inclusive).
  const minDate = now.toISOString().slice(0, 10);
  const maxDate = new Date(now.getTime() + 25 * HOUR_MS).toISOString().slice(0, 10);
  const resp = await fetch(
    `${ACUITY_API_BASE}/appointments?minDate=${minDate}&maxDate=${maxDate}&max=1000`,
    { headers: { Authorization: `Basic ${acuityAuth}`, "Content-Type": "application/json" } },
  );
  if (!resp.ok) throw new Error(`Acuity appointments: ${resp.status}`);
  const appointments = await resp.json();
  if (!Array.isArray(appointments)) throw new Error("Acuity appointments: unexpected response");

  for (const appt of appointments) {
    if (appt?.canceled === true) continue;
    const until = Date.parse(appt?.datetime ?? "") - now.getTime();
    if (!(until > 0 && until <= 24 * HOUR_MS)) continue;
    const client = byEmail.get(String(appt.email ?? "").trim().toLowerCase());
    if (!client) continue;
    result.appointmentsChecked++;

    const isHour = until <= HOUR_MS;
    const kind = isHour ? "session_reminder_1h" : "session_reminder_24h";
    if (!(await markPushedOnce(admin, client.userId, kind, String(appt.id)))) continue;

    const { dateLabel, timeLabel } = formatSessionWhen(appt.datetime, client.timezone);
    const who = appt.calendar ? ` with ${String(appt.calendar).trim()}` : "";
    const delivered = await sendPushToUser(admin, client.userId, "session_reminders", {
      title: isHour ? "Your session starts soon" : "Session reminder",
      body: isHour
        ? `${appt.type || "Your session"}${who} starts at ${timeLabel}. Tap to join.`
        : `${appt.type || "Your session"}${who}, ${dateLabel} at ${timeLabel}.`,
      path: sessionLink(appt.id),
      data: { kind, appointmentId: appt.id },
    });
    if (delivered > 0) {
      if (isHour) result.sent1h++;
      else result.sent24h++;
    }
  }
  return result;
}
