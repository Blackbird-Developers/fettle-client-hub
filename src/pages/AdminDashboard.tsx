import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useIsAdmin, useAdminMetrics } from "@/hooks/useAdminMetrics";
import { AdminOverviewCards } from "@/components/admin/AdminOverviewCards";
import { RetentionFunnel } from "@/components/admin/RetentionFunnel";
import { RevenueMetrics } from "@/components/admin/RevenueMetrics";
import { SessionMetrics } from "@/components/admin/SessionMetrics";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { data: isAdmin, isLoading: isCheckingAdmin } = useIsAdmin();
  const { data: metrics, isLoading: isLoadingMetrics, error } = useAdminMetrics();

  useEffect(() => {
    if (!isCheckingAdmin && !isAdmin) {
      navigate('/dashboard');
    }
  }, [isAdmin, isCheckingAdmin, navigate]);

  if (isCheckingAdmin) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!isAdmin) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
          <ShieldAlert className="h-16 w-16 text-destructive mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
          <p className="text-muted-foreground">You don't have permission to view this page.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">Platform metrics and analytics</p>
        </div>

        {error ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-destructive">
            Error loading metrics: {error.message}
          </div>
        ) : (
          <>
            <AdminOverviewCards metrics={metrics} isLoading={isLoadingMetrics} />
            
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <RetentionFunnel metrics={metrics} isLoading={isLoadingMetrics} />
              <RevenueMetrics metrics={metrics} isLoading={isLoadingMetrics} />
            </div>

            <SessionMetrics metrics={metrics} isLoading={isLoadingMetrics} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
