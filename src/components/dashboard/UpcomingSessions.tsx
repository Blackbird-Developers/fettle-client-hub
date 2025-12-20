import { SessionCard, Session } from "@/components/sessions/SessionCard";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";

const mockSessions: Session[] = [
  {
    id: "1",
    therapistName: "Dr. Emma O'Brien",
    date: "Dec 22, 2025",
    time: "10:00 AM",
    duration: "50 min",
    type: "video",
    status: "upcoming",
    sessionType: "Individual Therapy",
  },
  {
    id: "2",
    therapistName: "Dr. Liam Walsh",
    date: "Dec 28, 2025",
    time: "2:30 PM",
    duration: "50 min",
    type: "in-person",
    status: "upcoming",
    sessionType: "Couples Therapy",
  },
];

export function UpcomingSessions() {
  return (
    <section className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-xl font-semibold text-foreground">
          Upcoming Sessions
        </h2>
        <Button variant="ghost" size="sm" asChild className="text-primary hover:text-primary/80">
          <Link to="/sessions" className="flex items-center gap-1">
            View all
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      
      <div className="space-y-4">
        {mockSessions.map((session) => (
          <SessionCard key={session.id} session={session} />
        ))}
      </div>
    </section>
  );
}
