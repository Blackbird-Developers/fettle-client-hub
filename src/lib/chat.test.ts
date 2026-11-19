import { describe, expect, it } from "vitest";
import {
  type ChatConversation,
  type ChatMessage,
  DEFAULT_CHAT_FILTERS,
  countByStatus,
  dayLabel,
  describeDevice,
  filterConversations,
  groupByDay,
  listTime,
  relatedConversations,
  newClientId,
  seenByVisitor,
  shortUrl,
  unreadConversationCount,
  upsertMessage,
  visitorInitials,
  visitorLabel,
} from "./chat";

let nextId = 1;

function conversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  const id = `${String(nextId++).padStart(4, "0")}aaaa-0000-4000-8000-000000000000`;
  return {
    id,
    created_at: "2026-11-19T10:00:00.000Z",
    updated_at: "2026-11-19T10:00:00.000Z",
    status: "open",
    realtime_topic: `chat-${id}`,
    visitor_name: null,
    visitor_email: null,
    visitor_phone: null,
    started_offline: false,
    page_url: "https://fettle.ie/pricing/",
    page_title: "Pricing",
    referrer: null,
    user_agent: null,
    assigned_to: null,
    assigned_to_email: null,
    last_message_at: "2026-11-19T10:00:00.000Z",
    last_message_preview: "Hello",
    last_message_sender: "visitor",
    admin_unread_count: 0,
    visitor_last_read_at: null,
    closed_at: null,
    closed_by_email: null,
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${nextId++}`,
    conversation_id: "c1",
    created_at: "2026-11-19T10:00:00.000Z",
    sender: "visitor",
    sender_user_id: null,
    sender_name: null,
    body: "Hello",
    client_id: null,
    ...overrides,
  };
}

describe("visitor labels", () => {
  it("prefers the name, then the email, then a short id", () => {
    expect(visitorLabel(conversation({ visitor_name: "Sarah Byrne", visitor_email: "s@b.ie" }))).toBe("Sarah Byrne");
    expect(visitorLabel(conversation({ visitor_email: "s@b.ie" }))).toBe("s@b.ie");
    expect(visitorLabel(conversation({ id: "3f2b8c1e-0000-4000-8000-000000000000" }))).toBe("Visitor 3F2B");
  });

  it("makes initials", () => {
    expect(visitorInitials(conversation({ visitor_name: "Sarah Byrne" }))).toBe("SB");
    expect(visitorInitials(conversation({ visitor_name: "Sarah" }))).toBe("S");
    expect(visitorInitials(conversation({ visitor_email: "kate@b.ie" }))).toBe("K");
    expect(visitorInitials(conversation())).toBe("V");
  });
});

describe("filterConversations", () => {
  const mine = conversation({ assigned_to: "me", last_message_at: "2026-11-19T11:00:00.000Z" });
  const unassigned = conversation({ visitor_name: "Kate", last_message_at: "2026-11-19T12:00:00.000Z" });
  const closed = conversation({ status: "closed", visitor_email: "old@b.ie", assigned_to: "someone" });
  const all = [mine, unassigned, closed];

  it("shows open conversations by default, newest first", () => {
    expect(filterConversations(all, DEFAULT_CHAT_FILTERS, "me")).toEqual([unassigned, mine]);
  });

  it("filters by status and assignee", () => {
    expect(filterConversations(all, { ...DEFAULT_CHAT_FILTERS, status: "closed" }, "me")).toEqual([closed]);
    expect(filterConversations(all, { ...DEFAULT_CHAT_FILTERS, status: "all" }, "me")).toHaveLength(3);
    expect(filterConversations(all, { ...DEFAULT_CHAT_FILTERS, assignee: "mine" }, "me")).toEqual([mine]);
    expect(filterConversations(all, { ...DEFAULT_CHAT_FILTERS, assignee: "unassigned" }, "me")).toEqual([unassigned]);
  });

  it("searches name, email, preview and page", () => {
    const search = (text: string) =>
      filterConversations(all, { status: "all", assignee: "all", search: text }, "me");
    expect(search("kate")).toEqual([unassigned]);
    expect(search("OLD@")).toEqual([closed]);
    expect(filterConversations([conversation({ visitor_phone: "087 123 4567" })], { status: "all", assignee: "all", search: "087 123" }, "me")).toHaveLength(1);
    expect(search("pricing")).toHaveLength(3);
    expect(search("nothing here")).toEqual([]);
  });
});

describe("counts", () => {
  it("counts by status and unread open conversations", () => {
    const list = [
      conversation({ admin_unread_count: 2 }),
      conversation(),
      conversation({ status: "closed", admin_unread_count: 1 }),
    ];
    expect(countByStatus(list)).toEqual({ all: 3, open: 2, closed: 1 });
    expect(unreadConversationCount(list)).toBe(1);
  });
});

describe("relatedConversations", () => {
  it("finds other chats with the same email or phone, newest first", () => {
    const current = conversation({ visitor_email: "Sam@b.ie", visitor_phone: "087 123 4567" });
    const sameEmail = conversation({ visitor_email: "sam@b.ie", last_message_at: "2026-11-01T10:00:00.000Z" });
    const samePhone = conversation({ visitor_phone: "0871234567", last_message_at: "2026-11-10T10:00:00.000Z" });
    const other = conversation({ visitor_email: "kate@b.ie" });
    expect(relatedConversations([current, sameEmail, samePhone, other], current)).toEqual([samePhone, sameEmail]);
  });

  it("finds nothing for a visitor who left no details", () => {
    const current = conversation();
    expect(relatedConversations([current, conversation()], current)).toEqual([]);
  });
});

describe("times", () => {
  const now = new Date(2026, 10, 19, 15, 0, 0);
  const at = (date: Date) => date.toISOString();

  it("listTime shortens by age", () => {
    expect(listTime(at(new Date(2026, 10, 19, 14, 59, 30)), now)).toBe("now");
    expect(listTime(at(new Date(2026, 10, 19, 14, 40)), now)).toBe("20m");
    expect(listTime(at(new Date(2026, 10, 19, 9, 5)), now)).toBe("09:05");
    expect(listTime(at(new Date(2026, 10, 17, 9, 5)), now)).toBe("Tue");
    expect(listTime(at(new Date(2026, 10, 2, 9, 5)), now)).toBe("2 Nov");
    expect(listTime("nope", now)).toBe("");
  });

  it("dayLabel names today and yesterday", () => {
    expect(dayLabel(at(new Date(2026, 10, 19, 1, 0)), now)).toBe("Today");
    expect(dayLabel(at(new Date(2026, 10, 18, 23, 0)), now)).toBe("Yesterday");
    expect(dayLabel(at(new Date(2026, 10, 12, 12, 0)), now)).toBe("Thu 12 Nov");
    expect(dayLabel(at(new Date(2025, 11, 31, 12, 0)), now)).toBe("Wed 31 Dec 2025");
  });

  it("groupByDay sorts and splits by day", () => {
    const a = message({ created_at: at(new Date(2026, 10, 18, 9, 0)) });
    const b = message({ created_at: at(new Date(2026, 10, 19, 9, 0)) });
    const c = message({ created_at: at(new Date(2026, 10, 19, 8, 0)) });
    const days = groupByDay([b, a, c], now);
    expect(days.map((d) => d.label)).toEqual(["Yesterday", "Today"]);
    expect(days[1].messages).toEqual([c, b]);
  });
});

describe("messages", () => {
  it("upsertMessage appends, or replaces by id or client_id", () => {
    const first = message({ id: "temp-1", client_id: "a_1" });
    const saved = message({ id: "real-1", client_id: "a_1", body: "saved" });
    const other = message({ id: "real-2" });
    expect(upsertMessage([first], saved)).toEqual([saved]);
    expect(upsertMessage([saved], other)).toEqual([saved, other]);
    expect(upsertMessage([saved, other], { ...other, body: "edited" })[1].body).toBe("edited");
  });

  it("seenByVisitor is true only when the last staff message was read", () => {
    const reply = message({ sender: "admin", created_at: "2026-11-19T10:05:00.000Z" });
    expect(seenByVisitor(conversation({ visitor_last_read_at: "2026-11-19T10:06:00.000Z" }), [reply])).toBe(true);
    expect(seenByVisitor(conversation({ visitor_last_read_at: "2026-11-19T10:04:00.000Z" }), [reply])).toBe(false);
    expect(seenByVisitor(conversation(), [reply])).toBe(false);
    expect(
      seenByVisitor(conversation({ visitor_last_read_at: "2026-11-19T10:06:00.000Z" }), [reply, message()])
    ).toBe(false);
  });
});

describe("visitor details", () => {
  it("describes common devices", () => {
    expect(
      describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")
    ).toBe("Chrome on Windows");
    expect(
      describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
    ).toBe("Safari on iPhone");
    expect(
      describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")
    ).toBe("Edge on Windows");
    expect(describeDevice("curl/8")).toBeNull();
    expect(describeDevice(null)).toBeNull();
  });

  it("shortens URLs", () => {
    expect(shortUrl("https://www.fettle.ie/pricing/?utm=1")).toBe("fettle.ie/pricing/");
    expect(shortUrl("not a url")).toBe("not a url");
    expect(shortUrl(null)).toBeNull();
  });

  it("newClientId is unique and fits the column", () => {
    const id = newClientId();
    expect(id).toMatch(/^a_[A-Za-z0-9]+$/);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(newClientId()).not.toBe(id);
  });
});
