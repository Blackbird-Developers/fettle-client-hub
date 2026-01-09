import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Lock } from "lucide-react";
import { useAchievementsWithStatus, useCheckAndAwardAchievements } from "@/hooks/useAchievements";
import { format } from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AchievementBadges() {
  // Check and award achievements on render
  useCheckAndAwardAchievements();

  const { achievements, isLoading, earnedCount, totalCount } = useAchievementsWithStatus();

  if (isLoading) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardHeader className="pb-2">
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const earnedAchievements = achievements.filter((a) => a.isEarned);
  const unearnedAchievements = achievements.filter((a) => !a.isEarned);

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Achievements
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {earnedCount}/{totalCount} Earned
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Earned Badges */}
        {earnedAchievements.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Unlocked
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-4 gap-2">
              {earnedAchievements.map((achievement) => (
                <Tooltip key={achievement.id}>
                  <TooltipTrigger asChild>
                    <div
                      className={`relative flex flex-col items-center justify-center p-3 rounded-lg bg-gradient-to-br ${achievement.color} text-white cursor-pointer transition-transform hover:scale-105 shadow-md`}
                    >
                      <span className="text-2xl">{achievement.icon}</span>
                      <span className="text-[10px] font-medium mt-1 text-center leading-tight line-clamp-2">
                        {achievement.title}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    <div className="space-y-1">
                      <p className="font-semibold">{achievement.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {achievement.description}
                      </p>
                      {achievement.earnedAt && (
                        <p className="text-xs text-primary">
                          Earned {format(new Date(achievement.earnedAt), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {/* Locked Badges */}
        {unearnedAchievements.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Locked
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-4 gap-2">
              {unearnedAchievements.map((achievement) => (
                <Tooltip key={achievement.id}>
                  <TooltipTrigger asChild>
                    <div className="relative flex flex-col items-center justify-center p-3 rounded-lg bg-muted/50 border border-border/50 cursor-pointer transition-all hover:bg-muted">
                      <div className="relative">
                        <span className="text-2xl opacity-30 grayscale">
                          {achievement.icon}
                        </span>
                        <Lock className="absolute -bottom-1 -right-1 h-3 w-3 text-muted-foreground" />
                      </div>
                      <span className="text-[10px] font-medium mt-1 text-center leading-tight text-muted-foreground line-clamp-2">
                        {achievement.title}
                      </span>
                      <Progress
                        value={achievement.progress}
                        className="h-1 mt-1.5 w-full"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[200px]">
                    <div className="space-y-1">
                      <p className="font-semibold">{achievement.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {achievement.description}
                      </p>
                      <p className="text-xs">
                        Progress: {achievement.current}/{achievement.threshold}{" "}
                        {achievement.type === "sessions" ? "sessions" : "months"}
                      </p>
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {earnedAchievements.length === 0 && (
          <div className="text-center py-4">
            <Trophy className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">
              Complete sessions to unlock achievements!
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
