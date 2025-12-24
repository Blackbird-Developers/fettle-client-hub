import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Gift, TrendingUp, Sparkles, ArrowRight } from "lucide-react";
import { useState } from "react";
import { PackageBookingModal } from "@/components/booking/PackageBookingModal";

export function PackagesPromo() {
  const [bookingOpen, setBookingOpen] = useState(false);

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background animate-fade-in overflow-hidden relative" style={{ animationDelay: "0.3s" }}>
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-40 h-40 bg-primary/10 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-24 h-24 bg-success/10 rounded-full translate-y-1/2 -translate-x-1/2" />
      
      <CardHeader className="pb-2 relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-lg">
              <Gift className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <CardTitle className="font-heading text-lg">Session Packages</CardTitle>
              <p className="text-xs text-muted-foreground">The smarter way to therapy</p>
            </div>
          </div>
          <Badge className="bg-success text-success-foreground border-0 shadow-sm">
            <Sparkles className="h-3 w-3 mr-1" />
            Save up to 25%
          </Badge>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4 relative">
        <div className="bg-background/80 backdrop-blur-sm rounded-xl p-4 border border-border/50 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-1.5 rounded-lg bg-success/10 mt-0.5">
              <TrendingUp className="h-4 w-4 text-success" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-foreground text-sm">Commit to your journey & save</p>
              <p className="text-xs text-muted-foreground mt-1">
                Book multiple sessions upfront and pay less per session. Perfect for ongoing support.
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="text-center p-2 rounded-lg bg-accent/50">
              <p className="text-lg font-bold text-foreground">3</p>
              <p className="text-xs text-muted-foreground">Sessions</p>
              <p className="text-xs text-success font-medium">Save 6%</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-primary/10 border border-primary/20">
              <p className="text-lg font-bold text-primary">6</p>
              <p className="text-xs text-muted-foreground">Sessions</p>
              <p className="text-xs text-success font-medium">Save 13%</p>
            </div>
            <div className="text-center p-2 rounded-lg bg-accent/50">
              <p className="text-lg font-bold text-foreground">9</p>
              <p className="text-xs text-muted-foreground">Sessions</p>
              <p className="text-xs text-success font-medium">Save 19%</p>
            </div>
          </div>
        </div>

        <Button 
          onClick={() => setBookingOpen(true)} 
          className="w-full gap-2 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary shadow-lg"
          size="lg"
        >
          <Gift className="h-4 w-4" />
          View Package Deals
          <ArrowRight className="h-4 w-4 ml-auto" />
        </Button>
        
        <p className="text-xs text-center text-muted-foreground">
          Individual sessions: €80 each • Packages: from €75/session
        </p>
      </CardContent>
      
      <PackageBookingModal open={bookingOpen} onOpenChange={setBookingOpen} />
    </Card>
  );
}
