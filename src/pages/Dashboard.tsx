import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { WelcomeHeader } from "@/components/dashboard/WelcomeHeader";
import { QuickStats } from "@/components/dashboard/QuickStats";
import { UpcomingSessions } from "@/components/dashboard/UpcomingSessions";
import { RecentActivity } from "@/components/dashboard/RecentActivity";

export default function Dashboard() {
  return (
    <DashboardLayout>
      <WelcomeHeader />
      <QuickStats />
      
      <div className="grid lg:grid-cols-3 gap-6 mt-8">
        <div className="lg:col-span-2">
          <UpcomingSessions />
        </div>
        <div>
          <RecentActivity />
        </div>
      </div>
    </DashboardLayout>
  );
}
