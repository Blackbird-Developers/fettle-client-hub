import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAdminNotifications, useMarkNotificationsRead } from "@/hooks/useAdminNotifications";
import { BELL_LIMIT, unreadCount } from "@/lib/adminNotifications";
import { isMissingTableError } from "@/lib/customerFollowups";
import { NotificationItem } from "./NotificationItem";

// Bell on every admin page: the latest problems the hub flagged for staff,
// e.g. a client who couldn't use their bundle code. "View all" opens the
// Notifications page with the full list.
export function AdminNotificationsBell() {
  const [open, setOpen] = useState(false);
  const { data: rows, isLoading, error } = useAdminNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = unreadCount(rows);
  const latest = (rows ?? []).slice(0, BELL_LIMIT);

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent align="end" className="w-[26rem] max-w-[calc(100vw-2rem)] p-0 flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="font-semibold text-sm">Notifications</p>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => markRead.mutate({ allUnread: true })}
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
        ) : latest.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">No notifications yet.</p>
        ) : (
          // A plain scrolling box: Radix ScrollArea only scrolls with a fixed
          // height, so with a max height it cut the list off instead.
          <div
            className="max-h-[min(28rem,60vh)] overflow-y-auto overscroll-contain"
            data-testid="notifications-scroll"
          >
            <ul className="divide-y">
              {latest.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onToggleRead={(read) => markRead.mutate({ ids: [n.id], read })}
                />
              ))}
            </ul>
          </div>
        )}

        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full justify-center text-xs">
            <Link to="/admin/notifications" onClick={() => setOpen(false)}>
              View all notifications
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
