import { Calendar, Clock, TrendingUp, Heart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const stats = [
  {
    label: "Sessions This Month",
    value: "4",
    icon: Calendar,
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    label: "Total Hours",
    value: "12.5",
    icon: Clock,
    color: "text-info",
    bgColor: "bg-info/10",
  },
  {
    label: "Streak",
    value: "8 weeks",
    icon: TrendingUp,
    color: "text-success",
    bgColor: "bg-success/10",
  },
  {
    label: "Wellness Score",
    value: "85%",
    icon: Heart,
    color: "text-accent",
    bgColor: "bg-accent/10",
  },
];

export function QuickStats() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
      {stats.map((stat, index) => (
        <Card 
          key={stat.label} 
          className="border-border/50 hover:shadow-soft transition-shadow duration-300"
          style={{ animationDelay: `${index * 0.05}s` }}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className={`p-2.5 rounded-xl ${stat.bgColor}`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-2xl font-heading font-bold text-card-foreground">
                  {stat.value}
                </p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
