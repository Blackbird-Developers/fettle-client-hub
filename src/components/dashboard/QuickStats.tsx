import { Calendar, Clock, TrendingUp, Target } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAcuityAppointments } from "@/hooks/useAcuity";
import { useAuth } from "@/contexts/AuthContext";
import { parseISO, isBefore, isAfter, startOfMonth, endOfMonth, differenceInWeeks, subWeeks } from "date-fns";

export function QuickStats() {
  const { profile } = useAuth();
  const { appointments, loading } = useAcuityAppointments(profile?.email);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <div>
                  <Skeleton className="h-7 w-12 mb-1" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  // Filter completed (past, non-cancelled) sessions
  const completedSessions = appointments.filter(apt => {
    const aptDate = parseISO(apt.datetime);
    return isBefore(aptDate, now) && !apt.canceled;
  });

  // Sessions this month
  const sessionsThisMonth = completedSessions.filter(apt => {
    const aptDate = parseISO(apt.datetime);
    return isAfter(aptDate, monthStart) && isBefore(aptDate, monthEnd);
  }).length;

  // Total hours (sum of durations)
  const totalMinutes = completedSessions.reduce((sum, apt) => {
    return sum + parseInt(apt.duration || '0', 10);
  }, 0);
  const totalHours = (totalMinutes / 60).toFixed(1);

  // Calculate weekly streak
  const calculateWeeklyStreak = () => {
    if (completedSessions.length === 0) return 0;

    const sortedSessions = [...completedSessions].sort((a, b) => 
      new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
    );

    let streak = 0;
    let checkWeek = now;

    // Check each week going backwards
    for (let i = 0; i < 52; i++) {
      const weekStart = subWeeks(checkWeek, 1);
      const hasSessionInWeek = sortedSessions.some(session => {
        const sessionDate = parseISO(session.datetime);
        return isAfter(sessionDate, weekStart) && isBefore(sessionDate, checkWeek);
      });

      if (hasSessionInWeek) {
        streak++;
        checkWeek = weekStart;
      } else {
        break;
      }
    }

    return streak;
  };

  const weeklyStreak = calculateWeeklyStreak();

  // Upcoming sessions count
  const upcomingSessions = appointments.filter(apt => {
    const aptDate = parseISO(apt.datetime);
    return isAfter(aptDate, now) && !apt.canceled;
  }).length;

  const stats = [
    {
      label: "Sessions This Month",
      value: sessionsThisMonth.toString(),
      icon: Calendar,
      color: "text-primary",
      bgColor: "bg-primary/10",
    },
    {
      label: "Total Hours",
      value: totalHours,
      icon: Clock,
      color: "text-info",
      bgColor: "bg-info/10",
    },
    {
      label: "Week Streak",
      value: weeklyStreak > 0 ? `${weeklyStreak} week${weeklyStreak !== 1 ? 's' : ''}` : "—",
      icon: TrendingUp,
      color: "text-success",
      bgColor: "bg-success/10",
    },
    {
      label: "Upcoming",
      value: upcomingSessions.toString(),
      icon: Target,
      color: "text-warning",
      bgColor: "bg-warning/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
      {stats.map((stat, index) => (
        <Card 
          key={stat.label} 
          className="border-border/50 hover:shadow-soft transition-shadow duration-300"
          style={{ animationDelay: `${index * 0.05}s` }}
        >
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className={`p-2 sm:p-2.5 rounded-xl ${stat.bgColor} shrink-0`}>
                <stat.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${stat.color}`} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-lg sm:text-2xl font-heading font-bold text-card-foreground truncate">
                  {stat.value}
                </p>
                <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{stat.label}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
