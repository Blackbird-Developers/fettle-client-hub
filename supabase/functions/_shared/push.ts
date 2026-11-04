// Push notifications to the MyFettle app through the Expo Push API.
//
// Sent next to the emails the existing functions already send; never instead
// of them. Every helper here is best-effort: it never throws, so a push
// problem can't fail a booking, a payment or the email.
//
// Tokens live in public.device_tokens (registered by the app through
// register_device_token). Tokens Expo reports as DeviceNotRegistered (app
// uninstalled, or notifications revoked) are deleted.
//
// Every message carries a deep link in data.url, e.g. myfettle://sessions/123.
// The app opens it when the notification is tapped.
//
// Optional secret EXPO_ACCESS_TOKEN: needed only if "enhanced push security"
// is switched on for the project in Expo.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const APP_SCHEME = "myfettle://";

export type PushPreference =
  | "session_reminders"
  | "booking_updates"
  | "payment_reminders"
  | "credit_updates";

export interface PushMessage {
  title: string;
  body: string;
  /** Path inside the app, e.g. "sessions/123" → myfettle://sessions/123 */
  path: string;
  data?: Record<string, unknown>;
}

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

const log = (step: string, details?: unknown) =>
  console.log(`[PUSH] ${step}${details ? ` - ${JSON.stringify(details)}` : ""}`);

export function deepLink(path: string): string {
  return APP_SCHEME + path.replace(/^\/+/, "");
}

export const sessionLink = (appointmentId: string | number) => `sessions/${appointmentId}`;

// The user's id for a client email (profiles.email), or null.
export async function userIdForEmail(admin: SupabaseAdmin, email: string): Promise<string | null> {
  const trimmed = (email ?? "").trim();
  if (!trimmed) return null;
  try {
    for (const candidate of new Set([trimmed, trimmed.toLowerCase()])) {
      const { data } = await admin.from("profiles").select("user_id").eq("email", candidate).limit(1);
      if (data && data.length > 0) return data[0].user_id as string;
    }
  } catch (e) {
    log("profile lookup failed", { error: String(e).slice(0, 200) });
  }
  return null;
}

async function wantsPush(admin: SupabaseAdmin, userId: string, pref: PushPreference): Promise<boolean> {
  try {
    const { data } = await admin
      .from("profiles").select("notification_preferences").eq("user_id", userId).maybeSingle();
    const prefs = (data?.notification_preferences ?? {}) as Record<string, unknown>;
    return prefs[pref] !== false;
  } catch (_e) {
    return true; // column missing (migration not applied yet): default on
  }
}

// Push to every device of one user. Returns how many devices accepted it.
export async function sendPushToUser(
  admin: SupabaseAdmin,
  userId: string,
  pref: PushPreference,
  message: PushMessage,
): Promise<number> {
  try {
    if (!(await wantsPush(admin, userId, pref))) return 0;
    const { data: rows, error } = await admin
      .from("device_tokens").select("expo_push_token").eq("user_id", userId);
    if (error || !rows || rows.length === 0) return 0;
    const tokens: string[] = rows.map((r: { expo_push_token: string }) => r.expo_push_token);
    return await sendToTokens(admin, tokens, message);
  } catch (e) {
    log("sendPushToUser failed", { error: String(e).slice(0, 200) });
    return 0;
  }
}

// Same, addressed by the client's email (what Acuity knows them by).
export async function sendPushToEmail(
  admin: SupabaseAdmin,
  email: string,
  pref: PushPreference,
  message: PushMessage,
): Promise<number> {
  const userId = await userIdForEmail(admin, email);
  if (!userId) return 0;
  return await sendPushToUser(admin, userId, pref, message);
}

async function sendToTokens(admin: SupabaseAdmin, tokens: string[], message: PushMessage): Promise<number> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let delivered = 0;
  // Expo accepts up to 100 messages per request.
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    const payload = batch.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      sound: "default",
      data: { ...(message.data ?? {}), url: deepLink(message.path) },
    }));
    const resp = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(payload) });
    if (!resp.ok) {
      log("Expo push request failed", { status: resp.status, body: (await resp.text()).slice(0, 200) });
      continue;
    }
    const result = await resp.json();
    const tickets: Array<{ status: string; details?: { error?: string } }> = result?.data ?? [];
    const dead: string[] = [];
    tickets.forEach((t, idx) => {
      if (t.status === "ok") delivered++;
      else if (t.details?.error === "DeviceNotRegistered") dead.push(batch[idx]);
    });
    if (dead.length > 0) {
      await admin.from("device_tokens").delete().in("expo_push_token", dead);
      log("Removed tokens Expo reported as not registered", { count: dead.length });
    }
  }
  return delivered;
}

// Record that a reminder was pushed. False if it had already been recorded
// (so the caller skips it), true if this call recorded it.
export async function markPushedOnce(
  admin: SupabaseAdmin,
  userId: string,
  kind: string,
  ref: string,
): Promise<boolean> {
  try {
    const { error } = await admin.from("push_sends").insert({ user_id: userId, kind, ref });
    if (!error) return true;
    if (error.code === "23505") return false; // already sent
    log("push_sends insert failed", { error: error.message });
    return false; // can't record it: skip rather than risk repeats every run
  } catch (_e) {
    return false;
  }
}
