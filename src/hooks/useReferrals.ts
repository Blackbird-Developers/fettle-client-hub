import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type ReferralFriendStatus = "pending" | "rewarded";

export interface ReferralFriend {
  id: string;
  name: string | null;
  masked_email: string | null;
  status: ReferralFriendStatus;
  created_at: string;
  credit_cents: number;
}

export interface ReferralOverview {
  code: string;
  reward_cents: number;
  balance_cents: number;
  friends_joined: number;
  pending: number;
  total_earned_cents: number;
  friends: ReferralFriend[];
}

/**
 * Loads the current user's Refer & Earn data from the `get_referral_overview`
 * RPC (code, credit balance, stats, and the list of referred friends).
 */
export function useReferrals() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["referral-overview", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<ReferralOverview> => {
      // Cast: the generated Supabase types don't yet include this RPC
      // (added in the 20260625120000_referrals migration).
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string
        ) => Promise<{ data: unknown; error: unknown }>
      )("get_referral_overview");
      if (error) throw error;
      return data as ReferralOverview;
    },
  });
}

/** Format cents as a euro string, e.g. 2000 -> "€20". */
export function formatEuros(cents: number): string {
  const euros = cents / 100;
  return Number.isInteger(euros) ? `€${euros}` : `€${euros.toFixed(2)}`;
}
