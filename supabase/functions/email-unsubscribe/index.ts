// email-unsubscribe — adds an address to email_suppressions so it gets no
// more marketing email (the portal-adoption emails today). Two callers:
//   - the hub's /unsubscribe page, after the person clicks the confirm
//     button: POST with JSON { e, t }
//   - the inbox's one-click unsubscribe (List-Unsubscribe-Post, RFC 8058):
//     POST to ?e=…&t=… with a form body
// GET does nothing on purpose: link scanners open links in emails, and that
// must not unsubscribe anyone.
//
// No JWT (config.toml): the signed token in the link (EMAIL_UNSUBSCRIBE_SECRET,
// see ../_shared/unsubscribe.ts) proves the request came from our email.
//
// DEPLOY: imports ../_shared, so deploy with the Supabase CLI
// (`supabase functions deploy email-unsubscribe`).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { decodeEmailParam, verifyUnsubscribeToken } from "../_shared/unsubscribe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const secret = Deno.env.get("EMAIL_UNSUBSCRIBE_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !supabaseUrl || !serviceKey) {
      console.error("email-unsubscribe: missing env");
      return json({ error: "Function not fully configured" }, 500);
    }

    // Query string for one-click; JSON body from the hub page.
    const url = new URL(req.url);
    let e = url.searchParams.get("e");
    let t = url.searchParams.get("t");
    if (!e || !t) {
      const body = await req.json().catch(() => ({}));
      e = typeof body?.e === "string" ? body.e : null;
      t = typeof body?.t === "string" ? body.t : null;
    }
    const email = e ? decodeEmailParam(e)?.trim().toLowerCase() : null;
    if (!email || !t || !(await verifyUnsubscribeToken(email, t, secret))) {
      return json({ error: "invalid_link" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    // An existing bounce/complaint row is kept as it is.
    const { error } = await admin
      .from("email_suppressions")
      .upsert({ email, reason: "unsubscribed" }, { onConflict: "email", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    console.log("email-unsubscribe recorded");
    return json({ ok: true });
  } catch (error) {
    console.error("email-unsubscribe failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Internal error" }, 500);
  }
});
