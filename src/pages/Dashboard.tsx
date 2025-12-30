import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { WelcomeHeader } from "@/components/dashboard/WelcomeHeader";
import { QuickStats } from "@/components/dashboard/QuickStats";
import { UpcomingSessions } from "@/components/dashboard/UpcomingSessions";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { PackagesPromo } from "@/components/dashboard/PackagesPromo";
import { ProgressDashboard } from "@/components/dashboard/ProgressDashboard";
import { PackageSessionsCounter } from "@/components/dashboard/PackageSessionsCounter";

export default function Dashboard() {
  return (
    <DashboardLayout>
      <WelcomeHeader />
      <QuickStats />
      
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-6 mt-4 sm:mt-6 min-w-0 max-w-full">
        <div className="md:col-span-2 xl:col-span-2 space-y-4 lg:space-y-6 min-w-0 w-full">
          <UpcomingSessions />
          <ProgressDashboard />
        </div>
        <div className="md:col-span-2 xl:col-span-1 space-y-4 lg:space-y-6 min-w-0 w-full">
          <PackageSessionsCounter />
          <PackagesPromo />
          <RecentActivity />
        </div>
      </div>
    </DashboardLayout>
  );
}
