import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SessionCard, Session } from "@/components/sessions/SessionCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

const upcomingSessions: Session[] = [
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

const pastSessions: Session[] = [
  {
    id: "3",
    therapistName: "Dr. Emma O'Brien",
    date: "Dec 15, 2025",
    time: "10:00 AM",
    duration: "50 min",
    type: "video",
    status: "completed",
    sessionType: "Individual Therapy",
  },
  {
    id: "4",
    therapistName: "Dr. Emma O'Brien",
    date: "Dec 8, 2025",
    time: "10:00 AM",
    duration: "50 min",
    type: "video",
    status: "completed",
    sessionType: "Individual Therapy",
  },
  {
    id: "5",
    therapistName: "Dr. Liam Walsh",
    date: "Dec 1, 2025",
    time: "2:00 PM",
    duration: "50 min",
    type: "in-person",
    status: "cancelled",
    sessionType: "Couples Therapy",
  },
];

export default function Sessions() {
  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-8 animate-fade-in">
        <div>
          <h1 className="font-heading text-3xl font-bold text-foreground">
            My Sessions
          </h1>
          <p className="text-muted-foreground mt-1">
            View and manage your therapy sessions
          </p>
        </div>
        <Button className="gap-2 shadow-soft">
          <Plus className="h-4 w-4" />
          Book New Session
        </Button>
      </div>

      <Tabs defaultValue="upcoming" className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <TabsList className="mb-6">
          <TabsTrigger value="upcoming">
            Upcoming ({upcomingSessions.length})
          </TabsTrigger>
          <TabsTrigger value="past">
            Past ({pastSessions.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="space-y-4">
          {upcomingSessions.length > 0 ? (
            upcomingSessions.map((session) => (
              <SessionCard key={session.id} session={session} />
            ))
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <p>No upcoming sessions</p>
              <Button className="mt-4 gap-2">
                <Plus className="h-4 w-4" />
                Book Your First Session
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="past" className="space-y-4">
          {pastSessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  );
}
