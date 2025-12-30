import { format, parseISO, isPast } from 'date-fns';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, Calendar, Clock, User, Video, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { useAcuityAppointments, AcuityAppointment } from "@/hooks/useAcuity";
import { useAuth } from "@/contexts/AuthContext";

function CompactSessionCard({ appointment }: { appointment: AcuityAppointment }) {
  const dateTime = parseISO(appointment.datetime);
  const isVideo = appointment.location?.toLowerCase().includes('video') || 
                  appointment.location?.toLowerCase().includes('online') ||
                  appointment.location?.toLowerCase().includes('zoom');

  return (
    <Card className="group transition-all duration-300 hover:shadow-elevated border-border/50">
      <CardContent className="p-4">
        <div className="flex gap-4 items-center">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <User className="h-5 w-5 text-primary" />
          </div>

          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="min-w-0 flex-1">
                <h3 className="font-heading font-semibold text-card-foreground text-sm truncate">
                  {appointment.calendar}
                </h3>
                <p className="text-sm text-muted-foreground truncate">{appointment.type}</p>
              </div>
              <Badge variant="outline" className="bg-info/10 text-info border-info/20 shrink-0">
                Upcoming
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate">{format(dateTime, 'MMM d, yyyy')}</span>
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate">{format(dateTime, 'h:mm a')}</span>
              </span>
              <span className="flex items-center gap-1">
                {isVideo ? (
                  <>
                    <Video className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                    Video
                  </>
                ) : (
                  <>
                    <MapPin className="h-3 w-3 sm:h-4 sm:w-4 shrink-0" />
                    In-Person
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SessionSkeleton() {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex gap-4 items-center">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-16" />
            </div>
            <div className="flex gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function UpcomingSessions() {
  const { user } = useAuth();
  const { appointments, loading, error } = useAcuityAppointments(user?.email);
  
  const upcomingSessions = appointments
    .filter(apt => !apt.canceled && !isPast(parseISO(apt.datetime)))
    .slice(0, 2);

  return (
    <section className="animate-fade-in overflow-hidden" style={{ animationDelay: "0.1s" }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4 min-w-0">
        <h2 className="font-heading text-xl font-semibold text-foreground min-w-0">
          Upcoming Sessions
        </h2>
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="text-primary hover:text-primary/80 self-start sm:self-auto"
        >
          <Link to="/sessions" className="flex items-center gap-1">
            View all
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
      
      <div className="space-y-4">
        {loading ? (
          <>
            <SessionSkeleton />
            <SessionSkeleton />
          </>
        ) : error ? (
          <Card className="border-border/50">
            <CardContent className="p-6 text-center text-muted-foreground">
              <p>Unable to load sessions</p>
            </CardContent>
          </Card>
        ) : upcomingSessions.length > 0 ? (
          upcomingSessions.map((appointment) => (
            <CompactSessionCard key={appointment.id} appointment={appointment} />
          ))
        ) : (
          <Card className="border-border/50">
            <CardContent className="p-6 text-center text-muted-foreground">
              <p>No upcoming sessions</p>
              <Button size="sm" className="mt-3" asChild>
                <Link to="/sessions">Book a Session</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
