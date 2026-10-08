import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminInvite } from "@/components/admin/AdminInvite";
import { FollowUpsReport } from "@/components/admin/FollowUpsReport";
import { PortalAdoption } from "@/components/admin/PortalAdoption";
import { SessionProgression } from "@/components/admin/SessionProgression";
import { useIsAdmin } from "@/hooks/useAdmin";
import {
  type AdminSectionId,
  parseProgressionRange,
  resolveAdminRoute,
} from "@/lib/adminNavigation";
import { Navigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

// `subsectionId` is set for sections with children (resolveAdminRoute has
// already checked it's valid). Keyed by it, so each child page starts fresh.
const SECTION_CONTENT: Record<AdminSectionId, (props: { subsectionId?: string }) => JSX.Element> = {
  overview: AdminDashboard,
  adoption: PortalAdoption,
  progression: ({ subsectionId }) => (
    <SessionProgression fromSession={parseProgressionRange(subsectionId)!} />
  ),
  followups: FollowUpsReport,
  team: AdminInvite,
};

export default function Admin() {
  const { section: sectionId, subsection: subsectionId } = useParams();
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

  const route = resolveAdminRoute(sectionId, subsectionId);
  if ("redirect" in route) {
    return <Navigate to={route.redirect} replace />;
  }
  const { section, subsection } = route;
  const Content = SECTION_CONTENT[section.id];

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-heading font-bold">
            {section.name}
            {subsection && (
              <span className="text-muted-foreground font-normal"> · {subsection.name}</span>
            )}
          </h1>
          <p className="text-muted-foreground text-sm">
            {subsection?.description ?? section.description}
          </p>
        </div>
        <Content key={subsection?.id} subsectionId={subsection?.id} />
      </div>
    </DashboardLayout>
  );
}
