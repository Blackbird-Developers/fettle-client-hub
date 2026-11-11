import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type AdminNotification, notificationDetailLines } from "@/lib/adminNotifications";
import { formatDateTime } from "@/lib/customerInsights";
import { cn } from "@/lib/utils";

// One notification, as shown under the bell and on the Notifications page.
export function NotificationItem({
  notification: n,
  onToggleRead,
}: {
  notification: AdminNotification;
  /** Called with true to mark it read, false to mark it unread. */
  onToggleRead: (read: boolean) => void;
}) {
  const lines = notificationDetailLines(n);
  const isUnread = !n.read_at;

  return (
    <li className={cn("px-4 py-3 space-y-1", isUnread && "bg-primary/5")}>
      <div className="flex items-start gap-2">
        {isUnread && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" aria-hidden />}
        <div className="flex-1 min-w-0 space-y-1">
          <p className={cn("text-sm", isUnread ? "font-semibold" : "font-medium")}>{n.title}</p>
          {n.client_email && <p className="text-xs text-muted-foreground break-all">{n.client_email}</p>}
          {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
          {lines.length > 0 && (
            <ul className="text-xs text-muted-foreground space-y-0.5">
              {lines.map((line) => (
                <li key={line} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-muted-foreground">
              {formatDateTime(n.created_at)}
              {n.read_at && n.read_by_email ? ` · read by ${n.read_by_email}` : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px]"
              onClick={() => onToggleRead(isUnread)}
            >
              {isUnread ? (
                <>
                  <Check className="h-3 w-3" />
                  Mark read
                </>
              ) : (
                "Mark unread"
              )}
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}
