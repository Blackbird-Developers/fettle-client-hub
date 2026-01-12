import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useMemo } from "react";
import { startOfMonth, endOfMonth, subMonths, isAfter, isBefore, parseISO } from "date-fns";

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
      const { data, error } = await supabase
        .from("user_roles")
        .select(`
          id,
          user_id,
          role,
          created_at,
          profiles:user_id (
            email,
            first_name,
            last_name
          )
        `)
        .eq("role", "admin")
        .order("created_at", { ascending: true });

      if (error) throw error;
      return data;
    },
    enabled: isAdmin === true,
  });
}

// Invite a new admin by email
export function useInviteAdmin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (email: string) => {
      if (!user?.id) throw new Error("Not authenticated");

      // First find the user by email
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("email", email.toLowerCase())
        .single();

      if (profileError || !profile) {
        throw new Error("User not found. They must have an account first.");
      }

      // Then add admin role
      const { data, error } = await supabase
        .from("user_roles")
        .insert({
          user_id: profile.id,
          role: "admin",
          created_by: user.id,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new Error("This user is already an admin.");
        }
        throw error;
      }

      return data;
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
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-list"] });
    },
  });
}

// Fetch all appointments (admin only) - for metrics
export function useAllAppointments() {
  const { data: isAdmin } = useIsAdmin();
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    const fetchAllAppointments = async () => {
      setLoading(true);
      try {
        // Fetch appointments without email filter to get ALL appointments
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/acuity?action=get-appointments`,
          {
            headers: {
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) {
          throw new Error("Failed to fetch appointments");
        }

        const data = await response.json();
        setAppointments(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load appointments");
      } finally {
        setLoading(false);
      }
    };

    fetchAllAppointments();
  }, [isAdmin]);

  return { appointments, loading, error };
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

// Get all packages (admin only)
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

// Calculate retention funnel from appointments
export function useRetentionFunnel() {
  const { appointments, loading } = useAllAppointments();

  const funnel = useMemo(() => {
    if (!appointments || appointments.length === 0) {
      return {
        totalClients: 0,
        firstSession: 0,
        secondSession: 0,
        thirdSession: 0,
        fourthSession: 0,
        firstToSecondRate: 0,
        secondToThirdRate: 0,
        thirdToFourthRate: 0,
      };
    }

    const now = new Date();

    // Group appointments by client email (completed only - past date and not canceled)
    const clientSessions = new Map<string, number>();

    appointments.forEach((apt: any) => {
      if (apt.canceled) return;
      const aptDate = parseISO(apt.datetime);
      if (isAfter(aptDate, now)) return; // Skip future appointments

      const email = apt.email.toLowerCase();
      clientSessions.set(email, (clientSessions.get(email) || 0) + 1);
    });

    const totalClients = clientSessions.size;
    let firstSession = 0;
    let secondSession = 0;
    let thirdSession = 0;
    let fourthSession = 0;

    clientSessions.forEach((count) => {
      if (count >= 1) firstSession++;
      if (count >= 2) secondSession++;
      if (count >= 3) thirdSession++;
      if (count >= 4) fourthSession++;
    });

    return {
      totalClients,
      firstSession,
      secondSession,
      thirdSession,
      fourthSession,
      firstToSecondRate: firstSession > 0 ? Math.round((secondSession / firstSession) * 100) : 0,
      secondToThirdRate: secondSession > 0 ? Math.round((thirdSession / secondSession) * 100) : 0,
      thirdToFourthRate: thirdSession > 0 ? Math.round((fourthSession / thirdSession) * 100) : 0,
    };
  }, [appointments]);

  return { funnel, loading };
}

// Calculate revenue metrics from packages
export function useRevenueMetrics() {
  const { data: packages, isLoading } = useAllPackages();

  const metrics = useMemo(() => {
    if (!packages || packages.length === 0) {
      return {
        totalRevenue: 0,
        thisMonthRevenue: 0,
        lastMonthRevenue: 0,
        monthOverMonthChange: 0,
        totalPackagesSold: 0,
        averagePackageValue: 0,
        thisMonthPackages: 0,
      };
    }

    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    let totalRevenue = 0;
    let thisMonthRevenue = 0;
    let lastMonthRevenue = 0;
    let thisMonthPackages = 0;

    packages.forEach((pkg: any) => {
      const purchaseDate = parseISO(pkg.purchased_at);
      const amount = pkg.amount_paid || 0;

      totalRevenue += amount;

      if (isAfter(purchaseDate, thisMonthStart)) {
        thisMonthRevenue += amount;
        thisMonthPackages++;
      } else if (isAfter(purchaseDate, lastMonthStart) && isBefore(purchaseDate, lastMonthEnd)) {
        lastMonthRevenue += amount;
      }
    });

    const monthOverMonthChange =
      lastMonthRevenue > 0
        ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
        : thisMonthRevenue > 0
        ? 100
        : 0;

    return {
      totalRevenue,
      thisMonthRevenue,
      lastMonthRevenue,
      monthOverMonthChange,
      totalPackagesSold: packages.length,
      averagePackageValue: packages.length > 0 ? Math.round(totalRevenue / packages.length) : 0,
      thisMonthPackages,
    };
  }, [packages]);

  return { metrics, isLoading };
}

// Calculate session metrics from appointments
export function useSessionMetrics() {
  const { appointments, loading } = useAllAppointments();

  const metrics = useMemo(() => {
    if (!appointments || appointments.length === 0) {
      return {
        totalCompleted: 0,
        totalUpcoming: 0,
        thisMonthCompleted: 0,
        lastMonthCompleted: 0,
        monthOverMonthGrowth: 0,
        uniqueClientsThisMonth: 0,
        firstTimersThisMonth: 0,
        canceledThisMonth: 0,
      };
    }

    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    let totalCompleted = 0;
    let totalUpcoming = 0;
    let thisMonthCompleted = 0;
    let lastMonthCompleted = 0;
    let canceledThisMonth = 0;

    const clientsThisMonth = new Set<string>();
    const clientsBeforeThisMonth = new Set<string>();

    appointments.forEach((apt: any) => {
      const aptDate = parseISO(apt.datetime);
      const email = apt.email.toLowerCase();

      if (apt.canceled) {
        if (isAfter(aptDate, thisMonthStart)) {
          canceledThisMonth++;
        }
        return;
      }

      if (isBefore(aptDate, now)) {
        totalCompleted++;

        if (isAfter(aptDate, thisMonthStart)) {
          thisMonthCompleted++;
          clientsThisMonth.add(email);
        } else {
          clientsBeforeThisMonth.add(email);
          if (isAfter(aptDate, lastMonthStart) && isBefore(aptDate, lastMonthEnd)) {
            lastMonthCompleted++;
          }
        }
      } else {
        totalUpcoming++;
      }
    });

    // First-timers: clients who have sessions this month but never before
    let firstTimersThisMonth = 0;
    clientsThisMonth.forEach((email) => {
      if (!clientsBeforeThisMonth.has(email)) {
        firstTimersThisMonth++;
      }
    });

    const monthOverMonthGrowth =
      lastMonthCompleted > 0
        ? Math.round(((thisMonthCompleted - lastMonthCompleted) / lastMonthCompleted) * 100)
        : thisMonthCompleted > 0
        ? 100
        : 0;

    return {
      totalCompleted,
      totalUpcoming,
      thisMonthCompleted,
      lastMonthCompleted,
      monthOverMonthGrowth,
      uniqueClientsThisMonth: clientsThisMonth.size,
      firstTimersThisMonth,
      canceledThisMonth,
    };
  }, [appointments]);

  return { metrics, loading };
}

// Calculate engagement stats
export function useEngagementStats() {
  const { data: packages, isLoading: packagesLoading } = useAllPackages();
  const { data: clients, isLoading: clientsLoading } = useAllClients();

  const stats = useMemo(() => {
    const totalCredits = packages?.reduce((sum: number, pkg: any) => sum + (pkg.remaining_sessions || 0), 0) || 0;
    const activePackageHolders = new Set(
      packages?.filter((pkg: any) => pkg.remaining_sessions > 0).map((pkg: any) => pkg.user_id)
    ).size;

    return {
      totalActiveCredits: totalCredits,
      uniqueClients: clients?.length || 0,
      activePackageHolders,
      clientsWithoutPackages: (clients?.length || 0) - activePackageHolders,
    };
  }, [packages, clients]);

  return { stats, isLoading: packagesLoading || clientsLoading };
}
