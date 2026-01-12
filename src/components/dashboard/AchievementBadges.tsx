import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Lock, Gift, Copy, Check, Sparkles } from "lucide-react";
import { useAchievementsWithStatus, useCheckAndAwardAchievements } from "@/hooks/useAchievements";
import { format } from "date-fns";
import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function AchievementBadges() {
  // Check and award achievements on render
  useCheckAndAwardAchievements();
  const { toast } = useToast();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const { achievements, isLoading, earnedCount, totalCount } = useAchievementsWithStatus();

  const copyToClipboard = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast({
        title: "Coupon copied!",
        description: `Use code ${code} at checkout for your discount.`,
      });
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      toast({
        title: "Failed to copy",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

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

  // Get the best available discount from earned achievements
  const availableDiscounts = earnedAchievements
    .filter((a) => a.reward.stripeCouponId)
    .sort((a, b) => (b.reward.discountPercent || 0) - (a.reward.discountPercent || 0));

  const bestDiscount = availableDiscounts[0];

  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" />
            Loyalty Rewards
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {earnedCount}/{totalCount} Earned
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Best Available Discount Banner */}
        {bestDiscount && (
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 border border-primary/20 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 bg-primary/10 rounded-full flex-shrink-0">
                  <Gift className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-primary">Your Best Reward</p>
                  <p className="text-sm font-semibold truncate">{bestDiscount.reward.description}</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="flex-shrink-0 gap-1.5 text-xs h-8"
                onClick={() => copyToClipboard(bestDiscount.reward.stripeCouponId!)}
              >
                {copiedCode === bestDiscount.reward.stripeCouponId ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy Code
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Earned Badges */}
        {earnedAchievements.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Unlocked Rewards
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-4 md:grid-cols-4 gap-2">
              {earnedAchievements.map((achievement) => (
                <Tooltip key={achievement.id}>
                  <TooltipTrigger asChild>
                    <div
                      className={`relative flex flex-col items-center justify-center p-3 rounded-lg bg-gradient-to-br ${achievement.color} text-white cursor-pointer transition-transform hover:scale-105 shadow-md`}
                    >
                      {achievement.reward.stripeCouponId && (
                        <div className="absolute -top-1 -right-1 bg-white rounded-full p-0.5 shadow-sm">
                          <Sparkles className="h-3 w-3 text-amber-500" />
                        </div>
                      )}
                      <span className="text-2xl">{achievement.icon}</span>
                      <span className="text-[10px] font-medium mt-1 text-center leading-tight line-clamp-2">
                        {achievement.title}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px]">
                    <div className="space-y-2">
                      <div>
                        <p className="font-semibold">{achievement.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {achievement.description}
                        </p>
                      </div>
                      <div className="pt-1 border-t border-border">
                        <p className="text-xs font-medium flex items-center gap-1">
                          <Gift className="h-3 w-3 text-primary" />
                          Reward: {achievement.reward.description}
                        </p>
                        {achievement.reward.stripeCouponId && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full mt-1.5 h-7 text-xs gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(achievement.reward.stripeCouponId!);
                            }}
                          >
                            {copiedCode === achievement.reward.stripeCouponId ? (
                              <>
                                <Check className="h-3 w-3" />
                                Copied!
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" />
                                {achievement.reward.stripeCouponId}
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                      {achievement.earnedAt && (
                        <p className="text-[10px] text-muted-foreground">
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
              Upcoming Rewards
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
                  <TooltipContent side="top" className="max-w-[220px]">
                    <div className="space-y-2">
                      <div>
                        <p className="font-semibold">{achievement.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {achievement.description}
                        </p>
                      </div>
                      <div className="pt-1 border-t border-border">
                        <p className="text-xs font-medium flex items-center gap-1">
                          <Gift className="h-3 w-3 text-muted-foreground" />
                          Reward: {achievement.reward.description}
                        </p>
                      </div>
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
              Complete sessions to unlock rewards!
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
