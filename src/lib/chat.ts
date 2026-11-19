// Live chat (docs/LIVE_CHAT.md): types and pure helpers for the admin Inbox.

export type ChatStatus = "open" | "closed";
export type ChatSender = "visitor" | "admin" | "system";

export interface ChatConversation {
  id: string;
  created_at: string;
  updated_at: string;
  status: ChatStatus;
  realtime_topic: string;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  /** Started outside working hours, from the widget's "leave your details" form. */
  started_offline: boolean;
  page_url: string | null;
  page_title: string | null;
  referrer: string | null;
  user_agent: string | null;
  assigned_to: string | null;
  assigned_to_email: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_sender: string | null;
  admin_unread_count: number;
  visitor_last_read_at: string | null;
  closed_at: string | null;
  closed_by_email: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  created_at: string;
  sender: ChatSender;
  sender_user_id: string | null;
  sender_name: string | null;
  body: string;
  client_id: string | null;
}

export type ChatAssigneeFilter = "all" | "mine" | "unassigned";

export interface ChatFilters {
  status: ChatStatus | "all";
  assignee: ChatAssigneeFilter;
  search: string;
}

export const DEFAULT_CHAT_FILTERS: ChatFilters = { status: "open", assignee: "all", search: "" };

/** What to call the visitor: their name, their email, or "Visitor 3F2B". */
export function visitorLabel(conversation: Pick<ChatConversation, "id" | "visitor_name" | "visitor_email">): string {
  return (
    conversation.visitor_name?.trim() ||
    conversation.visitor_email?.trim() ||
    `Visitor ${conversation.id.slice(0, 4).toUpperCase()}`
  );
}

/** One or two letters for the avatar. */
export function visitorInitials(conversation: Pick<ChatConversation, "id" | "visitor_name" | "visitor_email">): string {
  const name = conversation.visitor_name?.trim();
  if (name) {
    const parts = name.split(/\s+/);
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }
  const email = conversation.visitor_email?.trim();
  return email ? email[0].toUpperCase() : "V";
}

/** Conversations matching the filters, newest message first. */
export function filterConversations(
  conversations: ChatConversation[],
  filters: ChatFilters,
  currentUserId: string | undefined
): ChatConversation[] {
  const needle = filters.search.trim().toLowerCase();
  return conversations
    .filter((c) => {
      if (filters.status !== "all" && c.status !== filters.status) return false;
      if (filters.assignee === "mine" && c.assigned_to !== currentUserId) return false;
      if (filters.assignee === "unassigned" && c.assigned_to !== null) return false;
      if (!needle) return true;
      return [c.visitor_name, c.visitor_email, c.visitor_phone, c.last_message_preview, c.page_url, c.page_title]
        .some((value) => value?.toLowerCase().includes(needle));
    })
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
}

export function countByStatus(conversations: ChatConversation[]): Record<ChatStatus | "all", number> {
  const counts = { all: conversations.length, open: 0, closed: 0 };
  for (const c of conversations) counts[c.status] += 1;
  return counts;
}

/**
 * Other conversations from the same person (same email or phone number),
 * newest first. Each browser gets its own conversation, so this is how a
 * returning visitor's earlier chats are found.
 */
export function relatedConversations(
  conversations: ChatConversation[],
  current: ChatConversation
): ChatConversation[] {
  const email = current.visitor_email?.trim().toLowerCase();
  const phone = current.visitor_phone?.replace(/\D/g, "");
  if (!email && !phone) return [];
  return conversations
    .filter(
      (c) =>
        c.id !== current.id &&
        ((!!email && c.visitor_email?.trim().toLowerCase() === email) ||
          (!!phone && c.visitor_phone?.replace(/\D/g, "") === phone))
    )
    .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
}

/** Open conversations with a visitor message nobody has read. */
export function unreadConversationCount(conversations: ChatConversation[]): number {
  return conversations.filter((c) => c.status === "open" && c.admin_unread_count > 0).length;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short time for the conversation list: "now", "5m", "14:05", "Tue", "12 Nov". */
export function listTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = now.getTime() - date.getTime();
  if (diff < 60_000) return "now";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return clock(date);
  if (days < 7) return WEEKDAYS[date.getDay()];
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Heading for a day of messages: "Today", "Yesterday", "Tue 12 Nov". */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

export function messageTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : clock(date);
}

export interface MessageDay {
  key: string;
  label: string;
  messages: ChatMessage[];
}

/** Messages in time order, split by calendar day. */
export function groupByDay(messages: ChatMessage[], now: Date = new Date()): MessageDay[] {
  const days: MessageDay[] = [];
  for (const message of [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const date = new Date(message.created_at);
    const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
    const last = days[days.length - 1];
    if (last?.key === key) last.messages.push(message);
    else days.push({ key, label: dayLabel(message.created_at, now), messages: [message] });
  }
  return days;
}

/** Adds or replaces a message, matching on id or on the sender's client_id. */
export function upsertMessage(messages: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const index = messages.findIndex(
    (m) => m.id === incoming.id || (!!incoming.client_id && m.client_id === incoming.client_id)
  );
  if (index === -1) return [...messages, incoming];
  const next = [...messages];
  next[index] = incoming;
  return next;
}

/** True when the visitor has seen the newest staff message. */
export function seenByVisitor(conversation: ChatConversation, messages: ChatMessage[]): boolean {
  if (!conversation.visitor_last_read_at) return false;
  const last = messages[messages.length - 1];
  return !!last && last.sender === "admin" && last.created_at <= conversation.visitor_last_read_at;
}

/** "Chrome on Windows", "Safari on iPhone"… from a user agent; null when unknown. */
export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

/** A page URL without the scheme, for display: "fettle.ie/pricing/". */
export function shortUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.host.replace(/^www\./, "")}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/** A random id for a message, so a resend is stored once. */
export function newClientId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `a_${random}`.slice(0, 40);
}
