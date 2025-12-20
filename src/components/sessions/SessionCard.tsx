import { Calendar, Clock, User, Video, MapPin } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface Session {
  id: string;
  therapistName: string;
  therapistAvatar?: string;
  date: string;
  time: string;
  duration: string;
  type: "video" | "in-person";
  status: "upcoming" | "completed" | "cancelled";
  sessionType: string;
}

interface SessionCardProps {
  session: Session;
  variant?: "default" | "compact";
}

export function SessionCard({ session, variant = "default" }: SessionCardProps) {
  const statusColors = {
    upcoming: "bg-info/10 text-info border-info/20",
    completed: "bg-success/10 text-success border-success/20",
    cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  };

  const isCompact = variant === "compact";

  return (
    <Card className={cn(
      "group transition-all duration-300 hover:shadow-elevated border-border/50",
      isCompact ? "p-4" : ""
    )}>
      <CardContent className={cn(isCompact ? "p-0" : "p-6")}>
        <div className={cn(
          "flex gap-4",
          isCompact ? "items-center" : "flex-col sm:flex-row sm:items-start"
        )}>
          {/* Therapist Avatar */}
          <div className={cn(
            "rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0",
            isCompact ? "h-12 w-12" : "h-14 w-14"
          )}>
            <User className={cn("text-primary", isCompact ? "h-5 w-5" : "h-6 w-6")} />
          </div>

          {/* Session Details */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4 mb-2">
              <div>
                <h3 className={cn(
                  "font-heading font-semibold text-card-foreground",
                  isCompact ? "text-sm" : "text-lg"
                )}>
                  {session.therapistName}
                </h3>
                <p className="text-sm text-muted-foreground">{session.sessionType}</p>
              </div>
              <Badge variant="outline" className={statusColors[session.status]}>
                {session.status}
              </Badge>
            </div>

            <div className={cn(
              "flex flex-wrap gap-4 text-sm text-muted-foreground",
              isCompact ? "mt-1" : "mt-3"
            )}>
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" />
                {session.date}
              </span>
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                {session.time} ({session.duration})
              </span>
              <span className="flex items-center gap-1.5">
                {session.type === "video" ? (
                  <>
                    <Video className="h-4 w-4" />
                    Video Call
                  </>
                ) : (
                  <>
                    <MapPin className="h-4 w-4" />
                    In-Person
                  </>
                )}
              </span>
            </div>

            {!isCompact && session.status === "upcoming" && (
              <div className="flex gap-3 mt-4">
                <Button size="sm" className="shadow-soft">
                  Join Session
                </Button>
                <Button size="sm" variant="outline">
                  Reschedule
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
