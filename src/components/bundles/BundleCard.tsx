import { AlertTriangle, CalendarClock, CheckCircle, Gift } from 'lucide-react';
import {
  bundleWarnings,
  expiryLabel,
  sessionsLeftLabel,
  summariseBundle,
  type BundleLike,
} from '@/lib/bundles';
import { cn } from '@/lib/utils';

interface BundleCardProps {
  bundle: BundleLike;
  /** Why this bundle can't pay for the session being booked; greys it out. */
  unusableReason?: string | null;
  /** Makes the card a choice (booking confirm step). */
  onSelect?: () => void;
  selected?: boolean;
  className?: string;
}

// One session bundle: name, sessions left, what it covers, expiry and any
// warnings. Used on the dashboard and the booking confirm step.
export function BundleCard({ bundle, unusableReason, onSelect, selected, className }: BundleCardProps) {
  const s = summariseBundle(bundle);
  const warnings = unusableReason ? [] : bundleWarnings(s);
  const percentLeft = s.total > 0 ? (s.remaining / s.total) * 100 : 0;

  const body = (
    <div className="flex items-start gap-3 min-w-0">
      <div className={cn('p-2 rounded-lg shrink-0', unusableReason ? 'bg-muted' : 'bg-success/10')}>
        <Gift className={cn('h-4 w-4', unusableReason ? 'text-muted-foreground' : 'text-success')} />
      </div>
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-sm text-foreground break-words">{s.name}</p>
          {selected && <CheckCircle className="h-4 w-4 text-success shrink-0" />}
        </div>
        <p className="text-xs text-muted-foreground">
          {s.coversLabel} · {sessionsLeftLabel(s)}
        </p>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden" aria-hidden>
          <div
            className={cn(
              'h-full rounded-full',
              unusableReason ? 'bg-muted-foreground/40' : s.lowCredits ? 'bg-amber-500' : 'bg-success'
            )}
            style={{ width: `${percentLeft}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <CalendarClock className="h-3 w-3 shrink-0" />
          {expiryLabel(s)}
        </p>
        {warnings.map((w) => (
          <p key={w} className="text-xs font-medium text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {w}
          </p>
        ))}
        {unusableReason && <p className="text-xs text-muted-foreground italic">{unusableReason}</p>}
      </div>
    </div>
  );

  const frame = cn(
    'w-full rounded-lg border p-3 text-left',
    unusableReason ? 'border-dashed border-border bg-muted/30' : 'border-border bg-background/80',
    selected && 'border-success ring-2 ring-success/20 bg-success/5',
    className
  );

  if (onSelect && !unusableReason) {
    return (
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={!!selected}
        className={cn(frame, 'transition-all hover:border-success/50')}
      >
        {body}
      </button>
    );
  }
  return <div className={frame}>{body}</div>;
}
