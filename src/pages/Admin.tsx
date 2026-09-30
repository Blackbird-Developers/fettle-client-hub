import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminInvite } from "@/components/admin/AdminInvite";
import { PortalAdoption } from "@/components/admin/PortalAdoption";
import { SessionProgression } from "@/components/admin/SessionProgression";
import { useIsAdmin } from "@/hooks/useAdmin";
import { Navigate } from "react-router-dom";
import { Loader2, LayoutDashboard, UserPlus, MonitorSmartphone, Repeat } from "lucide-react";

export default function Admin() {
  const { data: isAdmin, isLoading } = useIsAdmin();

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardLayout>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-heading font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            Monitor business metrics and manage team access.
          </p>
        </div>

        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="grid h-auto w-full max-w-2xl grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="dashboard" className="gap-2">
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="adoption" className="gap-2">
              <MonitorSmartphone className="h-4 w-4" />
              Portal adoption
            </TabsTrigger>
            <TabsTrigger value="progression" className="gap-2">
              <Repeat className="h-4 w-4" />
              Progression
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-2">
              <UserPlus className="h-4 w-4" />
              Team
            </TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard" className="mt-6">
            <AdminDashboard />
          </TabsContent>
          <TabsContent value="adoption" className="mt-6">
            <PortalAdoption />
          </TabsContent>
          <TabsContent value="progression" className="mt-6">
            <SessionProgression />
          </TabsContent>
          <TabsContent value="team" className="mt-6">
            <AdminInvite />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
