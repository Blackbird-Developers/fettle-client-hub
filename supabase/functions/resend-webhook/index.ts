// resend-webhook — records what happened to each portal-adoption email
// (delivered, opened, clicked, bounced, complained) on its email_sends row,
// and suppresses addresses that bounce or report spam.
//
// Resend calls this server-to-server and can't present a Supabase JWT;
// config.toml disables gateway JWT verification, and every request must carry
// a valid Svix signature made with RESEND_WEBHOOK_SECRET (the "whsec_…"
// signing secret shown when the webhook is added in Resend).
//
// Events for other emails (booking confirmations, reminders, …) have no
// email_sends row and are acknowledged and ignored.
//
// PRIVACY: logs carry event types and counts only.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { eventEffect, verifySvixSignature } from "./logic.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !supabaseUrl || !serviceKey) {
      console.error("resend-webhook: missing env");
      return json({ error: "Function not fully configured" }, 500);
    }

    const body = await req.text();
    const valid = await verifySvixSignature(
      secret,
      {
        id: req.headers.get("svix-id"),
        timestamp: req.headers.get("svix-timestamp"),
        signature: req.headers.get("svix-signature"),
      },
      body,
      Math.floor(Date.now() / 1000),
    );
    if (!valid) return json({ error: "Invalid signature" }, 401);

    const event = JSON.parse(body);
    const type = String(event?.type ?? "");
    const messageId = event?.data?.email_id;
    const at = typeof event?.created_at === "string" ? event.created_at : new Date().toISOString();
    if (!messageId) return json({ ignored: true });

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: row, error } = await admin
      .from("email_sends")
      .select("id, email, delivered_at, opened_at, first_clicked_at, click_count, bounced_at, complained_at")
      .eq("resend_message_id", messageId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read email_sends: ${error.message}`);
    if (!row) return json({ ignored: true });

    const effect = eventEffect(type, at, row);
    if (Object.keys(effect.update).length > 0) {
      const { error: updateError } = await admin.from("email_sends").update(effect.update).eq("id", row.id);
      if (updateError) throw new Error(`Failed to update email_sends: ${updateError.message}`);
    }
    if (effect.suppress) {
      const { error: suppressError } = await admin
        .from("email_suppressions")
        .upsert({ email: row.email, reason: effect.suppress }, { onConflict: "email", ignoreDuplicates: true });
      if (suppressError) throw new Error(`Failed to suppress: ${suppressError.message}`);
    }

    console.log("resend-webhook recorded", { type, suppressed: effect.suppress });
    return json({ ok: true });
  } catch (error) {
    // A 500 makes Resend retry later, which is what we want for a DB hiccup.
    console.error("resend-webhook failed:", error instanceof Error ? error.message : "unknown");
    return json({ error: "Internal error" }, 500);
  }
});
