import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Tone } from "./chartStyle";

/** A headline number with its change against the comparison period. */
export function MetricTile({
  label,
  value,
  detail,
  change,
  tone = "neutral",
  onClick,
  actionLabel,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
  change?: string | null;
  tone?: Tone;
  /** Makes the tile a button (e.g. to open the customers behind it). */
  onClick?: () => void;
  /** Screen-reader text for what clicking does. */
  actionLabel?: string;
}) {
  const body = (
    <CardContent className="p-4 text-left">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-heading font-bold text-card-foreground">{value}</p>
      {change && (
        <p
          className={cn(
            "mt-1 text-xs font-medium",
            tone === "up" && "text-green-700 dark:text-green-500",
            tone === "down" && "text-red-700 dark:text-red-400",
            tone === "neutral" && "text-muted-foreground"
          )}
        >
          {change}
        </p>
      )}
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
    </CardContent>
  );

  if (!onClick) return <Card className="border-border/50">{body}</Card>;
  return (
    <Card className="border-border/50 transition-shadow hover:shadow-soft focus-within:ring-2 focus-within:ring-ring">
      <button type="button" onClick={onClick} className="w-full rounded-lg focus:outline-none">
        {body}
        {actionLabel && <span className="sr-only">{actionLabel}</span>}
      </button>
    </Card>
  );
}


/** A legend whose entries switch their series on and off. */
export function ToggleLegend({
  items,
  hidden,
  onToggle,
}: {
  items: { key: string; label: string; color: string; dashed?: boolean }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Show or hide lines">
      {items.map((item) => {
        const shown = !hidden.has(item.key);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={shown}
            onClick={() => onToggle(item.key)}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs transition-colors",
              shown ? "border-border bg-background text-foreground" : "border-dashed text-muted-foreground"
            )}
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: shown ? item.color : "transparent", border: `2px solid ${item.color}` }}
              aria-hidden
            />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/** A static legend for charts whose series can't be switched off. */
export function StaticLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Tooltip box matching the app's chart tooltips. */
export function TooltipBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-w-[10rem] gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium text-foreground">{title}</p>
      {children}
    </div>
  );
}
