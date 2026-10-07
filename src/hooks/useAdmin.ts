import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, classifyApiError } from "@/lib/api-errors";
import { normalizeProgression } from "@/lib/customerInsights";
import {
  type CustomerFollowup,
  type FollowupPatch,
  NOTE_MAX_LENGTH,
  applyFollowupPatch,
  isMissingTableError,
  replaceFollowup,
} from "@/lib/customerFollowups";
import { appendNote, runWithConcurrency } from "@/lib/bulkFollowups";

const FOLLOWUPS_QUERY_KEY = ["customer-followups"];
import type {
  AdoptionView,
  GradeDefinition,
  ProgressionView,
} from "../../supabase/functions/admin-customer-insights/logic.ts";

// Types for admin metrics response
interface AdminMetricsResponse {
  revenue: {
    totalRevenue: number;
    thisMonthRevenue: number;
    lastMonthRevenue: number;
    monthOverMonthChange: number;
    totalPackagesSold: number;
    averagePackageValue: number;
    thisMonthPackages: number;
  };
  sessions: {
    totalCompleted: number;
    totalUpcoming: number;
    thisMonthCompleted: number;
    lastMonthCompleted: number;
    monthOverMonthGrowth: number;
    uniqueClientsThisMonth: number;
    firstTimersThisMonth: number;
    canceledThisMonth: number;
  };
  engagement: {
    totalActiveCredits: number;
    uniqueClients: number;
    activePackageHolders: number;
    clientsWithoutPackages: number;
  };
  retention: {
    totalClients: number;
    firstSession: number;
    secondSession: number;
    thirdSession: number;
    fourthSession: number;
    firstToSecondRate: number;
    secondToThirdRate: number;
    thirdToFourthRate: number;
  };
}

// Check if current user is admin
export function useIsAdmin() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["is-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;

      const { data, error } = await supabase.rpc("has_role", {
        check_role: "admin",
      });

      if (error) {
        console.error("Error checking admin role:", error);
        return false;
      }

      return data === true;
    },
    enabled: !!user?.id,
  });
}

// Get list of all admins
export function useAdminList() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ["admin-list"],
    queryFn: async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-roles?role=admin`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch admin list");
      }

      return response.json();
    },
    enabled: isAdmin === true,
  });
}

// Invite a new admin by email
export function useInviteAdmin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (email: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-roles`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email, role: "admin" }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to invite admin");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-list"] });
    },
  });
}

// Remove admin role
export function useRemoveAdmin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/user-roles`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userId, role: "admin" }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to remove admin");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-list"] });
    },
  });
}

// Main hook to fetch all admin metrics from the edge function
export function useAdminMetrics() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<AdminMetricsResponse, ApiError>({
    queryKey: ["admin-metrics"],
    queryFn: async (): Promise<AdminMetricsResponse> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw {
          type: "unauthorized",
          message: "Not authenticated",
          retryable: false,
        } as ApiError;
      }

      let response: Response;
      try {
        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-metrics`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (fetchError) {
        // Network/CORS errors throw before we get a response
        const apiError = classifyApiError(fetchError);
        throw apiError;
      }

      if (!response.ok) {
        const apiError = classifyApiError(
          new Error(`HTTP ${response.status}`),
          response
        );
        throw apiError;
      }

      const data = await response.json();

      if (data.error) {
        throw {
          type: "server_error",
          message: data.error,
          retryable: true,
        } as ApiError;
      }

      return data as AdminMetricsResponse;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: (failureCount, error) => {
      // Don't retry auth/permission/cors/network errors
      const nonRetryableTypes = ["unauthorized", "forbidden", "cors", "network"];
      if (error?.type && nonRetryableTypes.includes(error.type)) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

// Get all clients/profiles (admin only)
export function useAllClients() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ["all-clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
  });
}

// Get all packages (admin only) - still useful for detailed package list
export function useAllPackages() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery({
    queryKey: ["all-packages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_packages")
        .select(`
          *,
          profiles:user_id (
            email,
            first_name,
            last_name
          )
        `)
        .order("purchased_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
  });
}

