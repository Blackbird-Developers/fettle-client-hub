import { Sun, Moon, Cloud } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Skeleton } from "@/components/ui/skeleton";

function getGreeting(): { text: string; icon: typeof Sun } {
  const hour = new Date().getHours();
  if (hour < 12) return { text: "Good morning", icon: Sun };
  if (hour < 18) return { text: "Good afternoon", icon: Cloud };
  return { text: "Good evening", icon: Moon };
}

export function WelcomeHeader() {
  const greeting = getGreeting();
  const Icon = greeting.icon;
  const { profile, loading } = useAuth();

  const displayName = profile?.first_name || profile?.email?.split('@')[0] || "there";

  if (loading) {
    return (
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center gap-3 mb-2">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <Skeleton className="h-9 w-64" />
        </div>
        <Skeleton className="h-5 w-72 ml-14" />
      </div>
    );
  }

  return (
    <div className="mb-8 animate-fade-in">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-xl bg-primary/10">
          <Icon className="h-6 w-6 text-primary" />
        </div>
        <h1 className="font-heading text-3xl font-bold text-foreground">
          {greeting.text}, {displayName}
        </h1>
      </div>
      <p className="text-muted-foreground ml-14">
        Here's an overview of your therapy journey
      </p>
    </div>
  );
}
