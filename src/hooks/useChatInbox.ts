// Live chat (docs/LIVE_CHAT.md): data hooks for the admin Inbox.
//
// Staff read and write the chat tables directly; RLS limits that to admins.
// New messages arrive over Supabase Realtime (useChatRealtime), with a slow
// refetch behind it so the Inbox still updates if the socket drops.

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useAdmin";
import { isMissingTableError } from "@/lib/customerFollowups";
import {
  type ChatConversation,
  type ChatMessage,
  type ChatStatus,
  newClientId,
  unreadConversationCount,
  upsertMessage,
  visitorLabel,
} from "@/lib/chat";

export const CHAT_CONVERSATIONS_QUERY_KEY = ["chat-conversations"] as const;
export const chatMessagesQueryKey = (conversationId: string | undefined) =>
  ["chat-messages", conversationId] as const;

type QueryError = { code?: string; message: string };

/** Newest conversations in the Inbox list. Older ones are still found by opening their link. */
const CONVERSATION_LIMIT = 500;

export function useChatConversations() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<ChatConversation[], QueryError>({
    queryKey: CHAT_CONVERSATIONS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("*")
        .order("last_message_at", { ascending: false })
        .limit(CONVERSATION_LIMIT);
      if (error) throw error;
      return data as ChatConversation[];
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 10,
    // Stops while the query is failing (e.g. the migration isn't applied yet).
    refetchInterval: (query) => (query.state.error ? false : 1000 * 30),
    // Missing table = migration not applied yet; retrying won't help.
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

/** Open conversations with unread visitor messages, for the sidebar badge (0 until loaded). */
export function useChatUnreadCount(): number {
  const { data } = useChatConversations();
  return data ? unreadConversationCount(data) : 0;
}

export function useChatMessages(conversationId: string | undefined) {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<ChatMessage[], QueryError>({
    queryKey: chatMessagesQueryKey(conversationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (error) throw error;
      return data as ChatMessage[];
    },
    enabled: isAdmin === true && !!conversationId,
    staleTime: 1000 * 5,
    refetchInterval: 1000 * 20,
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

// Sends a reply. It shows in the thread straight away and is swapped for the
// saved row; if saving fails it is removed again and the caller gets the error.
export function useSendChatMessage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      conversationId,
      body,
      clientId,
    }: {
      conversationId: string;
      body: string;
      clientId: string;
    }) => {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({ conversation_id: conversationId, body, client_id: clientId })
        .select()
        .single();
      if (error) throw error;
      return data as ChatMessage;
    },
    onMutate: async ({ conversationId, body, clientId }) => {
      const key = chatMessagesQueryKey(conversationId);
      await queryClient.cancelQueries({ queryKey: key });
      const pending: ChatMessage = {
        id: `pending-${clientId}`,
        conversation_id: conversationId,
        created_at: new Date().toISOString(),
        sender: "admin",
        sender_user_id: user?.id ?? null,
        sender_name: null,
        body,
        client_id: clientId,
      };
      queryClient.setQueryData<ChatMessage[]>(key, (rows) => upsertMessage(rows ?? [], pending));
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<ChatMessage[]>(chatMessagesQueryKey(saved.conversation_id), (rows) =>
        upsertMessage(rows ?? [], saved)
      );
    },
    onError: (_error, { conversationId, clientId }) => {
      queryClient.setQueryData<ChatMessage[]>(chatMessagesQueryKey(conversationId), (rows) =>
        rows?.filter((row) => row.client_id !== clientId)
      );
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_QUERY_KEY }),
  });
}

export interface ChatConversationChanges {
  status?: ChatStatus;
  assigned_to?: string | null;
  assigned_to_email?: string | null;
  admin_unread_count?: number;
}

// Closes or reopens a conversation, assigns it, or marks it read. Updates the
// cached list straight away and rolls back if the save fails.
export function useUpdateChatConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: ChatConversationChanges }) => {
      const { data, error } = await supabase
        .from("chat_conversations")
        .update(changes)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as ChatConversation;
    },
    onMutate: async ({ id, changes }) => {
      await queryClient.cancelQueries({ queryKey: CHAT_CONVERSATIONS_QUERY_KEY });
      const previous = queryClient.getQueryData<ChatConversation[]>(CHAT_CONVERSATIONS_QUERY_KEY);
      queryClient.setQueryData<ChatConversation[]>(CHAT_CONVERSATIONS_QUERY_KEY, (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, ...changes } : row))
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(CHAT_CONVERSATIONS_QUERY_KEY, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_QUERY_KEY }),
  });
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

