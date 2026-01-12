import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, Shield, Trash2, Loader2 } from "lucide-react";
import { useAdminList, useInviteAdmin, useRemoveAdmin } from "@/hooks/useAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";

export function AdminInvite() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const { data: admins, isLoading } = useAdminList();
  const inviteAdmin = useInviteAdmin();
  const removeAdmin = useRemoveAdmin();

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    try {
      await inviteAdmin.mutateAsync(email.trim());
      toast({
        title: "Admin added",
        description: `${email} has been granted admin access.`,
      });
      setEmail("");
    } catch (error) {
      toast({
        title: "Failed to add admin",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleRemove = async (userId: string, adminEmail: string) => {
    try {
      await removeAdmin.mutateAsync(userId);
      toast({
        title: "Admin removed",
        description: `${adminEmail} no longer has admin access.`,
      });
    } catch (error) {
      toast({
        title: "Failed to remove admin",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Invite Form */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Invite Admin
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <p className="text-xs text-muted-foreground">
                The user must already have an account to be granted admin access.
              </p>
              <div className="flex gap-2">
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="submit"
                  disabled={!email.trim() || inviteAdmin.isPending}
                >
                  {inviteAdmin.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Add Admin"
                  )}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Current Admins List */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Current Admins
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : admins && admins.length > 0 ? (
            <div className="space-y-2">
              {admins.map((admin: any) => {
                const profile = admin.profiles;
                const isCurrentUser = admin.user_id === user?.id;
                const displayName = profile?.first_name
                  ? `${profile.first_name} ${profile.last_name || ""}`.trim()
                  : profile?.email || "Unknown";

                return (
                  <div
                    key={admin.id}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Shield className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">
                          {displayName}
                          {isCurrentUser && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              (you)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {profile?.email}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          Added {format(new Date(admin.created_at), "MMM d, yyyy")}
                        </p>
                      </div>
                    </div>
                    {!isCurrentUser && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove admin access?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will revoke admin privileges from{" "}
                              <span className="font-medium">{profile?.email}</span>.
                              They will no longer be able to access the admin dashboard.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                handleRemove(admin.user_id, profile?.email || "")
                              }
                              className="bg-red-600 hover:bg-red-700"
                            >
                              Remove Admin
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No admins found.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