// Retention funnel - uses edge function data
export function useRetentionFunnel() {
  const { data, isLoading, error } = useAdminMetrics();

  const funnel = data?.retention ?? {
    totalClients: 0,
    firstSession: 0,
    secondSession: 0,
    thirdSession: 0,
    fourthSession: 0,
    firstToSecondRate: 0,
    secondToThirdRate: 0,
    thirdToFourthRate: 0,
  };

  return { funnel, loading: isLoading, error: error ?? null };
}

// Revenue metrics - uses edge function data
export function useRevenueMetrics() {
  const { data, isLoading, error } = useAdminMetrics();

  const metrics = data?.revenue ?? {
    totalRevenue: 0,
    thisMonthRevenue: 0,
    lastMonthRevenue: 0,
    monthOverMonthChange: 0,
    totalPackagesSold: 0,
    averagePackageValue: 0,
    thisMonthPackages: 0,
  };

  return { metrics, isLoading, error: error ?? null };
}

// Session metrics - uses edge function data
export function useSessionMetrics() {
  const { data, isLoading, error } = useAdminMetrics();

  const metrics = data?.sessions ?? {
    totalCompleted: 0,
    totalUpcoming: 0,
    thisMonthCompleted: 0,
    lastMonthCompleted: 0,
    monthOverMonthGrowth: 0,
    uniqueClientsThisMonth: 0,
    firstTimersThisMonth: 0,
    canceledThisMonth: 0,
  };

  return { metrics, loading: isLoading, error: error ?? null };
}

// Engagement stats - uses edge function data
export function useEngagementStats() {
  const { data, isLoading, error } = useAdminMetrics();

  const stats = data?.engagement ?? {
    totalActiveCredits: 0,
    uniqueClients: 0,
    activePackageHolders: 0,
    clientsWithoutPackages: 0,
  };

  return { stats, isLoading, error: error ?? null };
}

// Response of the admin-customer-insights edge function (row types come from
// the function's own logic module so the two can't drift apart).
export interface CustomerInsightsResponse {
  generatedAt: string;
  activeWindowDays: number;
  progressionPeriods: number[];
  adoption: AdoptionView & { legend: GradeDefinition[] };
  /** One view per range: Session 1–2, 2–3, 3–4, 4–5. */
  progression: (ProgressionView & { legend: GradeDefinition[] })[];
  dataIssues: {
    incompleteDates: string[];
    unknownTypes: { type: string; count: number }[];
    customersWithoutEmail: number;
    customersWithoutPhone: number;
    unverifiedHistory: number;
  };
  diagnostics: {
    windowAppointments: number;
    customersInWindow: number;
    historyLookups: number;
    acuityRequests: number;
    durationMs: number;
  };
}

