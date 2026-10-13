import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import {
  type AdminDataSource,
  LOAD_PROFILES,
  estimateLoad,
  formatRemaining,
  getLoadStart,
  readExpectedDuration,
} from "@/lib/adminLoadProgress";

const TICK_MS = 250;

/**
 * Loading state for the Acuity-backed admin pages: a progress bar, time left
 * and the steps the edge function works through. Progress is estimated from
 * how long recent loads took in this browser (see lib/adminLoadProgress.ts).
 */
export function AdminDataLoader({ source }: { source: AdminDataSource }) {
  const profile = LOAD_PROFILES[source];
  const [startedAt] = useState(() => getLoadStart(source) ?? Date.now());
  const [expectedMs] = useState(() => readExpectedDuration(source));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const { percent, remainingMs, overdue, activeStep } = estimateLoad(profile, now - startedAt, expectedMs);
  const title = `Loading ${profile.label} from Acuity`;

  return (
    <div className="space-y-4">
      <Card className="border-border/50">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-card-foreground">{title}</p>
            <p className="text-sm font-medium tabular-nums text-muted-foreground" aria-hidden>
              {Math.round(percent)}%
            </p>
          </div>
          <Progress value={percent} className="h-2" aria-label={title} />
          <p className="text-xs text-muted-foreground">
            {overdue ? "Taking a little longer than usual — still working…" : formatRemaining(remainingMs)}
          </p>
          <ol className="space-y-2">
            {profile.steps.map((step, i) => {
              const done = i < activeStep;
              const active = i === activeStep;
              return (
                <li
                  key={step.label}
                  className={cn(
                    "flex items-center gap-2 text-sm",
                    done && "text-muted-foreground",
                    !done && !active && "text-muted-foreground/60"
                  )}
                >
                  {done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  ) : active ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className={cn(active && "font-medium text-foreground")}>{step.label}</span>
                  <span className="sr-only">{done ? "(done)" : active ? "(in progress)" : "(waiting)"}</span>
                </li>
              );
            })}
          </ol>
          {/* Announced only when the step changes, not on every tick. */}
          <p className="sr-only" role="status">
            {profile.steps[activeStep].label}
          </p>
        </CardContent>
      </Card>
      <div className="space-y-4 opacity-50" aria-hidden>
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
