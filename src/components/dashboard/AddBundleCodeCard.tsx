import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Ticket, ChevronDown } from "lucide-react";
import { AddBundleCode } from "@/components/bundles/AddBundleCode";
import { cn } from "@/lib/utils";

// Lets clients link a bundle bought on fettle.ie before they book, so the
// credit is already there on the booking's confirm step.
export function AddBundleCodeCard() {
  const [open, setOpen] = useState(false);

  return (
    <Card className="border-border/50 animate-fade-in">
      <CardContent className="p-4 space-y-3">
        <Button
          variant="ghost"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="w-full justify-start gap-2 px-0 h-auto hover:bg-transparent"
        >
          <Ticket className="h-4 w-4 text-primary" />
          <span className="font-semibold text-foreground">Have a bundle? Add your code</span>
          <ChevronDown className={cn("h-4 w-4 ml-auto transition-transform", open && "rotate-180")} />
        </Button>
        {open && <AddBundleCode inputId="dashboardBundleCode" />}
      </CardContent>
    </Card>
  );
}
