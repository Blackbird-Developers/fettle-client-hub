import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Clock, Users, ArrowRight } from "lucide-react";
import type { AdminMetrics } from "@/hooks/useAdminMetrics";

interface SessionMetricsProps {
  metrics?: AdminMetrics;
  isLoading: boolean;
}

export function SessionMetrics({ metrics, isLoading }: SessionMetricsProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const sessionStats = [
    {
      label: "Upcoming Sessions",
      value: metrics?.upcomingAppointments || 0,
      icon: Clock,
      description: "Scheduled and pending",
      color: "text-blue-600",
      bg: "bg-blue-50 dark:bg-blue-900/20",
    },
    {
      label: "Completed This Month",
      value: metrics?.completedSessionsThisMonth || 0,
      icon: Calendar,
      description: `vs ${metrics?.completedSessionsLastMonth || 0} last month`,
      color: "text-green-600",
      bg: "bg-green-50 dark:bg-green-900/20",
    },
    {
      label: "Total Unique Clients",
      value: metrics?.totalClients || 0,
      icon: Users,
      description: "With at least 1 session",
      color: "text-purple-600",
      bg: "bg-purple-50 dark:bg-purple-900/20",
    },
  ];

  // Calculate average sessions per client
  const totalSessions = (metrics?.completedSessionsThisMonth || 0) + (metrics?.completedSessionsLastMonth || 0);
  const avgSessionsPerClient = metrics?.totalClients 
    ? (totalSessions / metrics.totalClients).toFixed(1) 
    : '0';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Session Overview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {sessionStats.map((stat) => (
            <div
              key={stat.label}
              className={`p-4 rounded-lg ${stat.bg}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className={`text-3xl font-bold ${stat.color}`}>{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
                </div>
                <stat.icon className={`h-6 w-6 ${stat.color}`} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Session Growth</p>
              <p className="text-lg font-semibold text-foreground">
                {metrics?.sessionGrowth !== undefined ? (
                  <span className={metrics.sessionGrowth >= 0 ? 'text-green-600' : 'text-red-500'}>
                    {metrics.sessionGrowth >= 0 ? '+' : ''}{metrics.sessionGrowth}%
                  </span>
                ) : (
                  'N/A'
                )}
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
          </div>

          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Avg Sessions per Client</p>
              <p className="text-lg font-semibold text-foreground">{avgSessionsPerClient}</p>
            </div>
            <Users className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
