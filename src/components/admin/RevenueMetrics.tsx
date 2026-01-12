import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Package, Euro, CreditCard } from "lucide-react";
import type { AdminMetrics } from "@/hooks/useAdminMetrics";

interface RevenueMetricsProps {
  metrics?: AdminMetrics;
  isLoading: boolean;
}

export function RevenueMetrics({ metrics, isLoading }: RevenueMetricsProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const stats = [
    {
      label: "Total Revenue",
      value: `€${metrics?.totalPackageRevenue?.toLocaleString() || 0}`,
      icon: Euro,
      description: "All-time package sales",
    },
    {
      label: "This Month",
      value: `€${metrics?.revenueThisMonth?.toLocaleString() || 0}`,
      trend: metrics?.revenueGrowth,
      icon: TrendingUp,
      description: `vs €${metrics?.revenueLastMonth?.toLocaleString() || 0} last month`,
    },
    {
      label: "Packages Sold",
      value: metrics?.totalPackagesSold || 0,
      subValue: `${metrics?.packagesThisMonth || 0} this month`,
      icon: Package,
    },
    {
      label: "Avg Package Value",
      value: `€${metrics?.averagePackageValue || 0}`,
      icon: CreditCard,
      description: "This month",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Revenue Metrics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-background">
                <stat.icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-lg font-semibold text-foreground">{stat.value}</p>
              </div>
            </div>
            <div className="text-right">
              {stat.trend !== undefined && (
                <div className={`flex items-center gap-1 ${
                  stat.trend >= 0 ? 'text-green-600' : 'text-red-500'
                }`}>
                  {stat.trend >= 0 ? (
                    <TrendingUp className="h-4 w-4" />
                  ) : (
                    <TrendingDown className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">
                    {stat.trend >= 0 ? '+' : ''}{stat.trend}%
                  </span>
                </div>
              )}
              {stat.description && (
                <p className="text-xs text-muted-foreground">{stat.description}</p>
              )}
              {stat.subValue && (
                <p className="text-xs text-muted-foreground">{stat.subValue}</p>
              )}
            </div>
          </div>
        ))}

        <div className="pt-4 border-t border-border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Active Session Credits</span>
            <span className="font-semibold text-foreground">{metrics?.totalActiveCredits || 0}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
