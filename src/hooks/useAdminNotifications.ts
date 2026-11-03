import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useAdmin";
import { isMissingTableError } from "@/lib/customerFollowups";
import type { AdminNotification } from "@/lib/adminNotifications";

const ADMIN_NOTIFICATIONS_QUERY_KEY = ["admin-notifications"];
// The bell shows the latest ones; older ones stay in the table.
const NOTIFICATIONS_SHOWN = 100;

// Read straight from the table; RLS limits it to admins. Checked every few
// minutes so new problems show up without a reload.
export function useAdminNotifications() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<AdminNotification[], { code?: string; message: string }>({
    queryKey: ADMIN_NOTIFICATIONS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_notifications")
        .select("id, created_at, kind, title, body, client_email, client_name, details, read_at, read_by_email")
        .order("created_at", { ascending: false })
        .limit(NOTIFICATIONS_SHOWN);
      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    refetchInterval: 1000 * 60 * 3,
    // Missing table = migration not applied yet; retrying won't help.
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

// Marks notifications read (or unread again). Updates the cached list
// straight away and rolls back if the save fails. The database stamps who
// read it and when.
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ids, read }: { ids: string[]; read: boolean }) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("admin_notifications")
        .update({ read_at: read ? new Date().toISOString() : null })
        .in("id", ids);
      if (error) throw error;
    },
    onMutate: async ({ ids, read }) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_NOTIFICATIONS_QUERY_KEY });
      const previous = queryClient.getQueryData<AdminNotification[]>(ADMIN_NOTIFICATIONS_QUERY_KEY);
      const now = new Date().toISOString();
      queryClient.setQueryData<AdminNotification[]>(ADMIN_NOTIFICATIONS_QUERY_KEY, (rows) =>
        rows?.map((row) => (ids.includes(row.id) ? { ...row, read_at: read ? now : null } : row))
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(ADMIN_NOTIFICATIONS_QUERY_KEY, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ADMIN_NOTIFICATIONS_QUERY_KEY }),
  });
}
