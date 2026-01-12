import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ApiError, classifyApiError } from "@/lib/api-errors";

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
