import { Bell, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAdminNotifications, useMarkNotificationsRead } from "@/hooks/useAdminNotifications";
import { notificationDetailLines, unreadCount } from "@/lib/adminNotifications";
import { isMissingTableError } from "@/lib/customerFollowups";
import { formatDateTime } from "@/lib/customerInsights";
import { cn } from "@/lib/utils";

// Bell on every admin page: problems the hub flagged for staff, e.g. a
// client who couldn't use their bundle code.
export function AdminNotificationsBell() {
  const { data: rows, isLoading, error } = useAdminNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = unreadCount(rows);
  const unreadIds = (rows ?? []).filter((r) => !r.read_at).map((r) => r.id);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative shrink-0"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="font-semibold text-sm">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markRead.mutate({ ids: unreadIds, read: true })}
            >
              Mark all read
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            {isMissingTableError(error)
              ? "Notifications aren't switched on yet (the admin_notifications table hasn't been added)."
              : "Couldn't load notifications. Try again in a moment."}
          </p>
        ) : !rows || rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          <ScrollArea className="max-h-[28rem]">
            <ul className="divide-y">
              {rows.map((n) => {
                const lines = notificationDetailLines(n);
                const isUnread = !n.read_at;
                return (
                  <li key={n.id} className={cn("px-4 py-3 space-y-1", isUnread && "bg-primary/5")}>
                    <div className="flex items-start gap-2">
                      {isUnread && <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" aria-hidden />}
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className={cn("text-sm", isUnread ? "font-semibold" : "font-medium")}>{n.title}</p>
                        {n.client_email && (
                          <p className="text-xs text-muted-foreground break-all">{n.client_email}</p>
                        )}
                        {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
                        {lines.length > 0 && (
                          <ul className="text-xs text-muted-foreground space-y-0.5">
                            {lines.map((line) => (
                              <li key={line} className="break-words">{line}</li>
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
                            onClick={() => markRead.mutate({ ids: [n.id], read: isUnread })}
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
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
