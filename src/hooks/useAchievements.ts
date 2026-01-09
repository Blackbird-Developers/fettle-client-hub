import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAcuityAppointments } from "@/hooks/useAcuity";
import { useEffect } from "react";
import { differenceInDays, startOfMonth, isSameMonth } from "date-fns";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  threshold: number;
  type: "sessions" | "streak" | "packages";
  color: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_session",
    title: "First Steps",
    description: "Complete your first session",
    icon: "🌟",
    threshold: 1,
    type: "sessions",
    color: "from-yellow-400 to-amber-500",
  },
  {
    id: "five_sessions",
    title: "Getting Started",
    description: "Complete 5 sessions",
    icon: "🔥",
    threshold: 5,
    type: "sessions",
    color: "from-orange-400 to-red-500",
  },
  {
    id: "ten_sessions",
    title: "Dedicated",
    description: "Complete 10 sessions",
    icon: "💪",
    threshold: 10,
    type: "sessions",
    color: "from-blue-400 to-indigo-500",
  },
  {
    id: "twenty_five_sessions",
    title: "Committed",
    description: "Complete 25 sessions",
    icon: "🏆",
    threshold: 25,
    type: "sessions",
    color: "from-purple-400 to-pink-500",
  },
  {
    id: "fifty_sessions",
    title: "Champion",
    description: "Complete 50 sessions",
    icon: "👑",
    threshold: 50,
    type: "sessions",
    color: "from-amber-400 to-yellow-500",
  },
  {
    id: "one_month_streak",
    title: "Monthly Warrior",
    description: "Maintain a 1-month streak",
    icon: "📅",
    threshold: 1,
    type: "streak",
    color: "from-green-400 to-emerald-500",
  },
  {
    id: "three_month_streak",
    title: "Consistency King",
    description: "Maintain a 3-month streak",
    icon: "🎯",
    threshold: 3,
    type: "streak",
    color: "from-teal-400 to-cyan-500",
  },
  {
    id: "six_month_streak",
    title: "Unstoppable",
    description: "Maintain a 6-month streak",
    icon: "⚡",
    threshold: 6,
    type: "streak",
    color: "from-violet-400 to-purple-500",
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
