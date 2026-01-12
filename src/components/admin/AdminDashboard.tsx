import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Users,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  UserPlus,
  CreditCard,
  Target,
  ArrowRight,
  Package,
  Repeat,
  AlertCircle,
  RefreshCw,
  WifiOff,
  ShieldAlert,
  ServerCrash,
} from "lucide-react";
import {
  useRetentionFunnel,
  useRevenueMetrics,
  useSessionMetrics,
  useEngagementStats,
} from "@/hooks/useAdmin";
import { ApiError, ApiErrorType } from "@/lib/api-errors";

function StatCard({
  title,
  value,
  subValue,
  icon: Icon,
  trend,
  trendValue,
  color,
  bgColor,
  isLoading,
}: {
  title: string;
  value: string;
  subValue?: string;
  icon: any;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  color: string;
  bgColor: string;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-7 w-16 mb-1" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 hover:shadow-soft transition-shadow duration-300">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${bgColor}`}>
              <Icon className={`h-5 w-5 ${color}`} />
            </div>
            <div>
              <p className="text-2xl font-heading font-bold text-card-foreground">
                {value}
              </p>
              <p className="text-xs text-muted-foreground">{title}</p>
            </div>
          </div>
          {trend && trendValue && (
            <div
              className={`flex items-center gap-1 text-xs font-medium ${
                trend === "up"
                  ? "text-green-600"
                  : trend === "down"
                  ? "text-red-600"
                  : "text-muted-foreground"
              }`}
            >
              {trend === "up" ? (
                <TrendingUp className="h-3 w-3" />
              ) : trend === "down" ? (
                <TrendingDown className="h-3 w-3" />
              ) : null}
              {trendValue}
            </div>
          )}
        </div>
        {subValue && (
          <p className="text-xs text-muted-foreground mt-2">{subValue}</p>
        )}
      </CardContent>
    </Card>
  );
}

function RetentionFunnelCard() {
  const { funnel, loading } = useRetentionFunnel();

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const stages = [
    { label: "1st Session", count: funnel.firstSession, color: "bg-blue-500" },
    {
      label: "2nd Session",
      count: funnel.secondSession,
      rate: funnel.firstToSecondRate,
      color: "bg-indigo-500",
    },
    {
      label: "3rd Session",
      count: funnel.thirdSession,
      rate: funnel.secondToThirdRate,
      color: "bg-purple-500",
    },
    {
      label: "4th+ Session",
      count: funnel.fourthSession,
      rate: funnel.thirdToFourthRate,
      color: "bg-violet-500",
    },
  ];

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Repeat className="h-4 w-4 text-primary" />
          Retention Funnel
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stages.map((stage, index) => (
            <div key={stage.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{stage.label}</span>
                  {index > 0 && stage.rate !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      ({stage.rate}% from previous)
                    </span>
                  )}
                </div>
                <span className="font-semibold">{stage.count}</span>
              </div>
              <div className="relative h-6 bg-muted rounded-full overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 ${stage.color} rounded-full transition-all duration-500`}
                  style={{ width: `${(stage.count / maxCount) * 100}%` }}
                />
                {index < stages.length - 1 && (
                  <ArrowRight className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {funnel.totalClients}
            </span>{" "}
            total unique clients
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

const ERROR_ICONS: Record<ApiErrorType, typeof AlertCircle> = {
  cors: ShieldAlert,
  network: WifiOff,
  timeout: RefreshCw,
  unauthorized: ShieldAlert,
  forbidden: ShieldAlert,
  not_found: AlertCircle,
  rate_limit: RefreshCw,
  server_error: ServerCrash,
  unknown: AlertCircle,
};

function ErrorAlert({
  error,
  onRetry,
}: {
  error: ApiError;
  onRetry?: () => void;
}) {
  const Icon = ERROR_ICONS[error.type] || AlertCircle;

  return (
    <Alert variant="destructive" className="mb-4">
      <Icon className="h-4 w-4" />
      <AlertTitle className="capitalize">{error.type.replace("_", " ")} Error</AlertTitle>
      <AlertDescription className="mt-2">
        <p>{error.message}</p>
        {error.type === "cors" && (
          <p className="mt-2 text-sm opacity-80">
            This may indicate the Edge Function is not deployed or has incorrect CORS headers.
          </p>
        )}
        {error.type === "network" && (
          <p className="mt-2 text-sm opacity-80">
            Check your internet connection or try again in a few moments.
          </p>
        )}
        {error.retryable && onRetry && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={onRetry}
          >
            <RefreshCw className="h-3 w-3 mr-2" />
            Try Again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function AdminDashboard() {
  const { metrics: revenue, isLoading: revenueLoading } = useRevenueMetrics();
  const { metrics: sessions, loading: sessionsLoading, error: sessionsError } = useSessionMetrics();
  const { stats: engagement, isLoading: engagementLoading } = useEngagementStats();

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Error Display */}
      {sessionsError && (
        <ErrorAlert
          error={sessionsError}
          onRetry={() => window.location.reload()}
        />
      )}

      {/* Revenue Metrics */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Revenue
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title="Total Revenue"
            value={`£${revenue.totalRevenue.toLocaleString()}`}
            icon={DollarSign}
            color="text-green-600"
            bgColor="bg-green-100"
            isLoading={revenueLoading}
          />
          <StatCard
            title="This Month"
            value={`£${revenue.thisMonthRevenue.toLocaleString()}`}
            subValue={`vs £${revenue.lastMonthRevenue.toLocaleString()} last month`}
            icon={TrendingUp}
            trend={
              revenue.monthOverMonthChange > 0
                ? "up"
                : revenue.monthOverMonthChange < 0
                ? "down"
                : "neutral"
            }
            trendValue={`${revenue.monthOverMonthChange > 0 ? "+" : ""}${
              revenue.monthOverMonthChange
            }%`}
            color="text-blue-600"
            bgColor="bg-blue-100"
            isLoading={revenueLoading}
          />
          <StatCard
            title="Packages Sold"
            value={revenue.totalPackagesSold.toString()}
            subValue={`${revenue.thisMonthPackages} this month`}
            icon={Package}
            color="text-purple-600"
            bgColor="bg-purple-100"
            isLoading={revenueLoading}
          />
          <StatCard
            title="Avg Package Value"
            value={`£${revenue.averagePackageValue}`}
            icon={CreditCard}
            color="text-amber-600"
            bgColor="bg-amber-100"
            isLoading={revenueLoading}
          />
        </div>
      </div>

      {/* Session Metrics */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Sessions
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            title="Upcoming"
            value={sessions.totalUpcoming.toString()}
            icon={Calendar}
            color="text-primary"
            bgColor="bg-primary/10"
            isLoading={sessionsLoading}
          />
          <StatCard
            title="Completed (Total)"
            value={sessions.totalCompleted.toString()}
            subValue={`${sessions.thisMonthCompleted} this month`}
            icon={Target}
            trend={
              sessions.monthOverMonthGrowth > 0
                ? "up"
                : sessions.monthOverMonthGrowth < 0
                ? "down"
                : "neutral"
            }
            trendValue={`${sessions.monthOverMonthGrowth > 0 ? "+" : ""}${
              sessions.monthOverMonthGrowth
            }%`}
            color="text-green-600"
            bgColor="bg-green-100"
            isLoading={sessionsLoading}
          />
          <StatCard
            title="First-Timers (Month)"
            value={sessions.firstTimersThisMonth.toString()}
            subValue={`${sessions.uniqueClientsThisMonth} unique clients`}
            icon={UserPlus}
            color="text-indigo-600"
            bgColor="bg-indigo-100"
            isLoading={sessionsLoading}
          />
          <StatCard
            title="Canceled (Month)"
            value={sessions.canceledThisMonth.toString()}
            icon={Calendar}
            color="text-red-600"
            bgColor="bg-red-100"
            isLoading={sessionsLoading}
          />
        </div>
      </div>

      {/* Engagement & Retention */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Engagement Stats */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Engagement
            </CardTitle>
          </CardHeader>
          <CardContent>
            {engagementLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Total Clients</p>
                    <p className="text-xs text-muted-foreground">
                      Registered users
                    </p>
                  </div>
                  <p className="text-2xl font-bold">{engagement.uniqueClients}</p>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Active Credits</p>
                    <p className="text-xs text-muted-foreground">
                      Unused session credits
                    </p>
                  </div>
                  <p className="text-2xl font-bold text-green-600">
                    {engagement.totalActiveCredits}
                  </p>
                </div>
                <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">With Active Packages</p>
                    <p className="text-xs text-muted-foreground">
                      Clients with credits remaining
                    </p>
                  </div>
                  <p className="text-2xl font-bold text-blue-600">
                    {engagement.activePackageHolders}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Retention Funnel */}
        <RetentionFunnelCard />
      </div>
    </div>
  );
}
