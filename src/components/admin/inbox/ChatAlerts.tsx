import { useNavigate } from "react-router-dom";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/hooks/use-toast";
import { useChatRealtime } from "@/hooks/useChatInbox";
import { visitorLabel } from "@/lib/chat";

/**
 * Keeps the live chat connection open on every admin page. A visitor message
 * the admin isn't looking at plays a sound (and a desktop notification, if
 * allowed); away from the Inbox it also shows a toast that opens the chat.
 * Renders nothing.
 */
export function ChatAlerts({ onInbox }: { onInbox: boolean }) {
  const { toast } = useToast();
  const navigate = useNavigate();

  useChatRealtime((conversation, message) => {
    // In the Inbox the list already shows the unread conversation.
    if (onInbox) return;
    toast({
      title: conversation ? `New chat message from ${visitorLabel(conversation)}` : "New chat message",
      description: message.body.length > 120 ? `${message.body.slice(0, 120)}…` : message.body,
      action: (
        <ToastAction
          altText="Open the conversation"
          onClick={() => navigate(`/admin/inbox?c=${message.conversation_id}`)}
        >
          Open
        </ToastAction>
      ),
    });
  });

  return null;
}
