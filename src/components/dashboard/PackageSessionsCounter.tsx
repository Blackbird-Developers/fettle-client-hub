import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivePackages } from "@/hooks/useUserPackages";
import { Gift, CalendarPlus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

export function PackageSessionsCounter() {
  const { packages, totalRemainingSessions, isLoading } = useActivePackages();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <Card className="border-border/50 animate-fade-in">
        <CardContent className="p-4">
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Don't show if no active packages
  if (packages.length === 0) {
    return null;
  }

  const getProgressColor = () => {
    const totalSessions = packages.reduce((sum, pkg) => sum + pkg.total_sessions, 0);
    const usedPercentage = ((totalSessions - totalRemainingSessions) / totalSessions) * 100;
    
    if (usedPercentage >= 80) return "bg-amber-500";
    if (usedPercentage >= 50) return "bg-primary";
    return "bg-success";
  };

  return (
    <Card className="border-success/30 bg-gradient-to-br from-success/5 via-background to-success/10 animate-fade-in overflow-hidden relative">
      <div className="absolute top-0 right-0 w-24 h-24 bg-success/10 rounded-full -translate-y-1/2 translate-x-1/2" />
      
      <CardContent className="p-5 relative">
        <div className="flex items-start gap-4">
          {/* Sessions Counter Circle */}
          <div className="relative flex-shrink-0">
            <div className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center",
              "bg-gradient-to-br from-success/20 to-success/10 border-2 border-success/30"
            )}>
              <div className="text-center">
                <span className="text-2xl font-bold text-success">{totalRemainingSessions}</span>
              </div>
            </div>
            <div className="absolute -top-1 -right-1 bg-success text-success-foreground rounded-full p-1">
              <Sparkles className="h-3 w-3" />
            </div>
          </div>
          
          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Gift className="h-4 w-4 text-success" />
              <h3 className="font-semibold text-foreground">Package Sessions</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {totalRemainingSessions === 1 
                ? "You have 1 session remaining" 
                : `You have ${totalRemainingSessions} sessions remaining`}
            </p>
            
            {/* Package breakdown */}
            <div className="space-y-2 mb-3">
              {packages.map((pkg) => {
                const usedSessions = pkg.total_sessions - pkg.remaining_sessions;
                const progressPercent = (pkg.remaining_sessions / pkg.total_sessions) * 100;
                
                return (
                  <div key={pkg.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{pkg.package_name}</span>
                      <span className="font-medium text-foreground">
                        {pkg.remaining_sessions}/{pkg.total_sessions} left
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full rounded-full transition-all duration-500", getProgressColor())}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            
            <Button 
              size="sm" 
              onClick={() => navigate('/sessions')}
              className="w-full gap-2"
            >
              <CalendarPlus className="h-4 w-4" />
              Book a Session
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
