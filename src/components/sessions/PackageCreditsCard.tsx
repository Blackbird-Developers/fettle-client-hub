import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePackageStats } from "@/hooks/useUserPackages";
import { BookSessionDropdown } from "@/components/booking/BookSessionDropdown";
import { PackageBookingModal } from "@/components/booking/PackageBookingModal";
import { Gift, Sparkles, CheckCircle2, ShoppingBag, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PackageCreditsCardProps {
  onBookingComplete?: () => void;
}

const SUPPORT_EMAIL = "hello@fettle.ie";

export function PackageCreditsCard({ onBookingComplete }: PackageCreditsCardProps) {
  const {
    activePackages,
    expiredWithCreditsPackages,
    totalRemainingSessions,
    totalSessionsUsed,
    hasPackageHistory,
    hasActiveCredits,
    hasExpiredCredits,
    allCreditsDepleted,
    isLoading,
  } = usePackageStats();

  const [packageModalOpen, setPackageModalOpen] = useState(false);

  if (isLoading) {
    return (
      <Card className="border-border/50 animate-fade-in">
        <CardContent className="p-4 sm:p-6">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Don't show if user has never purchased a package
  if (!hasPackageHistory) {
    return null;
  }

  // Show depleted state when all credits are used (none expired with credits either)
  if (allCreditsDepleted) {
    return (
      <>
        <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 via-background to-amber-500/10 animate-fade-in overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full -translate-y-1/2 translate-x-1/2" />

          <CardContent className="p-4 sm:p-6 relative">
            <div className="flex items-start gap-4">
              <div className="relative flex-shrink-0">
                <div className={cn(
                  "w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center",
                  "bg-gradient-to-br from-amber-500/20 to-amber-500/10 border-2 border-amber-500/30"
                )}>
                  <CheckCircle2 className="h-8 w-8 sm:h-10 sm:w-10 text-amber-500" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Gift className="h-4 w-4 sm:h-5 sm:w-5 text-amber-500" />
                  <h3 className="font-heading font-semibold text-foreground text-base sm:text-lg">All Credits Used</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  Great work! You've completed {totalSessionsUsed} session{totalSessionsUsed !== 1 ? 's' : ''} from your package{totalSessionsUsed !== 1 ? 's' : ''}.
                </p>
                <p className="text-sm text-foreground mb-4">
                  Ready to continue your therapy journey? Purchase a new package to save on future sessions.
                </p>

                <Button
                  onClick={() => setPackageModalOpen(true)}
                  className="gap-2 bg-amber-500 hover:bg-amber-600 text-white"
                >
                  <ShoppingBag className="h-4 w-4" />
                  Purchase More Sessions
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <PackageBookingModal
          open={packageModalOpen}
          onOpenChange={setPackageModalOpen}
        />
      </>
    );
  }

  // Expired credits section (reusable inside tabs or standalone)
  const expiredContent = (
    <div className="space-y-3">
      {expiredWithCreditsPackages.map((pkg) => (
        <div key={pkg.id} className="space-y-1.5">
          <div className="flex justify-between gap-2 text-sm">
            <span className="text-muted-foreground truncate" title={pkg.package_name}>
              {pkg.package_name}
            </span>
            <span className="font-medium text-destructive/80 shrink-0">
              {pkg.remaining_sessions} unused
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-destructive/30"
              style={{ width: `${(pkg.remaining_sessions / pkg.total_sessions) * 100}%` }}
            />
          </div>
          {pkg.expires_at && (
            <p className="text-xs text-muted-foreground">
              Expired {new Date(pkg.expires_at).toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          )}
        </div>
      ))}

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
        <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          These credits have expired and can no longer be used to book sessions. For assistance, please contact support at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-destructive font-medium hover:underline">
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </div>
    </div>
  );

  // Expired-only state: has expired credits but no active ones
  if (hasExpiredCredits && !hasActiveCredits) {
    return (
      <>
        <Card className="border-destructive/30 bg-gradient-to-br from-destructive/5 via-background to-destructive/5 animate-fade-in overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-destructive/5 rounded-full -translate-y-1/2 translate-x-1/2" />

          <CardContent className="p-4 sm:p-6 relative">
            <div className="flex items-start gap-4">
              <div className="relative flex-shrink-0">
                <div className={cn(
                  "w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center",
                  "bg-gradient-to-br from-destructive/20 to-destructive/10 border-2 border-destructive/30"
                )}>
                  <Clock className="h-8 w-8 sm:h-10 sm:w-10 text-destructive" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Gift className="h-4 w-4 sm:h-5 sm:w-5 text-destructive" />
                  <h3 className="font-heading font-semibold text-foreground text-base sm:text-lg">Credits Expired</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  You have unused credits that have passed their expiry date.
                </p>

                {expiredContent}

                <Button
                  onClick={() => setPackageModalOpen(true)}
                  className="mt-4 gap-2"
                  variant="outline"
                >
                  <ShoppingBag className="h-4 w-4" />
                  Purchase New Package
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <PackageBookingModal
          open={packageModalOpen}
          onOpenChange={setPackageModalOpen}
        />
      </>
    );
  }

  // Active credits content
  const activeContent = (
    <div className="space-y-3">
      {activePackages.map((pkg) => {
        const progressPercent = (pkg.remaining_sessions / pkg.total_sessions) * 100;
        return (
          <div key={pkg.id} className="space-y-1.5">
            <div className="flex justify-between gap-2 text-sm">
              <span className="text-muted-foreground truncate" title={pkg.package_name}>
                {pkg.package_name}
              </span>
              <span className="font-medium text-foreground shrink-0">
                {pkg.remaining_sessions} of {pkg.total_sessions} left
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  progressPercent <= 20 ? "bg-amber-500" : "bg-success"
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        );
      })}

      <BookSessionDropdown
        variant="compact"
        onBookingComplete={onBookingComplete}
      />
    </div>
  );

  // Active + expired credits: show tabs
  if (hasActiveCredits && hasExpiredCredits) {
    return (
      <>
        <Card className="border-success/30 bg-gradient-to-br from-success/5 via-background to-success/10 animate-fade-in overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-success/10 rounded-full -translate-y-1/2 translate-x-1/2" />

          <CardContent className="p-4 sm:p-6 relative">
            <div className="flex items-start gap-4">
              {/* Sessions Counter Circle */}
              <div className="relative flex-shrink-0">
                <div className={cn(
                  "w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center",
                  "bg-gradient-to-br from-success/20 to-success/10 border-2 border-success/30"
                )}>
                  <div className="text-center">
                    <span className="text-2xl sm:text-3xl font-bold text-success">{totalRemainingSessions}</span>
                  </div>
                </div>
                <div className="absolute -top-1 -right-1 bg-success text-success-foreground rounded-full p-1.5">
                  <Sparkles className="h-3 w-3 sm:h-4 sm:w-4" />
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Gift className="h-4 w-4 sm:h-5 sm:w-5 text-success" />
                  <h3 className="font-heading font-semibold text-foreground text-base sm:text-lg">Package Credits</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  {totalRemainingSessions === 1
                    ? "You have 1 session credit remaining"
                    : `You have ${totalRemainingSessions} session credits remaining`}
                </p>

                <Tabs defaultValue="active">
                  <TabsList className="mb-4">
                    <TabsTrigger value="active" className="gap-1.5">
                      <Sparkles className="h-3.5 w-3.5" />
                      Active
                    </TabsTrigger>
                    <TabsTrigger value="expired" className="gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Expired
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="active">{activeContent}</TabsContent>
                  <TabsContent value="expired">{expiredContent}</TabsContent>
                </Tabs>
              </div>
            </div>
          </CardContent>
        </Card>

        <PackageBookingModal
          open={packageModalOpen}
          onOpenChange={setPackageModalOpen}
        />
      </>
    );
  }

  // Active credits only (no expired) — original view
  return (
    <>
      <Card className="border-success/30 bg-gradient-to-br from-success/5 via-background to-success/10 animate-fade-in overflow-hidden relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-success/10 rounded-full -translate-y-1/2 translate-x-1/2" />

        <CardContent className="p-4 sm:p-6 relative">
          <div className="flex items-start gap-4">
            {/* Sessions Counter Circle */}
            <div className="relative flex-shrink-0">
              <div className={cn(
                "w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center",
                "bg-gradient-to-br from-success/20 to-success/10 border-2 border-success/30"
              )}>
                <div className="text-center">
                  <span className="text-2xl sm:text-3xl font-bold text-success">{totalRemainingSessions}</span>
                </div>
              </div>
              <div className="absolute -top-1 -right-1 bg-success text-success-foreground rounded-full p-1.5">
                <Sparkles className="h-3 w-3 sm:h-4 sm:w-4" />
              </div>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Gift className="h-4 w-4 sm:h-5 sm:w-5 text-success" />
                <h3 className="font-heading font-semibold text-foreground text-base sm:text-lg">Package Credits</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                {totalRemainingSessions === 1
                  ? "You have 1 session credit remaining"
                  : `You have ${totalRemainingSessions} session credits remaining`}
              </p>

              {/* Package breakdown */}
              <div className="space-y-3 mb-4">
                {activePackages.map((pkg) => {
                  const progressPercent = (pkg.remaining_sessions / pkg.total_sessions) * 100;
                  return (
                    <div key={pkg.id} className="space-y-1.5">
                      <div className="flex justify-between gap-2 text-sm">
                        <span className="text-muted-foreground truncate" title={pkg.package_name}>
                          {pkg.package_name}
                        </span>
                        <span className="font-medium text-foreground shrink-0">
                          {pkg.remaining_sessions} of {pkg.total_sessions} left
                        </span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            progressPercent <= 20 ? "bg-amber-500" : "bg-success"
                          )}
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <BookSessionDropdown
                variant="compact"
                onBookingComplete={onBookingComplete}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <PackageBookingModal
        open={packageModalOpen}
        onOpenChange={setPackageModalOpen}
      />
    </>
  );
}
