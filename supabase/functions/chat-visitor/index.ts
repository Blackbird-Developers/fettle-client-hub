// chat-visitor — the visitor's side of the live chat (docs/LIVE_CHAT.md).
// The widget on fettle.ie calls it to start a conversation, send a message,
// read the conversation and save the visitor's name and email. Staff don't
// use it: the admin Inbox reads and writes the chat tables directly.
//
// Public, no JWT (config.toml): visitors aren't logged in. Protections:
//   - only listed origins (fettle.ie + CHAT_EXTRA_ORIGINS)
//   - a conversation can only be read or written with the secret created
//     for it at "start"; the database keeps a SHA-256 of it, never the secret
//   - body size and message length caps, a per-IP request limit, at most
//     STARTS_PER_HOUR new chats per IP and MESSAGES_PER_MINUTE per chat
//   - the visitor's IP is only kept as an HMAC (keyed with
//     CHAT_IP_HASH_SECRET, else the service-role key), for the new-chat
//     limit, and is blanked after a day
//   - logs carry counts and error codes only, never names or message text
//
// Body is JSON sent as text/plain (no CORS preflight). Actions:
//   start     { body, client_id, name?, email?, phone?, offline?, page_url?, page_title?, referrer? }
//   send      { conversation_id, secret, body, client_id }
//   history   { conversation_id, secret, read? }
//   identify  { conversation_id, secret, name?, email?, phone? }
// "offline" is set by the widget's out-of-hours form: the chat is marked
// and gets a system note saying staff will reply as soon as they can.
//
// Staff are told about every visitor message (bar quick follow-ups, see
// ALERT_GAP_MS) under the admin bell and by email, with a link that opens
// that chat in the Inbox. The email goes to CHAT_ALERT_EMAILS
// (comma-separated), or to DEFAULT_ALERT_EMAILS when that isn't set;
// CHAT_ALERT_EMAILS=off sends none. At most ALERT_EMAILS_PER_HOUR emails go
// out in any hour across all chats (they share the Resend account with
// booking emails); past that, alerts are bell-only. The email has no
// reply-to: the visitor's address is unverified, so staff reply in the Inbox.
//
// DEPLOY: `supabase functions deploy chat-visitor` (needs the
// [functions.chat-visitor] verify_jwt = false entry in config.toml).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  HISTORY_LIMIT,
  IP_HASH_KEEP_MS,
  MAX_BODY_BYTES,
  MESSAGES_PER_MINUTE,
  NOTIFICATION_TITLE_MAX,
  OFFLINE_NOTE,
  REQUESTS_PER_MINUTE,
  RateLimiter,
  STARTS_PER_HOUR,
  alertEmail,
  alertEmailDecision,
  alertRecipients,
  hmacSha256Hex,
  allowedOrigins,
  parseRequest,
  randomHex,
  safeEqual,
  sha256Hex,
  shouldAlert,
} from "./logic.ts";

const ORIGINS = allowedOrigins(Deno.env.get("CHAT_EXTRA_ORIGINS"));
const limiter = new RateLimiter(REQUESTS_PER_MINUTE, 60_000);
const INBOX_URL = `${(Deno.env.get("SITE_URL") ?? "https://my.fettle.ie").replace(/\/+$/, "")}/admin/inbox`;

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const MESSAGE_COLUMNS = "id, created_at, sender, sender_name, body, client_id";

interface ConversationRow {
  id: string;
  status: string;
  realtime_topic: string;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  page_url: string | null;
  last_message_at: string | null;
}

// The conversation, if the secret is the one created for it.
async function authorise(
  admin: SupabaseClient,
  conversationId: string,
  secret: string,
): Promise<ConversationRow | null> {
  const { data: secretRow, error: secretError } = await admin
    .from("chat_conversation_secrets")
    .select("secret_hash")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (secretError) throw new Error(secretError.message);
  if (!secretRow || !safeEqual(secretRow.secret_hash, await sha256Hex(secret))) return null;

  const { data, error } = await admin
    .from("chat_conversations")
    .select("id, status, realtime_topic, visitor_name, visitor_email, visitor_phone, page_url, last_message_at")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ConversationRow | null;
}

async function loadMessages(admin: SupabaseClient, conversationId: string) {
  const { data, error } = await admin
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) throw new Error(error.message);
  return (data ?? []).reverse();
}

