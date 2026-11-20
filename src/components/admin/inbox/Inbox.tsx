import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  BellOff,
  BellRing,
  CheckCircle2,
  Globe,
  Info,
  Mail,
  MessagesSquare,
  Monitor,
  Moon,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  SendHorizontal,
  UserRound,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminList } from "@/hooks/useAdmin";
import {
  desktopAlertsState,
  testDesktopAlert,
  useChatConversations,
  useChatMessages,
  useConversationChannel,
  useSendChatMessage,
  useUpdateChatConversation,
} from "@/hooks/useChatInbox";
import { isMissingTableError } from "@/lib/customerFollowups";
import { formatDateTime } from "@/lib/customerInsights";
import {
  type ChatAssigneeFilter,
  type ChatConversation,
  type ChatFilters,
  type ChatMessage,
  DEFAULT_CHAT_FILTERS,
  countByStatus,
  describeDevice,
  filterConversations,
  groupByDay,
  listTime,
  messageTime,
  newClientId,
  relatedConversations,
  seenByVisitor,
  shortUrl,
  visitorInitials,
  visitorLabel,
} from "@/lib/chat";
import { cn } from "@/lib/utils";

interface AdminOption {
  userId: string;
  name: string;
  email: string | null;
}

const UNASSIGNED = "unassigned";

/**
 * Inbox: live chat with visitors on fettle.ie. Conversations on the left,
 * the open one in the middle, and what we know about the visitor on the
 * right. The open conversation is kept in the URL (?c=…) so it can be linked.
 */
