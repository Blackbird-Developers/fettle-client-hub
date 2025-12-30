import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Calendar, X, User, Activity } from "lucide-react";
import { useActivities, ActivityType } from "@/hooks/useActivities";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDistanceToNow } from "date-fns";

const activityConfig: Record<ActivityType, { icon: typeof Check; color: string; bgColor: string }> = {
  session_completed: {
    icon: Check,
    color: "text-success",
    bgColor: "bg-success/10",
  },
  session_booked: {
    icon: Calendar,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  session_cancelled: {
    icon: X,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
  },
  profile_updated: {
    icon: User,
    color: "text-info",
    bgColor: "bg-info/10",
  },
};

export function RecentActivity() {
  const { data: activities, isLoading } = useActivities(5);

  if (isLoading) {
    return (
      <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <CardHeader className="pb-3">
          <CardTitle className="font-heading text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32 mb-1" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!activities || activities.length === 0) {
    return (
      <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.2s" }}>
        <CardHeader className="pb-3">
          <CardTitle className="font-heading text-lg">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="p-3 rounded-full bg-muted/50 mb-3">
              <Activity className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No activity yet. Book a session to get started!
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 animate-fade-in overflow-hidden" style={{ animationDelay: "0.2s" }}>
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-lg">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-4">
          {activities.map((activity) => {
            const config = activityConfig[activity.activity_type];
            const Icon = config.icon;
            const timeAgo = formatDistanceToNow(new Date(activity.created_at), { addSuffix: true });

            return (
              <div key={activity.id} className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${config.bgColor} flex-shrink-0`}>
                  <Icon className={`h-4 w-4 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-card-foreground">
                    {activity.title}
                  </p>
                  {activity.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {activity.description}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
