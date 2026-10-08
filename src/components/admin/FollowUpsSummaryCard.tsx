import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowRight, PhoneCall } from "lucide-react";
import { useCustomerFollowups } from "@/hooks/useAdmin";
import { followUpLater, followUpTiming } from "@/lib/contactOutcomes";

/** Overview card: how many "continue later" customers are due a call. */
export function FollowUpsSummaryCard() {
  const followups = useCustomerFollowups();
  // Nothing to show until the follow-ups table exists.
  if (followups.isError) return null;

  const rows = followups.data ?? [];
  const later = followUpLater(rows);
  const kinds = later.map((row) => followUpTiming(row.follow_up_due!).kind);
  const dueNow = kinds.filter((k) => k === "overdue" || k === "today").length;
  const dueWeek = kinds.filter((k) => k === "soon").length;
  const notContinuing = rows.filter((row) => row.outcome === "not_continuing").length;

  const figures = [
    { label: "To call now", value: dueNow, tone: dueNow > 0 ? "text-red-600" : "" },
    { label: "Due in the next 7 days", value: dueWeek, tone: "" },
    { label: "Continue later (all)", value: later.length, tone: "" },
    { label: "Not continuing", value: notContinuing, tone: "" },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-primary" />
          Follow-ups
        </CardTitle>
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to="/admin/followups">
            Open report
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {figures.map((figure) => (
            <div key={figure.label} className="rounded-lg bg-muted/50 p-3">
              {followups.isPending ? (
                <Skeleton className="h-7 w-10" />
              ) : (
                <p className={`text-2xl font-bold ${figure.tone}`}>{figure.value}</p>
              )}
              <p className="text-xs text-muted-foreground">{figure.label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