let audioContext: AudioContext | null = null;

/** Two soft notes. Silent if the browser hasn't allowed audio yet. */
export function playChatSound() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    const ctx = audioContext;
    if (ctx.state === "suspended") void ctx.resume();
    [660, 880].forEach((frequency, index) => {
      const start = ctx.currentTime + index * 0.14;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    });
  } catch {
    // Sound is a nice-to-have.
  }
}

export function desktopAlertsState(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function showDesktopAlert(title: string, body: string, conversationId: string) {
  if (desktopAlertsState() !== "granted") return;
  try {
    const notification = new Notification(title, { body, tag: `fettle-chat-${conversationId}` });
    notification.onclick = () => {
      window.focus();
      notification.close();
      // Open that chat, unless this was only the test notification.
      if (conversationId !== "test") {
        window.history.pushState({}, "", `/admin/inbox?c=${conversationId}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    };
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/** Shows a sample notification and plays the sound, so staff can check alerts reach them. */
export function testDesktopAlert() {
  playChatSound();
  showDesktopAlert("Fettle chat", "Desktop notifications are working.", "test");
}

/** The conversation open in the Inbox, read from the URL (?c=…). */
function openConversationId(): string | null {
  if (!window.location.pathname.startsWith("/admin/inbox")) return null;
  return new URLSearchParams(window.location.search).get("c");
}

// Listens for chat changes while an admin is anywhere in the admin area:
// new messages go into the cached thread, the list is refreshed, and a
// visitor message the admin isn't looking at plays a sound and (if allowed)
// shows a desktop notification. `onVisitorMessage` lets the page add a toast.
export function useChatRealtime(
  onVisitorMessage?: (conversation: ChatConversation | undefined, message: ChatMessage) => void
) {
  const queryClient = useQueryClient();
  const { data: isAdmin } = useIsAdmin();
  const callback = useRef(onVisitorMessage);
  callback.current = onVisitorMessage;

  useEffect(() => {
    if (isAdmin !== true) return;

    const channel = supabase
      .channel("admin-chat-inbox")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => {
          const message = payload.new as ChatMessage;
          const key = chatMessagesQueryKey(message.conversation_id);
          // Only threads that are already loaded; others load when opened.
          if (queryClient.getQueryData(key)) {
            queryClient.setQueryData<ChatMessage[]>(key, (rows) => upsertMessage(rows ?? [], message));
          }
          void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_QUERY_KEY });

          if (message.sender !== "visitor") return;
          const watching =
            document.visibilityState === "visible" && openConversationId() === message.conversation_id;
          if (watching) return;
          const conversation = queryClient
            .getQueryData<ChatConversation[]>(CHAT_CONVERSATIONS_QUERY_KEY)
            ?.find((row) => row.id === message.conversation_id);
          playChatSound();
          showDesktopAlert(
            conversation ? `${visitorLabel(conversation)} · Fettle chat` : "New Fettle chat message",
            message.body.slice(0, 140),
            message.conversation_id
          );
          callback.current?.(conversation, message);
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" }, () => {
        void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_QUERY_KEY });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, queryClient]);
}

const TYPING_SHOWN_MS = 4000;
const TYPING_SEND_EVERY_MS = 2500;

// Joins the conversation's own broadcast channel, which the visitor's widget
// is also on. It carries no message text: only "typing" both ways and a
// "message" ping that tells the widget to fetch the new reply.
export function useConversationChannel(topic: string | undefined) {
  const [visitorTyping, setVisitorTyping] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    setVisitorTyping(false);
    if (!topic) return;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const channel = supabase
      .channel(topic, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.from !== "visitor") return;
        setVisitorTyping(true);
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => setVisitorTyping(false), TYPING_SHOWN_MS);
      })
      .on("broadcast", { event: "message" }, ({ payload }) => {
        if (payload?.from === "visitor") setVisitorTyping(false);
      })
      .subscribe();
    channelRef.current = channel;

    return () => {
      clearTimeout(hideTimer);
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [topic]);

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (!channelRef.current || now - lastTypingSent.current < TYPING_SEND_EVERY_MS) return;
    lastTypingSent.current = now;
    void channelRef.current.send({ type: "broadcast", event: "typing", payload: { from: "admin" } });
  }, []);

  const pingVisitor = useCallback(() => {
    lastTypingSent.current = 0;
    void channelRef.current?.send({ type: "broadcast", event: "message", payload: { from: "admin" } });
  }, []);

  return { visitorTyping, sendTyping, pingVisitor };
}

export { newClientId };
