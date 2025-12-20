import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useAcuityAppointmentTypes } from "@/hooks/useAcuity";
import { Package, Sparkles, TrendingUp } from "lucide-react";
import { useState } from "react";
import { BookingModal } from "@/components/booking/BookingModal";

export function PackagesPromo() {
  const { types, loading } = useAcuityAppointmentTypes();
  const [bookingOpen, setBookingOpen] = useState(false);

  // Filter for packages/bundles - looking for common naming patterns
  const packages = types.filter(type => {
    const name = type.name.toLowerCase();
    return (
      name.includes('bundle') ||
      name.includes('package') ||
      name.includes('pack') ||
      name.includes('sessions') ||
      name.includes('4 session') ||
      name.includes('8 session') ||
      name.includes('block')
    );
  });

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

  // If no bundles found in Acuity, show a general promo
  if (packages.length === 0) {
    return (
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-primary/10 animate-fade-in overflow-hidden relative" style={{ animationDelay: "0.3s" }}>
        <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2" />
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="font-heading text-lg">Save with Session Packages</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Commit to your wellbeing and save. Our session packages offer discounted rates for booking multiple sessions upfront.
          </p>
          <Button onClick={() => setBookingOpen(true)} className="w-full gap-2">
            <Package className="h-4 w-4" />
            View Packages
          </Button>
        </CardContent>
        <BookingModal open={bookingOpen} onOpenChange={setBookingOpen} />
      </Card>
    );
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
            Save up to 15%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Commit to your therapy journey and save with our multi-session packages.
        </p>
        
        <div className="space-y-2">
          {packages.slice(0, 3).map((pkg) => (
            <div 
              key={pkg.id}
              className="flex items-center justify-between p-3 rounded-lg bg-background/80 border border-border/50"
            >
              <div>
                <p className="font-medium text-sm text-foreground">{pkg.name}</p>
                <p className="text-xs text-muted-foreground">{pkg.duration} min sessions</p>
              </div>
              {pkg.price && pkg.price !== '0' && (
                <p className="font-semibold text-primary">€{pkg.price}</p>
              )}
            </div>
          ))}
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
