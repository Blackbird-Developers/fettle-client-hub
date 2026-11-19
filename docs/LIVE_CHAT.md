# Live chat

Visitors on fettle.ie chat through a floating widget. Staff answer from **Admin → Inbox** (`/admin/inbox`) in the hub. Everything runs on the hub's Supabase project; there is no third-party chat service and no AI.

Status (19 Nov 2026): built on branch `feature/live-chat`. **Not deployed.** The widget is only on the hidden test page https://fettle.ie/chat-test/ (noindex, in no menu).

## How it fits together

| Piece | Where | Notes |
|---|---|---|
| Widget | WordPress (`chat/chat-widget.html` in the website folder) | Shadow DOM, no login. Keeps the conversation id and secret in the visitor's `localStorage` (`fettleChat.v1`). |
| `chat-visitor` edge function | `supabase/functions/chat-visitor` | The only thing the widget talks to. Public; see "Protections". |
| Tables | migration `20261119120000_live_chat.sql` | `chat_conversations`, `chat_messages`, `chat_conversation_secrets`. |
| Inbox | `src/components/admin/inbox`, `src/hooks/useChatInbox.ts`, `src/lib/chat.ts` | Reads and writes the tables directly; RLS limits it to admins. |

**Visitor → staff:** the widget posts to `chat-visitor`, which inserts the message with the service role. The Inbox gets it through Realtime `postgres_changes` (admins only, via RLS), with a 20–30 second refetch as a fallback.

**Staff → visitor:** the Inbox inserts the reply into `chat_messages`, then sends a `message` broadcast on the conversation's own Realtime channel (`chat_conversations.realtime_topic`, a random name). The widget hears it and fetches the conversation from `chat-visitor`. The broadcast carries no message text. If the socket is blocked, the widget polls instead (every 5 seconds while open).

**Typing indicators** are `typing` broadcasts on the same channel, both ways.

Database triggers keep each conversation's summary current (last message, unread count), reopen a closed chat when the visitor writes again, assign an unassigned chat to the first admin who replies, and force messages sent from a staff session to be `admin` messages from that person.

## Protections

- Only `https://fettle.ie` and `https://www.fettle.ie` may call `chat-visitor` (plus `CHAT_EXTRA_ORIGINS`).
- A conversation can only be read or written with the secret created for it. The database stores a SHA-256 of the secret in `chat_conversation_secrets`, which only the service role can read.
- Limits: 2,000 characters a message, 120 requests a minute per IP, 5 new chats an hour per IP, 15 messages a minute per chat.
- Function logs hold error codes and counts only, never names or message text.
- `anon` has no access to any chat table.

## Deploying

Live's migration history is empty, so do **not** use `supabase db push` (see `backend-todo.md`).

1. **Database:** paste `supabase/migrations/20261119120000_live_chat.sql` into the Supabase SQL editor and run it. It is safe to re-run.
2. **Realtime:** in Supabase → Database → Publications, check `supabase_realtime` now lists `chat_messages` and `chat_conversations` (the migration adds them).
3. **Function:** `supabase functions deploy chat-visitor --project-ref gxeoillrmjezpehmcvrh`
4. **Secrets (optional):**
   - `CHAT_ALERT_EMAILS`: comma-separated addresses emailed about a new chat, or a visitor message after 30 quiet minutes. No email is sent while it is unset. Every alert also goes under the admin bell.
   - `CHAT_EXTRA_ORIGINS`: extra allowed origins, e.g. a staging site.
5. **Frontend:** merge the branch; Vercel deploys it. Until step 1 is done the Inbox shows "Not set up yet".

## Testing

1. Open https://fettle.ie/chat-test/ and send a message.
2. Sign in to the hub as an admin, open **Inbox**, and reply.
3. Check both directions arrive without refreshing, the typing dots show, and the sidebar badge counts unread chats.

`?chatmock=1` on the test page runs the widget against a fake backend, for checking the design without sending anything.

## Not built yet

- Only admins can use the Inbox; there is no separate support role.
- No file attachments, canned replies or business-hours message.
- No automatic deletion of old conversations. Decide a retention period before going site-wide.
- Emailing the visitor a reply they missed (their email is collected, but replies are only shown in the widget).
