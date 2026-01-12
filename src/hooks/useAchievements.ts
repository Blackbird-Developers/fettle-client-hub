import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAcuityAppointments } from "@/hooks/useAcuity";
import { useEffect } from "react";
import { differenceInDays, startOfMonth, isSameMonth } from "date-fns";

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
  const { appointments } = useAcuityAppointments();
  const { data: userAchievements } = useUserAchievements();
  const awardAchievement = useAwardAchievement();

  useEffect(() => {
    if (!user?.id || !appointments || appointments.length === 0 || !userAchievements) return;

    const earnedIds = new Set(userAchievements.map((a) => a.achievement_id));
    const now = new Date();

    // Calculate completed sessions
    const completedSessions = appointments.filter((apt) => {
      const aptDate = new Date(apt.datetime);
      return aptDate < now;
    }).length;

    // Calculate streak (months with at least one session)
    const sessionsByMonth = new Map<string, boolean>();
    appointments.forEach((apt) => {
      const aptDate = new Date(apt.datetime);
      if (aptDate < now) {
        const monthKey = `${aptDate.getFullYear()}-${aptDate.getMonth()}`;
        sessionsByMonth.set(monthKey, true);
      }
    });

    // Count consecutive months
    let streakMonths = 0;
    let checkDate = startOfMonth(now);
    while (true) {
      const monthKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}`;
      if (sessionsByMonth.has(monthKey)) {
        streakMonths++;
        checkDate = new Date(checkDate.getFullYear(), checkDate.getMonth() - 1, 1);
      } else {
        break;
      }
    }

    // Check and award achievements
    ACHIEVEMENTS.forEach((achievement) => {
      if (earnedIds.has(achievement.id)) return;

      let shouldAward = false;

      if (achievement.type === "sessions" && completedSessions >= achievement.threshold) {
        shouldAward = true;
      } else if (achievement.type === "streak" && streakMonths >= achievement.threshold) {
        shouldAward = true;
      }

      if (shouldAward) {
        awardAchievement.mutate(achievement.id);
      }
    });
  }, [user?.id, appointments, userAchievements, awardAchievement]);
}

export function useAchievementsWithStatus() {
  const { data: userAchievements, isLoading } = useUserAchievements();
  const { appointments } = useAcuityAppointments();

  const earnedIds = new Set(userAchievements?.map((a) => a.achievement_id) || []);
  const now = new Date();

  // Calculate progress
  const completedSessions = appointments?.filter((apt) => {
    const aptDate = new Date(apt.datetime);
    return aptDate < now;
  }).length || 0;

  // Calculate streak
  const sessionsByMonth = new Map<string, boolean>();
  appointments?.forEach((apt) => {
    const aptDate = new Date(apt.datetime);
    if (aptDate < now) {
      const monthKey = `${aptDate.getFullYear()}-${aptDate.getMonth()}`;
      sessionsByMonth.set(monthKey, true);
    }
  });

  let streakMonths = 0;
  let checkDate = startOfMonth(now);
  while (true) {
    const monthKey = `${checkDate.getFullYear()}-${checkDate.getMonth()}`;
    if (sessionsByMonth.has(monthKey)) {
      streakMonths++;
      checkDate = new Date(checkDate.getFullYear(), checkDate.getMonth() - 1, 1);
    } else {
      break;
    }
  }

  const achievementsWithStatus = ACHIEVEMENTS.map((achievement) => {
    const isEarned = earnedIds.has(achievement.id);
    let progress = 0;
    let current = 0;

    if (achievement.type === "sessions") {
      current = completedSessions;
      progress = Math.min((completedSessions / achievement.threshold) * 100, 100);
    } else if (achievement.type === "streak") {
      current = streakMonths;
      progress = Math.min((streakMonths / achievement.threshold) * 100, 100);
    }

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
    isLoading,
    earnedCount: earnedIds.size,
    totalCount: ACHIEVEMENTS.length,
  };
}
