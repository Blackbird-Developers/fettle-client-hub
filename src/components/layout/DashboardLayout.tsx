import { ReactNode } from "react";
import { Sidebar, MobileHeader } from "./Sidebar";
import { AnnouncementBar } from "./AnnouncementBar";
import { OutageNoticeModal } from "./OutageNoticeModal";
import { useAuth } from "@/contexts/AuthContext";
import { useIsAdmin } from "@/hooks/useAdmin";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const { user } = useAuth();
  const { data: isAdmin } = useIsAdmin();

  return (
    <>
      {/* Announcement bar sits outside the flex layout so it never
          creates a nested scroll container on iOS. It promotes customer
          services, so admins don't see it. */}
      {!(user && isAdmin) && <AnnouncementBar />}

      {/* Email outage popup: signed-in clients only (not login, not admins).
          Waits for the admin check so admins never see it flash up. */}
      {user && isAdmin === false && <OutageNoticeModal />}

      <div className="flex flex-col xl:flex-row min-h-screen bg-background w-full overflow-x-hidden">
        {/* Mobile/Tablet Header */}
        <MobileHeader />

        {/* Desktop Sidebar - only show on xl+ */}
        <div className="hidden xl:block w-56 2xl:w-64 flex-shrink-0 bg-sidebar border-r border-sidebar-border">
          <div className="sticky top-0 h-screen">
            <Sidebar />
          </div>
        </div>

        <main className="flex-1 overflow-x-hidden min-w-0">
          <div className="p-3 sm:p-4 md:p-6 lg:p-8 max-w-full">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
