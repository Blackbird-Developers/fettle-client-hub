import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAdminNotificationsPage, useMarkNotificationsRead } from "@/hooks/useAdminNotifications";
import { NOTIFICATIONS_PAGE_SIZE } from "@/lib/adminNotifications";
import { isMissingTableError } from "@/lib/customerFollowups";
import { NotificationItem } from "./NotificationItem";
import { TablePagination } from "./TablePagination";

const SEARCH_DELAY_MS = 300;

// Every notification, newest first, 25 per page. Opened from the bell's
// "View all notifications"; filtering and paging happen in the database.
export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isFetching, error } = useAdminNotificationsPage({ page, unreadOnly, search });
  const markRead = useMarkNotificationsRead();
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));
  const anyUnread = rows.some((r) => !r.read_at);

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            value={unreadOnly ? "unread" : "all"}
            onValueChange={(value) => {
              if (!value) return;
              setUnreadOnly(value === "unread");
              setPage(1);
            }}
          >
            <ToggleGroupItem value="all" variant="outline" size="sm">
              All
            </ToggleGroupItem>
            <ToggleGroupItem value="unread" variant="outline" size="sm">
              Unread
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search name, email or code"
              aria-label="Search notifications"
              className="pl-8 h-9 w-64 max-w-full"
            />
          </div>
          {isFetching && !isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        {anyUnread && (
          <Button variant="outline" size="sm" onClick={() => markRead.mutate({ allUnread: true })}>
            Mark all read
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">
            {isMissingTableError(error)
              ? "Notifications aren't switched on yet (the admin_notifications table hasn't been added)."
              : "Couldn't load notifications. Try again in a moment."}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">
            {search || unreadOnly ? "No notifications match." : "No notifications yet."}
          </p>
        ) : (
          <>
            <ul className="divide-y border-t">
              {rows.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  onToggleRead={(read) => markRead.mutate({ ids: [n.id], read })}
                />
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {(page - 1) * NOTIFICATIONS_PAGE_SIZE + 1}–{(page - 1) * NOTIFICATIONS_PAGE_SIZE + rows.length} of{" "}
                {total}
              </p>
              <TablePagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
