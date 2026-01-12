import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, Calendar, CreditCard, TrendingUp, TrendingDown } from "lucide-react";
import type { AdminMetrics } from "@/hooks/useAdminMetrics";

interface AdminOverviewCardsProps {
  metrics?: AdminMetrics;
  isLoading: boolean;
}

export function AdminOverviewCards({ metrics, isLoading }: AdminOverviewCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardContent className="p-6">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: "Total Users",
      value: metrics?.totalUsers || 0,
      subValue: `+${metrics?.usersThisMonth || 0} this month`,
      icon: Users,
      iconBg: "bg-primary/10",
      iconColor: "text-primary",
    },
    {
      label: "First Timers",
      value: metrics?.firstTimersThisMonth || 0,
      subValue: "New clients this month",
      icon: Users,
      iconBg: "bg-accent/10",
      iconColor: "text-accent",
    },
    {
      label: "Sessions This Month",
      value: metrics?.completedSessionsThisMonth || 0,
      subValue: metrics?.sessionGrowth !== undefined 
        ? `${metrics.sessionGrowth >= 0 ? '+' : ''}${metrics.sessionGrowth}% vs last month`
        : "Completed sessions",
      icon: Calendar,
      iconBg: "bg-secondary/10",
      iconColor: "text-secondary-foreground",
      trend: metrics?.sessionGrowth,
    },
    {
      label: "Revenue This Month",
      value: `€${metrics?.revenueThisMonth?.toLocaleString() || 0}`,
      subValue: metrics?.revenueGrowth !== undefined
        ? `${metrics.revenueGrowth >= 0 ? '+' : ''}${metrics.revenueGrowth}% vs last month`
        : "Package sales",
      icon: CreditCard,
      iconBg: "bg-green-500/10",
      iconColor: "text-green-600",
      trend: metrics?.revenueGrowth,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.label} className="hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{card.value}</p>
                <div className="flex items-center gap-1 mt-1">
                  {card.trend !== undefined && (
                    card.trend >= 0 ? (
                      <TrendingUp className="h-3 w-3 text-green-600" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-red-500" />
                    )
                  )}
                  <p className={`text-xs ${
                    card.trend !== undefined 
                      ? card.trend >= 0 ? 'text-green-600' : 'text-red-500'
                      : 'text-muted-foreground'
                  }`}>
                    {card.subValue}
                  </p>
                </div>
              </div>
              <div className={`p-3 rounded-full ${card.iconBg}`}>
                <card.icon className={`h-5 w-5 ${card.iconColor}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
