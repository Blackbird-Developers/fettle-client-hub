import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminInvite } from "@/components/admin/AdminInvite";
import { PortalAdoption } from "@/components/admin/PortalAdoption";
import { SessionProgression } from "@/components/admin/SessionProgression";
import { useIsAdmin } from "@/hooks/useAdmin";
import { type AdminSectionId, getAdminSection } from "@/lib/adminNavigation";
import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

const SECTION_CONTENT: Record<AdminSectionId, () => JSX.Element> = {
  overview: AdminDashboard,
  adoption: PortalAdoption,
  progression: SessionProgression,
  team: AdminInvite,
};

export default function Admin() {
  const { section: sectionId } = useParams();
  const { data: isAdmin, isLoading } = useIsAdmin();

  // Full-screen loader (no layout) so the sidebar never renders before we
  // know whether to show the admin or customer menu.
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const section = getAdminSection(sectionId);
  if (!section) {
    return <Navigate to="/admin" replace />;
  }
  const Content = SECTION_CONTENT[section.id];

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-heading font-bold">{section.name}</h1>
          <p className="text-muted-foreground text-sm">{section.description}</p>
        </div>
        <Content />
      </div>
    </DashboardLayout>
  );
}
