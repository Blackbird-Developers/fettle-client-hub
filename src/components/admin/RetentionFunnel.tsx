import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import type { AdminMetrics } from "@/hooks/useAdminMetrics";

interface RetentionFunnelProps {
  metrics?: AdminMetrics;
  isLoading: boolean;
}

export function RetentionFunnel({ metrics, isLoading }: RetentionFunnelProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  const funnel = metrics?.retentionFunnel;
  const rates = metrics?.retentionRates;
  const maxClients = funnel?.firstSession || 1;

  const stages = [
    {
      label: "1st Session",
      count: funnel?.firstSession || 0,
      percentage: 100,
      conversionRate: null,
      color: "bg-primary",
    },
    {
      label: "2nd Session",
      count: funnel?.secondSession || 0,
      percentage: maxClients > 0 ? ((funnel?.secondSession || 0) / maxClients) * 100 : 0,
      conversionRate: rates?.firstToSecond,
      color: "bg-primary/80",
    },
    {
      label: "3rd Session",
      count: funnel?.thirdSession || 0,
      percentage: maxClients > 0 ? ((funnel?.thirdSession || 0) / maxClients) * 100 : 0,
      conversionRate: rates?.secondToThird,
      color: "bg-primary/60",
    },
    {
      label: "4+ Sessions",
      count: funnel?.fourthPlusSession || 0,
      percentage: maxClients > 0 ? ((funnel?.fourthPlusSession || 0) / maxClients) * 100 : 0,
      conversionRate: rates?.thirdToFourth,
      color: "bg-primary/40",
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Client Retention Funnel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {stages.map((stage, index) => (
          <div key={stage.label} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">{stage.label}</span>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">{stage.count} clients</span>
                {stage.conversionRate !== null && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    stage.conversionRate >= 70 
                      ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : stage.conversionRate >= 50 
                        ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  }`}>
                    {stage.conversionRate}% converted
                  </span>
                )}
              </div>
            </div>
            <div className="relative">
              <Progress value={stage.percentage} className="h-4" />
              {index < stages.length - 1 && (
                <div className="absolute -bottom-3 left-1/2 transform -translate-x-1/2 text-muted-foreground">
                  ↓
                </div>
              )}
            </div>
          </div>
        ))}

        <div className="pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground">
            <strong>Insight:</strong> {
              (rates?.firstToSecond || 0) < 50 
                ? "Focus on first-session follow-ups to improve retention."
                : (rates?.secondToThird || 0) < 50
                  ? "Great first-to-second conversion! Work on building session 3 habits."
                  : "Excellent retention rates across all stages!"
            }
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
