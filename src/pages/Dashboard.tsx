import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { WelcomeHeader } from "@/components/dashboard/WelcomeHeader";
import { QuickStats } from "@/components/dashboard/QuickStats";
import { UpcomingSessions } from "@/components/dashboard/UpcomingSessions";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { PackagesPromo } from "@/components/dashboard/PackagesPromo";
import { ProgressDashboard } from "@/components/dashboard/ProgressDashboard";

export default function Dashboard() {
  return (
    <DashboardLayout>
      <WelcomeHeader />
      <QuickStats />
      
      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6 mt-6 sm:mt-8">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <UpcomingSessions />
          <ProgressDashboard />
        </div>
        <div className="space-y-4 sm:space-y-6">
          <PackagesPromo />
          <RecentActivity />
        </div>
      </div>
    </DashboardLayout>
  );
}
