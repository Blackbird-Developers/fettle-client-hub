import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useAdmin";
import { isMissingTableError } from "@/lib/customerFollowups";
import {
  type AdminNotification,
  NOTIFICATIONS_PAGE_SIZE,
  notificationSearchTerm,
} from "@/lib/adminNotifications";
import { type DayRange, localDayBounds } from "@/lib/datePresets";

// Every notifications query starts with this key, so one invalidate refreshes
// the bell and the Notifications page together.
const ADMIN_NOTIFICATIONS_QUERY_KEY = ["admin-notifications"];
const BELL_QUERY_KEY = [...ADMIN_NOTIFICATIONS_QUERY_KEY, "bell"];
// The bell's unread badge counts within these; older ones are on the page.
const NOTIFICATIONS_SHOWN = 100;
const COLUMNS = "id, created_at, kind, title, body, client_email, client_name, details, read_at, read_by_email";

type DbError = { code?: string; message: string };
// Missing table = migration not applied yet; retrying won't help.
const retry = (failureCount: number, error: DbError) => !isMissingTableError(error) && failureCount < 2;

// Read straight from the table; RLS limits it to admins. Checked every few
// minutes so new problems show up without a reload.
export function useAdminNotifications() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<AdminNotification[], DbError>({
    queryKey: BELL_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_notifications")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .limit(NOTIFICATIONS_SHOWN);
      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60 * 3,
    retry,
  });
}

export interface NotificationsPageQuery {
  /** 1-based. */
  page: number;
  unreadOnly: boolean;
  search: string;
  /** Only notifications from these local days; null = any date. */
  range?: DayRange | null;
}

export interface NotificationsPage {
  rows: AdminNotification[];
  total: number;
}

/** One page of the Notifications page, filtered in the database. */
export function useAdminNotificationsPage({ page, unreadOnly, search, range = null }: NotificationsPageQuery) {
  const { data: isAdmin } = useIsAdmin();
  const term = notificationSearchTerm(search);

  return useQuery<NotificationsPage, DbError>({
    queryKey: [...ADMIN_NOTIFICATIONS_QUERY_KEY, "page", page, unreadOnly, term, range?.from, range?.to],
    queryFn: async () => {
      const from = (page - 1) * NOTIFICATIONS_PAGE_SIZE;
      let query = supabase
        .from("admin_notifications")
        .select(COLUMNS, { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, from + NOTIFICATIONS_PAGE_SIZE - 1);
      if (unreadOnly) query = query.is("read_at", null);
      if (term) {
        const like = `%${term}%`;
        query = query.or(
          `title.ilike.${like},client_email.ilike.${like},client_name.ilike.${like},body.ilike.${like}`
        );
      }
      if (range) {
        const bounds = localDayBounds(range);
        query = query.gte("created_at", bounds.from).lt("created_at", bounds.to);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, total: count ?? data.length };
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    placeholderData: keepPreviousData,
    retry,
  });
}

/** How many notifications match the filters in a period, for the comparison. */
export function useAdminNotificationCount(
  { unreadOnly, search, range }: Omit<NotificationsPageQuery, "page">,
  enabled: boolean
) {
  const { data: isAdmin } = useIsAdmin();
  const term = notificationSearchTerm(search);

  return useQuery<number, DbError>({
    queryKey: [...ADMIN_NOTIFICATIONS_QUERY_KEY, "count", unreadOnly, term, range?.from, range?.to],
    queryFn: async () => {
      let query = supabase.from("admin_notifications").select("id", { count: "exact", head: true });
      if (unreadOnly) query = query.is("read_at", null);
      if (term) {
        const like = `%${term}%`;
        query = query.or(
          `title.ilike.${like},client_email.ilike.${like},client_name.ilike.${like},body.ilike.${like}`
        );
      }
      if (range) {
        const bounds = localDayBounds(range);
        query = query.gte("created_at", bounds.from).lt("created_at", bounds.to);
      }
      const { error, count } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: enabled && isAdmin === true,
    staleTime: 1000 * 60,
    retry,
  });
}

/** `ids` marks those; `allUnread` marks every unread one in the table. */
export type MarkReadInput = { ids: string[]; read: boolean } | { allUnread: true };

function patchRows(rows: AdminNotification[], input: MarkReadInput, now: string): AdminNotification[] {
  if ("allUnread" in input) return rows.map((row) => (row.read_at ? row : { ...row, read_at: now }));
  return rows.map((row) =>
    input.ids.includes(row.id) ? { ...row, read_at: input.read ? now : null } : row
  );
}

// Marks notifications read (or unread again). Updates the bell and any loaded
// page straight away and rolls back if the save fails. The database stamps
// who read it and when.
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: MarkReadInput) => {
      const now = new Date().toISOString();
      if ("allUnread" in input) {
        const { error } = await supabase
          .from("admin_notifications")
          .update({ read_at: now })
          .is("read_at", null);
        if (error) throw error;
        return;
      }
      if (input.ids.length === 0) return;
      const { error } = await supabase
        .from("admin_notifications")
        .update({ read_at: input.read ? now : null })
        .in("id", input.ids);
      if (error) throw error;
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_NOTIFICATIONS_QUERY_KEY });
      const previous = queryClient.getQueriesData<AdminNotification[] | NotificationsPage>({
        queryKey: ADMIN_NOTIFICATIONS_QUERY_KEY,
      });
      const now = new Date().toISOString();
      queryClient.setQueriesData<AdminNotification[] | NotificationsPage>(
        { queryKey: ADMIN_NOTIFICATIONS_QUERY_KEY },
        (data) => {
          if (!data) return data;
          if (Array.isArray(data)) return patchRows(data, input, now);
          return { ...data, rows: patchRows(data.rows, input, now) };
        }
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ADMIN_NOTIFICATIONS_QUERY_KEY }),
  });
}
