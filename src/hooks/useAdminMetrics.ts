import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AdminMetrics {
  totalUsers: number;
  usersThisMonth: number;
  usersLastMonth: number;
  totalClients: number;
  retentionFunnel: {
    firstSession: number;
    secondSession: number;
    thirdSession: number;
    fourthPlusSession: number;
  };
  retentionRates: {
    firstToSecond: number;
    secondToThird: number;
    thirdToFourth: number;
  };
  firstTimersThisMonth: number;
  completedSessionsThisMonth: number;
  completedSessionsLastMonth: number;
  sessionGrowth: number;
  upcomingAppointments: number;
  totalPackageRevenue: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  revenueGrowth: number;
  packagesThisMonth: number;
  averagePackageValue: number;
  totalActiveCredits: number;
  totalPackagesSold: number;
}

export function useIsAdmin() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['isAdmin', user?.id],
    queryFn: async () => {
      if (!user) return false;
      
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();

      if (error) {
        console.error('Error checking admin status:', error);
        return false;
      }

      return !!data;
    },
    enabled: !!user,
  });
}

export function useAdminMetrics() {
  const { data: isAdmin } = useIsAdmin();

  return useQuery<AdminMetrics>({
    queryKey: ['adminMetrics'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('admin-metrics', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to fetch metrics');
      }

      return response.data;
    },
    enabled: isAdmin === true,
    refetchInterval: 60000, // Refresh every minute
  });
}
