import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface UserPackage {
  id: string;
  user_id: string;
  package_id: string;
  package_name: string;
  total_sessions: number;
  remaining_sessions: number;
  amount_paid: number;
  stripe_session_id: string | null;
  purchased_at: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useUserPackages() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['user-packages', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from('user_packages')
        .select('*')
        .eq('user_id', user.id)
        .order('purchased_at', { ascending: false });

      if (error) {
        console.error('Error fetching user packages:', error);
        throw error;
      }

      return data as UserPackage[];
    },
    enabled: !!user?.id,
  });
}

export function useActivePackages() {
  const { data: packages, ...rest } = useUserPackages();

  // Filter to only packages with remaining sessions
  // Note: Credits don't expire, so we don't filter by expires_at
  const activePackages = packages?.filter(pkg => {
    if (pkg.remaining_sessions <= 0) return false;
    return true;
  }) || [];

  // Calculate total remaining sessions across all active packages
  const totalRemainingSessions = activePackages.reduce(
    (sum, pkg) => sum + pkg.remaining_sessions,
    0
  );

  return {
    packages: activePackages,
    totalRemainingSessions,
    ...rest,
  };
}

export function usePackageStats() {
  const { data: packages, ...rest } = useUserPackages();

  // All packages (including depleted)
  const allPackages = packages || [];
  
  // Active packages with remaining sessions
  const activePackages = allPackages.filter(pkg => pkg.remaining_sessions > 0);
  
  // Depleted packages (had sessions, now at 0)
  const depletedPackages = allPackages.filter(pkg => pkg.remaining_sessions === 0);

  // Calculate totals
  const totalRemainingSessions = activePackages.reduce(
    (sum, pkg) => sum + pkg.remaining_sessions,
    0
  );

  const totalSessionsUsed = allPackages.reduce(
    (sum, pkg) => sum + (pkg.total_sessions - pkg.remaining_sessions),
    0
  );

  const totalSessionsPurchased = allPackages.reduce(
    (sum, pkg) => sum + pkg.total_sessions,
    0
  );

  // Has ever purchased a package
  const hasPackageHistory = allPackages.length > 0;
  
  // Has active credits
  const hasActiveCredits = totalRemainingSessions > 0;
  
  // Has depleted all credits (had packages but none remaining)
  const allCreditsDepleted = hasPackageHistory && !hasActiveCredits;

  return {
    allPackages,
    activePackages,
    depletedPackages,
    totalRemainingSessions,
    totalSessionsUsed,
    totalSessionsPurchased,
    hasPackageHistory,
    hasActiveCredits,
    allCreditsDepleted,
    ...rest,
  };
}