// Portal adoption + session-to-session progression, built from Acuity.
// One request feeds every admin insights page. It can take a while (it walks Acuity
// history), so it is cached and never refetched on window focus.
export function useCustomerInsights() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<CustomerInsightsResponse, ApiError>({
    queryKey: ["admin-customer-insights"],
    queryFn: async (): Promise<CustomerInsightsResponse> => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw {
          type: "unauthorized",
          message: "Not authenticated",
          retryable: false,
        } as ApiError;
      }

      let response: Response;
      try {
        response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-customer-insights`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (fetchError) {
        throw classifyApiError(fetchError);
      }

      if (!response.ok) {
        throw classifyApiError(new Error(`HTTP ${response.status}`), response);
      }

      const data = await response.json();

      if (data.error) {
        throw {
          type: "server_error",
          message: data.error,
          retryable: true,
        } as ApiError;
      }

      return { ...data, progression: normalizeProgression(data.progression) } as CustomerInsightsResponse;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => {
      const nonRetryableTypes = ["unauthorized", "forbidden", "cors", "network"];
      if (error?.type && nonRetryableTypes.includes(error.type)) {
        return false;
      }
      return failureCount < 1;
    },
  });
}

// Staff follow-up (contacted + note) per customer on the Progression pages.
// Read and written straight from the table; RLS limits both to admins.
export function useCustomerFollowups() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<CustomerFollowup[], { code?: string; message: string }>({
    queryKey: FOLLOWUPS_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_followups").select("*");
      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
    staleTime: 1000 * 60,
    // Missing table = migration not applied yet; retrying won't help.
    retry: (failureCount, error) => !isMissingTableError(error) && failureCount < 2,
  });
}

// Shared by the single-row and bulk saves.
async function saveFollowup(customerKey: string, patch: FollowupPatch) {
  const { data, error } = await supabase
    .from("customer_followups")
    .upsert({ customer_key: customerKey, ...patch }, { onConflict: "customer_key" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Adds a bulk note below the customer's current note. Reads the latest note
// first and only writes if it hasn't changed since, so a colleague's edit
// made in the meantime is never overwritten (that customer fails instead).
async function appendFollowupNote(customerKey: string, text: string, author: string | null) {
  const { data: current, error: readError } = await supabase
    .from("customer_followups")
    .select("note")
    .eq("customer_key", customerKey)
    .maybeSingle();
  if (readError) throw readError;

  const note = appendNote(current?.note, text, author);
  if (note.length > NOTE_MAX_LENGTH) {
    throw { message: `Their note would go over ${NOTE_MAX_LENGTH} characters.` };
  }

  const changedMeanwhile = { message: "Someone else changed this note just now. Try again." };
  if (!current) {
    const { data, error } = await supabase
      .from("customer_followups")
      .insert({ customer_key: customerKey, note })
      .select()
      .single();
    // 23505: a row for this customer was created since we looked.
    if (error) throw error.code === "23505" ? changedMeanwhile : error;
    return data;
  }

  const update = supabase
    .from("customer_followups")
    .update({ note })
    .eq("customer_key", customerKey);
  const { data, error } = await (current.note === null
    ? update.is("note", null)
    : update.eq("note", current.note)
  )
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw changedMeanwhile;
  return data;
}

export type BulkFollowupAction =
  | { kind: "contacted"; contacted: boolean }
  | { kind: "appendNote"; text: string };

/** Customers saved at once by a bulk action. */
export const BULK_CONCURRENCY = 4;

// Applies one action to many customers, a few at a time. Never throws: the
// result says which customers saved and which failed. Saved rows go into the
// table as each one lands; failed ones keep their previous values.
export function useBulkUpdateFollowups() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ keys, action }: { keys: string[]; action: BulkFollowupAction }) => {
      setProgress({ done: 0, total: keys.length });
      const save =
        action.kind === "contacted"
          ? (key: string) => saveFollowup(key, { contacted: action.contacted })
          : (key: string) => appendFollowupNote(key, action.text, user?.email ?? null);
      return runWithConcurrency(
        keys,
        BULK_CONCURRENCY,
        async (key) => {
          const saved = await save(key);
          queryClient.setQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY, (rows) =>
            replaceFollowup(rows ?? [], saved)
          );
          return saved;
        },
        (done, total) => setProgress({ done, total })
      );
    },
    onSettled: () => setProgress(null),
  });

  return { run: mutation.mutateAsync, isPending: mutation.isPending, progress };
}

// Saves one customer's contacted status or note. The table updates
// straight away and rolls back if the save fails.
export function useUpdateFollowup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ customerKey, patch }: { customerKey: string; patch: FollowupPatch }) =>
      saveFollowup(customerKey, patch),
    onMutate: async ({ customerKey, patch }) => {
      await queryClient.cancelQueries({ queryKey: FOLLOWUPS_QUERY_KEY });
      const previous = queryClient.getQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY);
      queryClient.setQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY, (rows) =>
        applyFollowupPatch(rows ?? [], customerKey, patch)
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(FOLLOWUPS_QUERY_KEY, context?.previous);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<CustomerFollowup[]>(FOLLOWUPS_QUERY_KEY, (rows) =>
        replaceFollowup(rows ?? [], saved)
      );
    },
  });
}
