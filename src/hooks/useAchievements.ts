import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePackageStats } from "@/hooks/useUserPackages";
import { useEffect } from "react";

export interface AchievementReward {
  type: "message" | "discount" | "discount_priority";
  discountPercent?: number;
  stripeCouponId?: string;
  description: string;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  threshold: number;
  type: "sessions" | "streak" | "packages";
  color: string;
  reward: AchievementReward;
}

export const ACHIEVEMENTS: Achievement[] = [
  // Session-based achievements with rewards
  {
    id: "first_session",
    title: "First Step",
    description: "Complete your first session",
    icon: "⭐",
    threshold: 1,
    type: "sessions",
    color: "from-yellow-400 to-amber-500",
    reward: {
      type: "message",
      description: "Welcome message",
    },
  },
  {
    id: "three_sessions",
    title: "Getting Started",
    description: "Complete 3 sessions",
    icon: "⚡",
    threshold: 3,
    type: "sessions",
    color: "from-orange-400 to-yellow-500",
    reward: {
      type: "discount",
      discountPercent: 4,
      stripeCouponId: "FETTLELOYALTY4",
      description: "4% off next session",
    },
  },
  {
    id: "five_sessions",
    title: "Committed",
    description: "Complete 5 sessions",
    icon: "💙",
    threshold: 5,
    type: "sessions",
    color: "from-blue-400 to-indigo-500",
    reward: {
      type: "discount",
      discountPercent: 5,
      stripeCouponId: "FETTLELOYALTY5",
      description: "5% off next session",
    },
  },
  {
    id: "ten_sessions",
    title: "Consistent",
    description: "Complete 10 sessions",
    icon: "🏅",
    threshold: 10,
    type: "sessions",
    color: "from-purple-400 to-pink-500",
    reward: {
      type: "discount_priority",
      discountPercent: 8,
      stripeCouponId: "FETTLELOYALTY8",
      description: "8% off next session + priority booking",
    },
  },
  {
    id: "twenty_sessions",
    title: "Wellness Champion",
    description: "Complete 20 sessions",
    icon: "🏆",
    threshold: 20,
    type: "sessions",
    color: "from-amber-400 to-yellow-600",
    reward: {
      type: "discount",
      discountPercent: 10,
      stripeCouponId: "FETTLELOYALTY10",
      description: "10% off next session",
    },
  },
];

interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  achieved_at: string;
  created_at: string;
}

export function useUserAchievements() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["user-achievements", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("user_achievements")
        .select("*")
        .eq("user_id", user.id)
        .order("achieved_at", { ascending: false });

      if (error) throw error;
      return data as UserAchievement[];
    },
    enabled: !!user?.id,
  });
}

export function useAwardAchievement() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (achievementId: string) => {
      if (!user?.id) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("user_achievements")
        .insert({
          user_id: user.id,
          achievement_id: achievementId,
        })
        .select()
        .single();

      if (error) {
        // Ignore duplicate errors (achievement already earned)
        if (error.code === "23505") return null;
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-achievements"] });
    },
  });
}

export function useCheckAndAwardAchievements() {
  const { user } = useAuth();
  const { totalSessionsUsed, isLoading: packagesLoading } = usePackageStats();
  const { data: userAchievements } = useUserAchievements();
  const awardAchievement = useAwardAchievement();

  useEffect(() => {
    if (!user?.id || packagesLoading || !userAchievements) return;

    const earnedIds = new Set(userAchievements.map((a) => a.achievement_id));

    // Check and award achievements based on package credits used
    ACHIEVEMENTS.forEach((achievement) => {
      if (earnedIds.has(achievement.id)) return;

      let shouldAward = false;

      if (achievement.type === "sessions" && totalSessionsUsed >= achievement.threshold) {
        shouldAward = true;
      }
      // Streak achievements can be added later if needed

      if (shouldAward) {
        awardAchievement.mutate(achievement.id);
      }
    });
  }, [user?.id, totalSessionsUsed, packagesLoading, userAchievements, awardAchievement]);
}

export function useAchievementsWithStatus() {
  const { data: userAchievements, isLoading: achievementsLoading } = useUserAchievements();
  const { totalSessionsUsed, isLoading: packagesLoading } = usePackageStats();

  const earnedIds = new Set(userAchievements?.map((a) => a.achievement_id) || []);

  const achievementsWithStatus = ACHIEVEMENTS.map((achievement) => {
    const isEarned = earnedIds.has(achievement.id);
    let progress = 0;
    let current = 0;

    if (achievement.type === "sessions") {
      current = totalSessionsUsed;
      progress = Math.min((totalSessionsUsed / achievement.threshold) * 100, 100);
    }
    // Streak achievements can be added later if needed

    const earnedAt = userAchievements?.find((a) => a.achievement_id === achievement.id)?.achieved_at;

    return {
      ...achievement,
      isEarned,
      progress,
      current,
      earnedAt,
    };
  });

  return {
    achievements: achievementsWithStatus,
    isLoading: achievementsLoading || packagesLoading,
    earnedCount: earnedIds.size,
    totalCount: ACHIEVEMENTS.length,
  };
}
