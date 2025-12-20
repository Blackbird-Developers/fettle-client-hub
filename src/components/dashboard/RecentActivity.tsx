import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Calendar, FileText, Star } from "lucide-react";

const activities = [
  {
    icon: Check,
    title: "Session completed",
    description: "Individual Therapy with Dr. Emma O'Brien",
    time: "2 days ago",
    color: "text-success",
    bgColor: "bg-success/10",
  },
  {
    icon: FileText,
    title: "Invoice paid",
    description: "Invoice #INV-2024-042 - €85.00",
    time: "5 days ago",
    color: "text-info",
    bgColor: "bg-info/10",
  },
  {
    icon: Calendar,
    title: "Session booked",
    description: "Upcoming session on Dec 22",
    time: "1 week ago",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    icon: Star,
    title: "Feedback submitted",
    description: "You rated your session 5 stars",
    time: "2 weeks ago",
    color: "text-warning",
    bgColor: "bg-warning/10",
  },
];

export function RecentActivity() {
  return (
    <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.2s" }}>
      <CardHeader className="pb-3">
        <CardTitle className="font-heading text-lg">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-4">
          {activities.map((activity, index) => (
            <div key={index} className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${activity.bgColor} flex-shrink-0`}>
                <activity.icon className={`h-4 w-4 ${activity.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-card-foreground">
                  {activity.title}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {activity.description}
                </p>
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {activity.time}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
