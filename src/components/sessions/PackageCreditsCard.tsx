import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivePackages } from "@/hooks/useUserPackages";
import { BookSessionDropdown } from "@/components/booking/BookSessionDropdown";
import { Gift, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface PackageCreditsCardProps {
  onBookingComplete?: () => void;
}

export function PackageCreditsCard({ onBookingComplete }: PackageCreditsCardProps) {
  const { packages, totalRemainingSessions, isLoading } = useActivePackages();

  if (isLoading) {
    return (
      <Card className="border-border/50 animate-fade-in">
        <CardContent className="p-4 sm:p-6">
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Don't show if no active packages
  if (packages.length === 0) {
    return null;
  }

  return (
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
              {packages.map((pkg) => {
                const usedSessions = pkg.total_sessions - pkg.remaining_sessions;
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
  );
}
