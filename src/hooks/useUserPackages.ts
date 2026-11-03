import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

// Note: Acuity sync runs in AuthContext once per browser session, and again
// when a booking screen opens (useRefreshBundlesOnOpen below).

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

// Returns true if a package has an expiry date in the past
const isPackageExpired = (pkg: UserPackage): boolean =>
  pkg.expires_at !== null && new Date(pkg.expires_at) < new Date();

export function useActivePackages() {
  const { data: packages, ...rest } = useUserPackages();

  // Filter to only packages with remaining sessions that have not expired
  const activePackages = packages?.filter(pkg => {
    if (pkg.remaining_sessions <= 0) return false;
    if (isPackageExpired(pkg)) return false;
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

  // Active: has sessions remaining and not expired
  const activePackages = allPackages.filter(
    pkg => pkg.remaining_sessions > 0 && !isPackageExpired(pkg)
  );

  // Depleted: all sessions used up
  const depletedPackages = allPackages.filter(pkg => pkg.remaining_sessions === 0);

  // Expired but still had sessions remaining — user couldn't use them in time
  const expiredWithCreditsPackages = allPackages.filter(
    pkg => pkg.remaining_sessions > 0 && isPackageExpired(pkg)
  );

  // Calculate totals (only from non-expired active packages)
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

  // Has usable (non-expired) credits
  const hasActiveCredits = totalRemainingSessions > 0;

  // Has packages that expired with credits still on them
  const hasExpiredCredits = expiredWithCreditsPackages.length > 0;

  // All credits depleted: has history but no active or expired-with-credits packages
  const allCreditsDepleted = hasPackageHistory && !hasActiveCredits && !hasExpiredCredits;

  return {
    allPackages,
    activePackages,
    depletedPackages,
    expiredWithCreditsPackages,
    totalRemainingSessions,
    totalSessionsUsed,
    totalSessionsPurchased,
    hasPackageHistory,
    hasActiveCredits,
    hasExpiredCredits,
    allCreditsDepleted,
    ...rest,
  };
}

// Bundles bought on fettle.ie while already signed in to the hub only reach
// the account through sync-acuity-packages, which AuthContext runs once per
// browser session. Booking screens re-run it when they open (at most every
// couple of minutes) so a new bundle shows up without signing out and in.
const BUNDLE_REFRESH_MIN_GAP_MS = 2 * 60 * 1000;
let lastBundleRefreshAt = 0;
let bundleRefreshInFlight: Promise<void> | null = null;

export function useRefreshBundlesOnOpen(open: boolean) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;

  useEffect(() => {
    if (!open || !userId) return;
    if (bundleRefreshInFlight || Date.now() - lastBundleRefreshAt < BUNDLE_REFRESH_MIN_GAP_MS) return;
    lastBundleRefreshAt = Date.now();
    bundleRefreshInFlight = (async () => {
      try {
        const { error } = await supabase.functions.invoke('sync-acuity-packages');
        if (!error) {
          await queryClient.invalidateQueries({ queryKey: ['user-packages', userId] });
        }
      } catch {
        // Best effort: the bundles already on the account still show.
      } finally {
        bundleRefreshInFlight = null;
      }
    })();
  }, [open, userId, queryClient]);
}
