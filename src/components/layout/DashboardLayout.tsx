import { ReactNode } from "react";
import { Sidebar, MobileHeader } from "./Sidebar";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex flex-col xl:flex-row min-h-screen bg-background w-full overflow-x-hidden">
      {/* Mobile/Tablet Header */}
      <MobileHeader />
      
      {/* Desktop Sidebar - wrapper extends full height, only show on xl+ */}
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
  );
}
