import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAcuityAppointments } from "@/hooks/useAcuity";
import { useAuth } from "@/contexts/AuthContext";
import { 
  Trophy, 
  Target, 
  Flame, 
  Star,
  Award,
  Zap,
  Heart,
  Sparkles
} from "lucide-react";
import { differenceInWeeks, parseISO, isAfter, isBefore, subDays } from "date-fns";

interface Milestone {
  id: string;
  title: string;
  description: string;
  icon: typeof Trophy;
  threshold: number;
  achieved: boolean;
  color: string;
}

export function ProgressDashboard() {
  const { profile } = useAuth();
  const { appointments, loading } = useAcuityAppointments(profile?.email);

  if (loading) {
    return (
      <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.15s" }}>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  const now = new Date();
  
  // Filter completed (past, non-cancelled) sessions
  const completedSessions = appointments.filter(apt => {
    const aptDate = parseISO(apt.datetime);
    return isBefore(aptDate, now) && !apt.canceled;
  });

  // Filter upcoming sessions
  const upcomingSessions = appointments.filter(apt => {
    const aptDate = parseISO(apt.datetime);
    return isAfter(aptDate, now) && !apt.canceled;
  });

  const totalCompleted = completedSessions.length;
  const totalUpcoming = upcomingSessions.length;

  // Calculate streak (sessions in consecutive weeks)
  const calculateStreak = () => {
    if (completedSessions.length === 0) return 0;
    
    const sortedSessions = [...completedSessions].sort((a, b) => 
      new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
    );
    
    let streak = 0;
    const thirtyDaysAgo = subDays(now, 30);
    
    for (const session of sortedSessions) {
      const sessionDate = parseISO(session.datetime);
      if (isAfter(sessionDate, thirtyDaysAgo)) {
        streak++;
      } else {
        break;
      }
    }
    
    return Math.min(streak, 4); // Cap at 4 for display
  };

  const currentStreak = calculateStreak();

  // Define milestones
  const milestones: Milestone[] = [
    {
      id: 'first',
      title: 'First Step',
      description: 'Complete your first session',
      icon: Star,
      threshold: 1,
      achieved: totalCompleted >= 1,
      color: 'text-yellow-500',
    },
    {
      id: 'committed',
      title: 'Getting Started',
      description: 'Complete 3 sessions',
      icon: Zap,
      threshold: 3,
      achieved: totalCompleted >= 3,
      color: 'text-blue-500',
    },
    {
      id: 'dedicated',
      title: 'Dedicated',
      description: 'Complete 5 sessions',
      icon: Heart,
      threshold: 5,
      achieved: totalCompleted >= 5,
      color: 'text-pink-500',
    },
    {
      id: 'consistent',
      title: 'Consistent',
      description: 'Complete 10 sessions',
      icon: Award,
      threshold: 10,
      achieved: totalCompleted >= 10,
      color: 'text-purple-500',
    },
    {
      id: 'champion',
      title: 'Wellness Champion',
      description: 'Complete 20 sessions',
      icon: Trophy,
      threshold: 20,
      achieved: totalCompleted >= 20,
      color: 'text-amber-500',
    },
  ];

  const achievedMilestones = milestones.filter(m => m.achieved);
  const nextMilestone = milestones.find(m => !m.achieved);
  const progressToNext = nextMilestone 
    ? Math.min((totalCompleted / nextMilestone.threshold) * 100, 100)
    : 100;

  return (
    <Card className="border-border/50 animate-fade-in" style={{ animationDelay: "0.15s" }}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="font-heading text-lg flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            Your Progress
          </CardTitle>
          {currentStreak > 0 && (
            <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 border-orange-500/20 gap-1">
              <Flame className="h-3 w-3" />
              {currentStreak} this month
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-accent/50 rounded-xl p-3 text-center">
            <p className="text-2xl font-heading font-bold text-primary">{totalCompleted}</p>
            <p className="text-xs text-muted-foreground">Sessions Completed</p>
          </div>
          <div className="bg-accent/50 rounded-xl p-3 text-center">
            <p className="text-2xl font-heading font-bold text-foreground">{totalUpcoming}</p>
            <p className="text-xs text-muted-foreground">Upcoming</p>
          </div>
        </div>

        {/* Next Milestone Progress */}
        {nextMilestone && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Next milestone</span>
              <span className="font-medium flex items-center gap-1">
                <nextMilestone.icon className={`h-4 w-4 ${nextMilestone.color}`} />
                {nextMilestone.title}
              </span>
            </div>
            <Progress value={progressToNext} className="h-2" />
            <p className="text-xs text-muted-foreground text-right">
              {totalCompleted}/{nextMilestone.threshold} sessions
            </p>
          </div>
        )}

        {/* Achieved Milestones */}
        {achievedMilestones.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground flex items-center gap-1">
              <Sparkles className="h-4 w-4 text-primary" />
              Milestones Achieved
            </p>
            <div className="flex flex-wrap gap-2">
              {achievedMilestones.map((milestone) => (
                <Badge 
                  key={milestone.id}
                  variant="outline" 
                  className="gap-1.5 py-1 px-2"
                >
                  <milestone.icon className={`h-3.5 w-3.5 ${milestone.color}`} />
                  {milestone.title}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Empty state for new users */}
        {totalCompleted === 0 && totalUpcoming === 0 && (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">
              Book your first session to start tracking your progress!
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