// Bell notification plus an email. Never throws: a failed alert must not
// stop the visitor's message from being saved.
async function alertStaff(
  admin: SupabaseClient,
  input: {
    isNew: boolean;
    offline?: boolean;
    conversationId: string;
    visitorName: string | null;
    visitorEmail: string | null;
    visitorPhone: string | null;
    pageUrl: string | null;
    body: string;
  },
) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const to = alertRecipients(Deno.env.get("CHAT_ALERT_EMAILS"));
  const wantsEmail = !!apiKey && to.length > 0;

  // The hourly cap is counted from the bell rows themselves (details.emailed),
  // so it holds across function instances without another table. Two alerts
  // at the same moment can both pass the check; the cap may overshoot by a
  // few under a burst, which is fine for its purpose.
  let decision = { send: false, last: false };
  if (wantsEmail) {
    let sentLastHour: number | null = null;
    try {
      const { count, error } = await admin
        .from("admin_notifications")
        .select("id", { count: "exact", head: true })
        .eq("kind", "live_chat")
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .eq("details->>emailed", "true");
      if (error) console.error("chat-visitor: alert count failed:", error.code ?? "unknown");
      else sentLastHour = count ?? 0;
    } catch {
      console.error("chat-visitor: alert count failed");
    }
    decision = alertEmailDecision(sentLastHour);
    if (!decision.send && sentLastHour !== null) console.log("chat-visitor: alert email skipped, hourly cap reached");
  }

  const mail = alertEmail({
    ...input,
    inboxUrl: `${INBOX_URL}?c=${input.conversationId}`,
    lastThisHour: decision.last,
  });
  let recorded = false;
  try {
    const { error } = await admin.from("admin_notifications").insert({
      kind: "live_chat",
      client_email: input.visitorEmail,
      client_name: input.visitorName,
      // The subject can carry a long visitor name or email; the column
      // takes 200 characters, and a failed insert would lose the alert.
      title: mail.subject.slice(0, NOTIFICATION_TITLE_MAX),
      body: input.body.slice(0, 300),
      details: {
        conversation_id: input.conversationId,
        page_url: input.pageUrl,
        phone: input.visitorPhone,
        offline: input.offline === true,
        emailed: decision.send,
      },
    });
    if (error) console.error("chat-visitor: notification failed:", error.code ?? "unknown");
    else recorded = true;
  } catch {
    console.error("chat-visitor: notification failed");
  }

  // No bell row means this email wouldn't be counted towards the cap, so
  // it isn't sent either.
  if (!decision.send || !recorded) return;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Fettle Hub <noreply@notifications.fettle.ie>",
        to,
        subject: mail.subject,
        html: mail.html,
      }),
    });
    if (!resp.ok) console.error("chat-visitor: alert email failed:", resp.status);
  } catch {
    console.error("chat-visitor: alert email failed");
  }
}

