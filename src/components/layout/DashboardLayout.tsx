import { ReactNode } from "react";
import { Sidebar, MobileHeader } from "./Sidebar";

interface DashboardLayoutProps {
  children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-background w-full overflow-x-hidden">
      {/* Mobile Header */}
      <MobileHeader />
      
      {/* Desktop Sidebar */}
      <Sidebar />
      
      <main className="flex-1 overflow-x-hidden min-w-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-full">
          {children}
        </div>
      </main>
    </div>
  );
}
