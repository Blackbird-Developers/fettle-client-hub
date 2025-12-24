import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAcuityAppointmentTypes } from "@/hooks/useAcuity";
import { Package, TrendingUp, Check } from "lucide-react";
import { useState, useMemo } from "react";
import { BookingModal } from "@/components/booking/BookingModal";

// Specific package IDs to display
const PACKAGE_IDS = [1967864, 1967867, 1122832];

// Package metadata with savings info
const PACKAGE_METADATA: Record<number, { sessions: number; individualPrice: number }> = {
  1122832: { sessions: 3, individualPrice: 80 }, // Bundle 3 x 50min Zoom Sessions
  1967864: { sessions: 6, individualPrice: 80 }, // Bundle 6 x 50min Zoom Sessions
  1967867: { sessions: 9, individualPrice: 80 }, // Therapy Bundle - 9 sessions
};

export function PackagesPromo() {
  const { types, loading } = useAcuityAppointmentTypes();
  const [bookingOpen, setBookingOpen] = useState(false);

  // Filter for specific package IDs only
  const packages = useMemo(() => {
    return types
      .filter(type => PACKAGE_IDS.includes(type.id))
      .sort((a, b) => {
        // Sort by number of sessions (ascending)
        const sessionsA = PACKAGE_METADATA[a.id]?.sessions || 0;
        const sessionsB = PACKAGE_METADATA[b.id]?.sessions || 0;
        return sessionsA - sessionsB;
      });
  }, [types]);

  // Calculate savings for a package
  const calculateSavings = (packageId: number, packagePrice: string) => {
    const meta = PACKAGE_METADATA[packageId];
    if (!meta || !packagePrice) return null;
    
    const price = parseFloat(packagePrice);
    const fullPrice = meta.sessions * meta.individualPrice;
    const savings = fullPrice - price;
    const percentSaved = Math.round((savings / fullPrice) * 100);
    
    return { savings, percentSaved, fullPrice, sessions: meta.sessions };
  };

  // Get friendly display name
  const getDisplayName = (name: string, sessions: number) => {
    return `${sessions} Session Bundle`;
  };

  if (loading) {
    return (
      <Card className="border-border/50 bg-gradient-to-br from-primary/5 to-primary/10 animate-fade-in" style={{ animationDelay: "0.3s" }}>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (packages.length === 0) {
    return null;
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-primary/10 animate-fade-in overflow-hidden relative" style={{ animationDelay: "0.3s" }}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2" />
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="font-heading text-lg">Session Packages</CardTitle>
          </div>
          <Badge variant="secondary" className="bg-success/10 text-success border-success/20">
            Save up to 25%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Commit to your therapy journey and save. The more sessions you book, the more you save.
        </p>
        
        <div className="space-y-3">
          {packages.map((pkg) => {
            const savingsInfo = calculateSavings(pkg.id, pkg.price);
            const sessions = PACKAGE_METADATA[pkg.id]?.sessions || 0;
            
            return (
              <div 
                key={pkg.id}
                className="p-4 rounded-xl bg-background/80 border border-border/50 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-foreground">{getDisplayName(pkg.name, sessions)}</p>
                    <p className="text-xs text-muted-foreground">{sessions} x 50 minute sessions</p>
                  </div>
                  {savingsInfo && savingsInfo.percentSaved > 0 && (
                    <Badge className="bg-success/10 text-success border-success/20 text-xs">
                      Save {savingsInfo.percentSaved}%
                    </Badge>
                  )}
                </div>
                
                {pkg.price && pkg.price !== '0' && savingsInfo && (
                  <div className="flex items-baseline gap-2">
                    <span className="text-xl font-bold text-primary">€{pkg.price}</span>
                    <span className="text-sm text-muted-foreground line-through">€{savingsInfo.fullPrice}</span>
                    <span className="text-xs text-success font-medium">
                      (Save €{savingsInfo.savings})
                    </span>
                  </div>
                )}
                
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-success" />
                  <span>€{(parseFloat(pkg.price) / sessions).toFixed(0)} per session vs €{PACKAGE_METADATA[pkg.id]?.individualPrice} individually</span>
                </div>
              </div>
            );
          })}
        </div>

        <Button onClick={() => setBookingOpen(true)} className="w-full gap-2">
          <Package className="h-4 w-4" />
          Book a Package
        </Button>
      </CardContent>
      <BookingModal open={bookingOpen} onOpenChange={setBookingOpen} />
    </Card>
  );
}