serve(async (req) => {
  const origin = (req.headers.get("origin") ?? "").replace(/\/+$/, "");
  if (!ORIGINS.has(origin)) return new Response(null, { status: 403 });
  const cors = corsHeaders(origin);
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method_not_allowed" });

  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { error: "too_large" });

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return reply(400, { error: "invalid_json" });
    }
    const parsed = parseRequest(json);
    if (!parsed.ok) return reply(400, { error: parsed.error });
    const request = parsed.request;

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (!limiter.take(ip, Date.now())) return reply(429, { error: "rate_limited" });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("chat-visitor: missing env");
      return reply(500, { error: "not_configured" });
    }
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    if (request.action === "start") {
      const ipHash = await hmacSha256Hex(Deno.env.get("CHAT_IP_HASH_SECRET") || serviceKey, `fettle-chat:${ip}`);

      // Hashed IPs older than a day are no longer needed for the limit below.
      const { error: blankError } = await admin
        .from("chat_conversation_secrets")
        .update({ ip_hash: null })
        .lt("created_at", new Date(Date.now() - IP_HASH_KEEP_MS).toISOString())
        .not("ip_hash", "is", null);
      if (blankError) console.error("chat-visitor: ip hash clean-up failed:", blankError.code ?? "unknown");

      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error: countError } = await admin
        .from("chat_conversation_secrets")
        .select("conversation_id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", hourAgo);
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) >= STARTS_PER_HOUR) return reply(429, { error: "rate_limited" });

      const secret = randomHex(24);
      const topic = `chat-${randomHex(20)}`;
      const { data: conversation, error: createError } = await admin
        .from("chat_conversations")
        .insert({
          realtime_topic: topic,
          visitor_name: request.name,
          visitor_email: request.email,
          visitor_phone: request.phone,
          started_offline: request.offline,
          page_url: request.pageUrl,
          page_title: request.pageTitle,
          referrer: request.referrer,
          user_agent: (req.headers.get("user-agent") ?? "").slice(0, 400) || null,
        })
        .select("id")
        .single();
      if (createError) throw new Error(createError.message);

      const { error: secretError } = await admin.from("chat_conversation_secrets").insert({
        conversation_id: conversation.id,
        secret_hash: await sha256Hex(secret),
        ip_hash: ipHash,
      });
      if (secretError) {
        await admin.from("chat_conversations").delete().eq("id", conversation.id);
        throw new Error(secretError.message);
      }

      const { error: messageError } = await admin.from("chat_messages").insert({
        conversation_id: conversation.id,
        sender: "visitor",
        body: request.body,
        client_id: request.clientId,
      });
      if (messageError) {
        await admin.from("chat_conversations").delete().eq("id", conversation.id);
        throw new Error(messageError.message);
      }

      if (request.offline) {
        const { error: noteError } = await admin.from("chat_messages").insert({
          conversation_id: conversation.id,
          sender: "system",
          body: OFFLINE_NOTE,
        });
        if (noteError) console.error("chat-visitor: offline note failed:", noteError.code ?? "unknown");
      }

      await alertStaff(admin, {
        isNew: true,
        offline: request.offline,
        conversationId: conversation.id,
        visitorName: request.name,
        visitorEmail: request.email,
        visitorPhone: request.phone,
        pageUrl: request.pageUrl,
        body: request.body,
      });

      return reply(200, {
        conversation_id: conversation.id,
        secret,
        topic,
        status: "open",
        has_email: !!request.email,
        has_contact: !!(request.email || request.phone),
        messages: await loadMessages(admin, conversation.id),
      });
    }

    const conversation = await authorise(admin, request.conversationId, request.secret);
    if (!conversation) return reply(404, { error: "not_found" });

    if (request.action === "send") {
      const minuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { count, error: countError } = await admin
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conversation.id)
        .eq("sender", "visitor")
        .gte("created_at", minuteAgo);
      if (countError) throw new Error(countError.message);
      if ((count ?? 0) >= MESSAGES_PER_MINUTE) return reply(429, { error: "rate_limited" });

      const { error: insertError } = await admin.from("chat_messages").insert({
        conversation_id: conversation.id,
        sender: "visitor",
        body: request.body,
        client_id: request.clientId,
      });
      // 23505 = this client_id is already stored: a resend, not an error.
      if (insertError && insertError.code !== "23505") throw new Error(insertError.message);

      if (!insertError && shouldAlert(conversation.last_message_at, Date.now())) {
        await alertStaff(admin, {
          isNew: false,
          conversationId: conversation.id,
          visitorName: conversation.visitor_name,
          visitorEmail: conversation.visitor_email,
          visitorPhone: conversation.visitor_phone,
          pageUrl: conversation.page_url,
          body: request.body,
        });
      }
    }

    if (request.action === "identify") {
      const changes: Record<string, string> = {};
      if (request.name) changes.visitor_name = request.name;
      if (request.email) changes.visitor_email = request.email;
      if (request.phone) changes.visitor_phone = request.phone;
      const { error } = await admin.from("chat_conversations").update(changes).eq("id", conversation.id);
      if (error) throw new Error(error.message);
      if (request.email) conversation.visitor_email = request.email;
      if (request.phone) conversation.visitor_phone = request.phone;
    }

    if (request.action === "history" && request.markRead) {
      const { error } = await admin
        .from("chat_conversations")
        .update({ visitor_last_read_at: new Date().toISOString() })
        .eq("id", conversation.id);
      if (error) console.error("chat-visitor: mark read failed:", error.code ?? "unknown");
    }

    // Every action answers with the conversation as it now stands. A visitor
    // message reopens a closed chat (database trigger).
    return reply(200, {
      conversation_id: conversation.id,
      topic: conversation.realtime_topic,
      status: request.action === "send" ? "open" : conversation.status,
      has_email: !!conversation.visitor_email,
      has_contact: !!(conversation.visitor_email || conversation.visitor_phone),
      messages: await loadMessages(admin, conversation.id),
    });
  } catch (error) {
    console.error("chat-visitor failed:", error instanceof Error ? error.message : "unknown");
    return reply(500, { error: "internal_error" });
  }
});
