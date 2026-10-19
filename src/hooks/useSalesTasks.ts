import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useIsAdmin } from "@/hooks/useAdmin";
import { isMissingTableError } from "@/lib/customerFollowups";
import { type SalesTask, HISTORY_DAYS, countDueTasks, todayInIreland } from "@/lib/salesTasks";

// Data for the admin Sales Tasks page. Tasks are read straight from the
// database (admin-only RLS); every change goes through a database function
// that checks the admin role and logs the change for reporting.

const TASKS_KEY = ["sales-tasks"];
const FOLLOWUPS_KEY = ["customer-followups"];
type DbError = { code?: string; message: string };

const noRetryIfMissing = (failureCount: number, error: DbError) =>
  !isMissingTableError(error) && failureCount < 2;

/** Every open task (today's and later ones). */
export function useSalesTasks() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<SalesTask[], DbError>({
    queryKey: [...TASKS_KEY, "open"],
    queryFn: async () => {
      const rows: SalesTask[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from("sales_tasks")
          .select("*")
          .eq("status", "pending")
          .order("id")
          .range(from, from + 999);
        if (error) throw error;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      return rows;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    retry: noRetryIfMissing,
  });
}

/** Tasks finished in the last HISTORY_DAYS days, newest first. */
export function useSalesTaskHistory(enabled: boolean) {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<SalesTask[], DbError>({
    queryKey: [...TASKS_KEY, "history"],
    queryFn: async () => {
      const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("sales_tasks")
        .select("*")
        .neq("status", "pending")
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
    enabled: enabled && isAdmin === true,
    staleTime: 1000 * 60,
    retry: noRetryIfMissing,
  });
}

/** The latest daily run (when the list was last prepared). */
export function useSalesTaskRun() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<Tables<"sales_task_runs"> | null, DbError>({
    queryKey: [...TASKS_KEY, "run"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_task_runs")
        .select("*")
        .order("run_on", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    retry: noRetryIfMissing,
  });
}

/** Open tasks due today or earlier, for the sidebar badge (0 until loaded). */
export function useSalesTasksDueCount(): number {
  const { data } = useSalesTasks();
  return data ? countDueTasks(data, todayInIreland()) : 0;
}

/** The run can take a couple of minutes (it reads Acuity). */
const PREPARE_TIMEOUT_MS = 180_000;

// Runs the daily preparation now ("Prepare today's list" / "Refresh").
// Safe to repeat: the function never duplicates tasks.
export function usePrepareSalesTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("You're signed out. Sign in again and retry.");

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PREPARE_TIMEOUT_MS);
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sales-tasks`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: "{}",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (response.status === 404) {
          throw new Error("Available once the sales-tasks function is deployed.");
        }
        if (!response.ok || body.error) {
          throw new Error(body.error ?? `Couldn't prepare the list (HTTP ${response.status}).`);
        }
        return body as { runOn: string; summary: Record<string, number> };
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("This is taking longer than usual. Check back in a few minutes.");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useCompleteSalesTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      const { data, error } = await supabase.rpc("complete_sales_task", { p_task_id: taskId });
      if (error) throw error;
      return data;
    },
    // Leaves the list straight away; back if the save fails.
    onMutate: async (taskId) => {
      const key = [...TASKS_KEY, "open"];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SalesTask[]>(key);
      queryClient.setQueryData<SalesTask[]>(key, (rows) => rows?.filter((row) => row.id !== taskId));
      return { previous };
    },
    onError: (_error, _taskId, context) => {
      queryClient.setQueryData([...TASKS_KEY, "open"], context?.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useReopenSalesTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (taskId: string) => {
      const { data, error } = await supabase.rpc("reopen_sales_task", { p_task_id: taskId });
      if (error) throw error;
      return data;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

export function useSetSalesTaskDue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, dueOn }: { taskId: string; dueOn: string }) => {
      const { data, error } = await supabase.rpc("set_sales_task_due", {
        p_task_id: taskId,
        p_due_on: dueOn,
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: TASKS_KEY }),
  });
}

// The note is the customer's shared note (customer_followups), so the other
// admin pages show the same text.
export function useUpdateSalesTaskNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, note }: { taskId: string; note: string }) => {
      const { data, error } = await supabase.rpc("update_sales_task_note", {
        p_task_id: taskId,
        p_note: note,
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: FOLLOWUPS_KEY }),
  });
}