export function Inbox() {
  const { user } = useAuth();
  const { data, error, isLoading, refetch } = useChatConversations();
  const { data: adminRows } = useAdminList();
  const [filters, setFilters] = useState<ChatFilters>(DEFAULT_CHAT_FILTERS);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("c") ?? undefined;
  const [alerts, setAlerts] = useState(desktopAlertsState);

  const conversations = useMemo(() => data ?? [], [data]);
  const visible = useMemo(
    () => filterConversations(conversations, filters, user?.id),
    [conversations, filters, user?.id]
  );
  const counts = useMemo(() => countByStatus(conversations), [conversations]);
  const selected = conversations.find((c) => c.id === selectedId);

  const admins = useMemo<AdminOption[]>(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((adminRows as any[] | undefined) ?? []).map((row) => ({
        userId: row.user_id as string,
        name:
          [row.profiles?.first_name, row.profiles?.last_name].filter(Boolean).join(" ").trim() ||
          row.profiles?.email ||
          "Admin",
        email: (row.profiles?.email as string | undefined) ?? null,
      })),
    [adminRows]
  );

  const select = (id: string | undefined) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("c", id);
        else next.delete("c");
        return next;
      },
      { replace: !id }
    );

  if (isLoading) return <Skeleton className="h-[60vh] w-full rounded-2xl" />;
  if (error) {
    return isMissingTableError(error) ? (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Not set up yet</AlertTitle>
        <AlertDescription>
          The Inbox is available once the live-chat database update is deployed.
        </AlertDescription>
      </Alert>
    ) : (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Couldn't load conversations</AlertTitle>
        <AlertDescription className="mt-2">
          <p>{error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-2" />
            Try Again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-13.5rem)] min-h-[480px] overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card xl:h-[calc(100dvh-10.5rem)]">
      {/* Conversation list */}
      <aside
        className={cn(
          "w-full flex-col border-border/60 md:flex md:w-80 md:shrink-0 md:border-r lg:w-[22rem]",
          selectedId ? "hidden" : "flex"
        )}
      >
        <div className="space-y-3 border-b border-border/60 p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))}
                placeholder="Search name, email, phone or message"
                aria-label="Search conversations"
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              value={filters.status}
              onValueChange={(value) =>
                value && setFilters((f) => ({ ...f, status: value as ChatFilters["status"] }))
              }
              aria-label="Conversation status"
            >
              <ToggleGroupItem value="open" variant="outline">
                Open ({counts.open})
              </ToggleGroupItem>
              <ToggleGroupItem value="closed" variant="outline">
                Closed
              </ToggleGroupItem>
              <ToggleGroupItem value="all" variant="outline">
                All
              </ToggleGroupItem>
            </ToggleGroup>
            <Select
              value={filters.assignee}
              onValueChange={(value) => setFilters((f) => ({ ...f, assignee: value as ChatAssigneeFilter }))}
            >
              <SelectTrigger className="h-9 w-[7.5rem]" aria-label="Assigned to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everyone</SelectItem>
                <SelectItem value="mine">Mine</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DesktopAlerts state={alerts} onChange={setAlerts} />

        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-muted-foreground">
              <MessagesSquare className="h-8 w-8" />
              <p className="text-sm">
                {conversations.length === 0
                  ? "No conversations yet. New chats from fettle.ie appear here."
                  : "No conversations match these filters."}
              </p>
            </div>
          ) : (
            <ul>
              {visible.map((conversation) => (
                <li key={conversation.id}>
                  <ConversationRow
                    conversation={conversation}
                    active={conversation.id === selectedId}
                    mine={conversation.assigned_to === user?.id}
                    onSelect={() => select(conversation.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* Open conversation */}
      {selected ? (
        <Thread
          key={selected.id}
          conversation={selected}
          admins={admins}
          related={relatedConversations(conversations, selected)}
          onOpenConversation={select}
          currentUserId={user?.id}
          currentUserEmail={user?.email ?? null}
          onBack={() => select(undefined)}
        />
      ) : (
        <div
          className={cn(
            "flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground",
            selectedId ? "flex" : "hidden md:flex"
          )}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <MessagesSquare className="h-6 w-6 text-primary" />
          </div>
          {selectedId ? (
            <>
              <p className="text-sm">This conversation isn't in the list.</p>
              <Button variant="outline" size="sm" onClick={() => select(undefined)}>
                Back to conversations
              </Button>
            </>
          ) : (
            <p className="max-w-xs text-sm">Choose a conversation to read it and reply.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Desktop notifications for new chat messages: a switch-on button, then a
 * confirmation with a test. They show while the hub is open in a browser
 * tab on this computer, even when that tab is in the background.
 */
function DesktopAlerts({
  state,
  onChange,
}: {
  state: ReturnType<typeof desktopAlertsState>;
  onChange: (state: ReturnType<typeof desktopAlertsState>) => void;
}) {
  if (state === "unsupported") return null;
  if (state === "default") {
    return (
      <div className="border-b border-border/60 bg-primary/5 p-3">
        <p className="text-sm font-medium">Get notified of new chats</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Desktop notifications appear on this computer while the hub is open in a tab.
        </p>
        <Button
          size="sm"
          className="mt-2"
          onClick={() =>
            void Notification.requestPermission().then((next) => {
              onChange(next);
              if (next === "granted") testDesktopAlert();
            })
          }
        >
          <BellRing className="mr-1.5 h-3.5 w-3.5" />
          Turn on desktop notifications
        </Button>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="flex items-start gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
        <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Desktop notifications are blocked for this site. To turn them on, click the icon beside the
          address bar and allow notifications, then reload.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <BellRing className="h-3.5 w-3.5 text-success" />
        Desktop notifications are on
      </span>
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={testDesktopAlert}>
        Send a test
      </Button>
    </div>
  );
}

function Avatar({ conversation, className }: { conversation: ChatConversation; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground",
        className
      )}
    >
      {visitorInitials(conversation)}
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  mine,
  onSelect,
}: {
  conversation: ChatConversation;
  active: boolean;
  mine: boolean;
  onSelect: () => void;
}) {
  const unread = conversation.admin_unread_count > 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-3 border-b border-border/40 px-3 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active && "bg-primary/5 hover:bg-primary/5"
      )}
    >
      <Avatar conversation={conversation} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
            {visitorLabel(conversation)}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {listTime(conversation.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={cn("truncate text-sm", unread ? "text-foreground" : "text-muted-foreground")}>
            {conversation.last_message_sender === "admin" && "You: "}
            {conversation.last_message_preview ?? "No messages yet"}
          </p>
          {unread && (
            <span
              className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
              aria-label={`${conversation.admin_unread_count} unread`}
            >
              {conversation.admin_unread_count}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {conversation.status === "closed" && (
            <Badge variant="outline" className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground">
              Closed
            </Badge>
          )}
          {conversation.started_offline && (
            <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[11px] font-normal text-muted-foreground">
              <Moon className="h-3 w-3" />
              Out of hours
            </Badge>
          )}
          {conversation.assigned_to ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
              {mine ? "Mine" : (conversation.assigned_to_email?.split("@")[0] ?? "Assigned")}
            </Badge>
          ) : (
            conversation.status === "open" && (
              <Badge variant="outline" className="h-5 border-warning/50 px-1.5 text-[11px] font-normal">
                Unassigned
              </Badge>
            )
          )}
        </div>
      </div>
    </button>
  );
}

function Thread({
  conversation,
  admins,
  related,
  onOpenConversation,
  currentUserId,
  currentUserEmail,
  onBack,
}: {
  conversation: ChatConversation;
  admins: AdminOption[];
  related: ChatConversation[];
  onOpenConversation: (id: string) => void;
  currentUserId: string | undefined;
  currentUserEmail: string | null;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const { data: messages, error, isLoading } = useChatMessages(conversation.id);
  const { visitorTyping, sendTyping, pingVisitor } = useConversationChannel(conversation.realtime_topic);
  const sendMessage = useSendChatMessage();
  const update = useUpdateChatConversation();
  const [draft, setDraft] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const closed = conversation.status === "closed";

  const days = useMemo(() => groupByDay(messages ?? []), [messages]);
  const seen = useMemo(() => seenByVisitor(conversation, messages ?? []), [conversation, messages]);

  // Stay at the newest message.
  const messageCount = messages?.length ?? 0;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, visitorTyping]);

  // Opening a conversation (or a new message arriving while it's open and
  // the tab is in view) marks it read.
  const { mutate: updateConversation } = update;
  const { id, admin_unread_count: unread } = conversation;
  useEffect(() => {
    const markRead = () => {
      if (unread > 0 && document.visibilityState === "visible") {
        updateConversation({ id, changes: { admin_unread_count: 0 } });
      }
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [id, unread, updateConversation]);

  const failed = (title: string) => (err: { message?: string }) =>
    toast({ title, description: err?.message, variant: "destructive" });

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    sendMessage.mutate(
      { conversationId: conversation.id, body, clientId: newClientId() },
      {
        onSuccess: pingVisitor,
        onError: (err) => {
          setDraft((current) => current || body);
          failed("Couldn't send your message")(err);
        },
      }
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const assign = (value: string) => {
    const admin = admins.find((a) => a.userId === value);
    const changes =
      value === UNASSIGNED
        ? { assigned_to: null, assigned_to_email: null }
        : {
            assigned_to: value,
            assigned_to_email: admin?.email ?? (value === currentUserId ? currentUserEmail : null),
          };
    update.mutate({ id: conversation.id, changes }, { onError: failed("Couldn't change who it's assigned to") });
  };

  const setStatus = (status: "open" | "closed") =>
    update.mutate({ id: conversation.id, changes: { status } }, { onError: failed("Couldn't update the conversation") });

  // The assignee may no longer be an admin; keep them selectable so the
  // control still shows who has it.
  const assigneeOptions =
    conversation.assigned_to && !admins.some((a) => a.userId === conversation.assigned_to)
      ? [
          ...admins,
          {
            userId: conversation.assigned_to,
            name: conversation.assigned_to_email ?? "Former admin",
            email: conversation.assigned_to_email,
          },
        ]
      : admins;

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onBack}
            aria-label="Back to conversations"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar conversation={conversation} className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{visitorLabel(conversation)}</p>
            <p className="truncate text-xs text-muted-foreground">
              {closed
                ? `Closed${conversation.closed_at ? ` ${formatDateTime(conversation.closed_at)}` : ""}`
                : (shortUrl(conversation.page_url) ?? "Website visitor")}
            </p>
          </div>
          <Select value={conversation.assigned_to ?? UNASSIGNED} onValueChange={assign}>
            <SelectTrigger className="h-9 w-[9.5rem]" aria-label="Assigned to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {assigneeOptions.map((admin) => (
                <SelectItem key={admin.userId} value={admin.userId}>
                  {admin.userId === currentUserId ? `${admin.name} (you)` : admin.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {closed ? (
            <Button variant="outline" size="sm" onClick={() => setStatus("open")}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reopen
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setStatus("closed")}>
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Close
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="xl:hidden"
            onClick={() => setDetailsOpen(true)}
            aria-label="Visitor details"
          >
            <Info className="h-4 w-4" />
          </Button>
        </header>

        <div ref={scroller} className="flex-1 overflow-y-auto bg-background/40 px-3 py-4 sm:px-5">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-2/3 rounded-2xl" />
              <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
              <Skeleton className="h-10 w-1/3 rounded-2xl" />
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-destructive">
              Couldn't load this conversation: {error.message}
            </p>
          ) : (
            <div role="log" aria-live="polite" className="space-y-4">
              {days.map((day) => (
                <div key={day.key} className="space-y-1.5">
                  <p className="py-1 text-center text-xs font-medium text-muted-foreground">{day.label}</p>
                  {day.messages.map((message, index) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      next={day.messages[index + 1]}
                    />
                  ))}
                </div>
              ))}
              {seen && <p className="text-right text-[11px] text-muted-foreground">Seen</p>}
              {visitorTyping && (
                <div className="flex justify-start" aria-label="The visitor is typing">
                  <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-muted px-3.5 py-3">
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                        style={{ animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {closed ? (
          <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
            <span>This conversation is closed. It reopens if the visitor writes again.</span>
            <Button variant="outline" size="sm" onClick={() => setStatus("open")}>
              Reopen to reply
            </Button>
          </div>
        ) : (
          <div className="border-t border-border/60 p-3">
            <div className="flex items-end gap-2">
              <Textarea
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (event.target.value.trim()) sendTyping();
                }}
                onKeyDown={onKeyDown}
                placeholder="Write a reply…"
                aria-label="Reply"
                rows={Math.min(6, Math.max(1, draft.split("\n").length))}
                maxLength={4000}
                className="min-h-[44px] resize-none"
              />
              <Button onClick={send} disabled={!draft.trim()} aria-label="Send reply" className="h-11">
                <SendHorizontal className="h-4 w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Send</span>
              </Button>
            </div>
            <p className="mt-1.5 hidden text-[11px] text-muted-foreground sm:block">
              Enter to send · Shift + Enter for a new line
            </p>
          </div>
        )}
      </section>

      <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border/60 p-4 xl:block">
        <VisitorDetails conversation={conversation} related={related} onOpenConversation={onOpenConversation} />
      </aside>

      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-80 overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-left">Visitor details</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <VisitorDetails
              conversation={conversation}
              related={related}
              onOpenConversation={(id) => {
                setDetailsOpen(false);
                onOpenConversation(id);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

const GROUP_GAP_MS = 5 * 60 * 1000;

function MessageBubble({ message, next }: { message: ChatMessage; next: ChatMessage | undefined }) {
  if (message.sender === "system") {
    return <p className="py-1 text-center text-xs text-muted-foreground">{message.body}</p>;
  }
  const fromTeam = message.sender === "admin";
  const pending = message.id.startsWith("pending-");
  // Time and name under the last message of a run from the same sender.
  const endsRun =
    !next ||
    next.sender !== message.sender ||
    next.sender_user_id !== message.sender_user_id ||
    Date.parse(next.created_at) - Date.parse(message.created_at) > GROUP_GAP_MS;

  return (
    <div className={cn("flex flex-col", fromTeam ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed sm:max-w-[70%]",
          fromTeam ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
          pending && "opacity-70"
        )}
      >
        {message.body}
      </div>
      {(endsRun || pending) && (
        <p className="mb-1.5 mt-1 px-1 text-[11px] text-muted-foreground">
          {pending
            ? "Sending…"
            : [fromTeam ? message.sender_name : null, messageTime(message.created_at)].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

function VisitorDetails({
  conversation,
  related,
  onOpenConversation,
}: {
  conversation: ChatConversation;
  related: ChatConversation[];
  onOpenConversation: (id: string) => void;
}) {
  const device = describeDevice(conversation.user_agent);
  return (
    <div className="space-y-5 text-sm">
      <div className="flex flex-col items-center gap-2 text-center">
        <Avatar conversation={conversation} className="h-14 w-14 text-base" />
        <div>
          <p className="font-semibold">{visitorLabel(conversation)}</p>
          <p className="text-xs text-muted-foreground">
            {conversation.started_offline ? "Left a message outside working hours" : "Website visitor"}
          </p>
        </div>
      </div>

      <dl className="space-y-3">
        <DetailRow icon={UserRound} label="Name" value={conversation.visitor_name ?? "Not given"} />
        <DetailRow
          icon={Mail}
          label="Email"
          value={
            conversation.visitor_email ? (
              <a href={`mailto:${conversation.visitor_email}`} className="break-all text-primary hover:underline">
                {conversation.visitor_email}
              </a>
            ) : (
              "Not given"
            )
          }
        />
        <DetailRow
          icon={Phone}
          label="Phone"
          value={
            conversation.visitor_phone ? (
              <a href={`tel:${conversation.visitor_phone.replace(/[^0-9+]/g, "")}`} className="text-primary hover:underline">
                {conversation.visitor_phone}
              </a>
            ) : (
              "Not given"
            )
          }
        />
        <DetailRow
          icon={Globe}
          label="Started on"
          value={
            conversation.page_url ? (
              <a
                href={conversation.page_url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary hover:underline"
                title={conversation.page_title ?? undefined}
              >
                {shortUrl(conversation.page_url)}
              </a>
            ) : (
              "Unknown page"
            )
          }
        />
        {conversation.referrer && (
          <DetailRow icon={Globe} label="Came from" value={shortUrl(conversation.referrer)} />
        )}
        {device && <DetailRow icon={Monitor} label="Device" value={device} />}
      </dl>

      <dl className="space-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
        <div className="flex justify-between gap-3">
          <dt>Started</dt>
          <dd className="text-right text-foreground">{formatDateTime(conversation.created_at)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Last message</dt>
          <dd className="text-right text-foreground">{formatDateTime(conversation.last_message_at)}</dd>
        </div>
        {conversation.visitor_last_read_at && (
          <div className="flex justify-between gap-3">
            <dt>Visitor last read</dt>
            <dd className="text-right text-foreground">{formatDateTime(conversation.visitor_last_read_at)}</dd>
          </div>
        )}
        {conversation.status === "closed" && conversation.closed_by_email && (
          <div className="flex justify-between gap-3">
            <dt>Closed by</dt>
            <dd className="break-all text-right text-foreground">{conversation.closed_by_email}</dd>
          </div>
        )}
      </dl>

      {related.length > 0 && (
        <div className="border-t border-border/60 pt-4">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Same email/phone typed — not verified ({related.length})
          </p>
          <ul className="space-y-1.5">
            {related.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  onClick={() => onOpenConversation(other.id)}
                  className="w-full rounded-lg border border-border/60 px-2.5 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatDateTime(other.last_message_at)}</span>
                    <span>{other.status === "closed" ? "Closed" : "Open"}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm">
                    {other.last_message_preview ?? "No messages"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Globe;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="break-words">{value}</dd>
      </div>
    </div>
  );
}
