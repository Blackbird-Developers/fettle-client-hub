// Caller checks shared by the edge functions. Every function runs with
// verify_jwt = false (see config.toml), so each one must call one of these
// itself. The auth model of every function is listed in docs/edge-function-auth.md.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { isServiceRoleRequest } from "./serviceAuth.ts";

export { isServiceRoleRequest };

export interface Caller {
  userId: string;
  email: string;
}

function bearerToken(req: Request): string {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

// The signed-in user behind the request's JWT, or null for the anon key, the
// service-role key, an expired token or no token at all.
export async function getCaller(req: Request): Promise<Caller | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const token = bearerToken(req);
  if (!supabaseUrl || !anonKey || !token || token === anonKey) return null;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return null;
  try {
    const { data, error } = await createClient(supabaseUrl, anonKey).auth.getUser(token);
    if (error || !data.user?.email) return null;
    return { userId: data.user.id, email: data.user.email };
  } catch (_e) {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Scheduled jobs (GitHub Actions) send `x-cron-secret: <REMINDER_CRON_SECRET>`.
export function hasCronSecret(req: Request): boolean {
  const secret = Deno.env.get("REMINDER_CRON_SECRET");
  if (!secret) return false;
  return constantTimeEqual(req.headers.get("x-cron-secret") ?? "", secret);
}

// Machine callers: our own functions (service-role key) or a scheduled job.
export function isMachineRequest(req: Request): boolean {
  return isServiceRoleRequest(req) || hasCronSecret(req);
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x !== "" && x === y;
}

export function unauthorized(corsHeaders: Record<string, string>, message = "Please sign in again."): Response {
  return new Response(JSON.stringify({ error: message, code: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function forbidden(corsHeaders: Record<string, string>, message = "This doesn't belong to your account."): Response {
  return new Response(JSON.stringify({ error: message, code: "forbidden" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
