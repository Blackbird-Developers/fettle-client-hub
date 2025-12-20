import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { FileText } from "lucide-react";

export default function Invoices() {
  return (
    <DashboardLayout>
      <div className="mb-8 animate-fade-in">
        <h1 className="font-heading text-3xl font-bold text-foreground">
          Invoices
        </h1>
        <p className="text-muted-foreground mt-1">
          View and download your therapy invoices
        </p>
      </div>

      <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="p-4 rounded-full bg-muted/50 mb-4">
            <FileText className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="font-heading text-lg font-semibold text-foreground mb-2">
            No invoices available
          </h3>
          <p className="text-muted-foreground text-center max-w-md">
            Invoice management is not available through Acuity Scheduling. 
            Please contact your therapist directly for billing inquiries.
          </p>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
