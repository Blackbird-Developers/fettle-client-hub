# Live chat

Visitors on fettle.ie chat through a floating widget. Staff answer from **Admin → Inbox** (`/admin/inbox`) in the hub. Everything runs on the hub's Supabase project; there is no third-party chat service and no AI.

Status (20 Nov 2026): **live.** The backend is deployed, the Inbox is on my.fettle.ie, and since 20 Nov the widget is on every page of fettle.ie (WordPress Code Snippet #64) except the two booking pages. The hidden test page https://fettle.ie/chat-test/ still exists.

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

## Working hours

The widget has a working-hours table in Irish time (`HOURS` at the top of `chat-widget.html`; Monday to Friday, 9:00 to 17:00, as confirmed by Fettle on 20 Nov 2026).

- **In hours:** the visitor chats straight away and is asked for an email after their first message.
- **Out of hours:** the widget shows a form instead: first name, last name, phone number, optional email and a message. The conversation is saved with `started_offline = true` and a system note, "we will respond to you as soon as we can". The Inbox marks it "Out of hours" and shows the phone number.

The hours live in the widget, not the database, so changing them means redeploying the widget.

## Returning visitors

A visitor's conversation stays in their browser. When they come back, days or weeks later, they see the whole history, and sending a message reopens the conversation in the Inbox with everything above it.

That only works in the same browser: visitors aren't logged in, so a different device starts a new conversation. To connect them, the Inbox's visitor panel lists other conversations where the same email or phone number was typed. The list is labelled "Same email/phone typed — not verified", because anyone can type someone else's details: staff must not treat it as proof of who they are talking to.

## Alerts for staff

- **Email:** every visitor message emails `CHAT_ALERT_EMAILS` with the message and a button that opens that chat in the Inbox (`/admin/inbox?c=<id>`). A message sent within 2 minutes of the previous one in the same chat doesn't send another email, so a visitor writing three lines in a row is one email. At most 30 alert emails go out in any hour across all chats (`ALERT_EMAILS_PER_HOUR`), because they share the Resend account with booking emails; past that, alerts appear under the bell only, and the 30th email says so. The email has no reply-to and marks the visitor's contact details as unverified: reply in the Inbox.
- **Desktop notifications:** switched on per browser from the top of the Inbox list ("Turn on desktop notifications", with a "Send a test" link afterwards). They appear for visitor messages while the hub is open in a tab, on any admin page, including when the tab is in the background. Clicking one opens that chat. They can't appear when no hub tab is open; that would need web push.
- **In the hub:** a sound, the unread badge on Inbox in the sidebar, the admin bell, and a toast on other admin pages.

## Protections

- Only `https://fettle.ie` and `https://www.fettle.ie` may call `chat-visitor` (plus `CHAT_EXTRA_ORIGINS`).
- A conversation can only be read or written with the secret created for it. The database stores a SHA-256 of the secret in `chat_conversation_secrets`, which only the service role can read.
- The visitor's IP is never stored. An HMAC of it (keyed with `CHAT_IP_HASH_SECRET`, or the service-role key when that isn't set) is kept for the new-chat limit and blanked after a day.
- Limits: 2,000 characters a message, 120 requests a minute per IP, 5 new chats an hour per IP, 15 messages a minute per chat.
- Function logs hold error codes and counts only, never names or message text.
- `anon` has no access to any chat table.

## Deploying

Live's migration history has been tracked since 5 Nov 2026, so `supabase db push` works. Add schema changes as **new** migration files; don't edit one that has been applied.

1. **Database:** paste `supabase/migrations/20261119120000_live_chat.sql` into the Supabase SQL editor and run it. It is safe to re-run.
2. **Realtime:** in Supabase → Database → Publications, check `supabase_realtime` now lists `chat_messages` and `chat_conversations` (the migration adds them).
3. **Function:** `supabase functions deploy chat-visitor --project-ref gxeoillrmjezpehmcvrh`
4. **Secrets (optional):**
   - `CHAT_ALERT_EMAILS`: comma-separated addresses emailed about visitor messages. When it is unset the email goes to alex@fettle.ie; set it to `off` to send none. Every alert also goes under the admin bell.
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
