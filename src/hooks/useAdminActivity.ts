import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ACTIVITY_PAGE_SIZE, type ActivityRow } from "@/lib/adminActivity";
import { notificationSearchTerm } from "@/lib/adminNotifications";

// Data for the admin Activity log. Admins only (RLS, and the functions
// check the admin role).

const KEY = ["admin-activity"];
type DbError = { code?: string; message: string };

export interface ActivityQuery {
  page: number;
  from: string;
  to: string;
  /** Staff email, or "" for everyone. */
  actor: string;
  /** Action id, or "" for every action. */
  action: string;
  /** Customer name, email or phone. */
  search: string;
}

export function useActivityPage({ page, from, to, actor, action, search }: ActivityQuery, enabled: boolean) {
  const term = notificationSearchTerm(search);

  return useQuery<{ rows: ActivityRow[]; total: number }, DbError>({
    queryKey: [...KEY, "page", page, from, to, actor, action, term],
    queryFn: async () => {
      const start = (page - 1) * ACTIVITY_PAGE_SIZE;
      let query = supabase
        .from("admin_activity")
        .select("*", { count: "exact" })
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: false })
        .range(start, start + ACTIVITY_PAGE_SIZE - 1);
      if (actor) query = query.eq("actor_email", actor);
      if (action) query = query.eq("action", action);
      if (term) {
        const like = `%${term}%`;
        query = query.or(`customer_name.ilike.${like},customer_key.ilike.${like}`);
      }
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, total: count ?? data.length };
    },
    enabled,
    staleTime: 1000 * 30,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export interface ActivitySummaryRow {
  actor_email: string;
  total: number;
  tasks_completed: number;
  outcomes_logged: number;
  notes_edited: number;
  last_active: string;
}

/** Per staff member, for the chosen range. */
export function useActivitySummary(from: string, to: string, enabled: boolean) {
  return useQuery<ActivitySummaryRow[], DbError>({
    queryKey: [...KEY, "summary", from, to],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_activity_summary", { p_from: from, p_to: to });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        total: Number(row.total),
        tasks_completed: Number(row.tasks_completed),
        outcomes_logged: Number(row.outcomes_logged),
        notes_edited: Number(row.notes_edited),
      }));
    },
    enabled,
    staleTime: 1000 * 30,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** Everyone who appears in the log, for the staff filter. */
export function useActivityActors(enabled: boolean) {
  return useQuery<string[], DbError>({
    queryKey: [...KEY, "actors"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_activity_actors");
      if (error) throw error;
      return (data ?? []).map((row) => row.actor_email);
    },
    enabled,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
}
