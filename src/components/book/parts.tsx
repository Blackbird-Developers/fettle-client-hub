import { type ReactNode, type RefObject, useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, CircleCheck, Info } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PHASE_LABELS } from '@/lib/booking/wizard';

/** Eyebrow, heading (focused on each new step) and sub-text. */
export function StepHeader({
  eyebrow,
  eyebrowIcon,
  warning,
  question,
  heading,
  sub,
  headingRef,
}: {
  eyebrow?: string;
  eyebrowIcon?: ReactNode;
  warning?: boolean;
  question?: number;
  heading: string;
  sub?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement>;
}) {
  return (
    <header>
      {question ? <p className="bw-question-no">Question {question}</p> : null}
      {eyebrow && (
        <p className={`bw-eyebrow${warning ? ' is-warning' : ''}`}>
          {eyebrowIcon}
          {eyebrow}
        </p>
      )}
      <h1 className="bw-heading" tabIndex={-1} ref={headingRef}>
        {heading}
      </h1>
      {sub && <p className="bw-sub">{sub}</p>}
    </header>
  );
}

/** A large single-choice row with icon, title, description and tick (§3.1). */
export function OptionRow({
  icon,
  title,
  description,
  selected,
  onSelect,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" className="bw-option" aria-pressed={selected} onClick={onSelect}>
      {icon && <span className="bw-option-icon">{icon}</span>}
      <span className="bw-option-text">
        <span className="bw-option-title">{title}</span>
        {description && <span className="bw-option-desc">{description}</span>}
      </span>
      <span className="bw-tick" aria-hidden="true">
        <Check className="h-4 w-4" strokeWidth={3} />
      </span>
    </button>
  );
}

function useIsDesktop() {
  const [desktop, setDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 761px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 761px)');
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

/** The step's main button (sticky on phones), with the "or press Enter" hint on desktop. */
export function ActionBar({
  label,
  enabled,
  onContinue,
  showEnterHint = true,
  children,
}: {
  label: string;
  enabled: boolean;
  onContinue: () => void;
  showEnterHint?: boolean;
  children?: ReactNode;
}) {
  const desktop = useIsDesktop();
  return (
    <div className="bw-actions">
      <button type="button" className="bw-btn bw-btn-primary" disabled={!enabled} onClick={onContinue} data-bw-continue>
        {label}
      </button>
      {showEnterHint && enabled && desktop && <span className="bw-hint">or press Enter ↵</span>}
      {children}
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Therapist photo, or initials when there's no (working) photo. */
export function WizardAvatar({ name, imageUrl, size }: { name: string; imageUrl?: string | null; size: number }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [imageUrl]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  if (imageUrl && !broken) {
    return (
      <img
        className="bw-avatar"
        src={imageUrl}
        alt={name}
        style={style}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="bw-avatar" style={style} aria-hidden="true">
      {initials(name) || '?'}
    </span>
  );
}

/** Back button and the five-phase progress bar (§2). Phase -1 = intro, 5 = done. */
export function ProgressBar({
  phase,
  firstLabel,
  onBack,
  avatar,
}: {
  phase: number;
  firstLabel: string;
  onBack?: () => void;
  avatar?: ReactNode;
}) {
  const labels = [firstLabel, ...PHASE_LABELS.slice(1)];
  const pct = phase < 0 ? 0 : Math.min(100, ((phase + 0.5) / labels.length) * 100);
  return (
    <div className="bw-progress">
      {onBack ? (
        <button type="button" className="bw-back" onClick={onBack} aria-label="Back">
          <ChevronLeft className="h-5 w-5" />
        </button>
      ) : null}
      <div className="bw-phases">
        <div className="bw-phase-labels" aria-hidden="true">
          {labels.map((label, i) => (
            <span key={label} className={i === phase ? 'is-current' : i < phase ? 'is-done' : undefined}>
              {label}
            </span>
          ))}
        </div>
        <div
          className="bw-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct)}
          aria-label={phase >= 0 && phase < labels.length ? `Step: ${labels[phase]}` : 'Progress'}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      {avatar}
    </div>
  );
}

export interface WizardMessage {
  kind: 'error' | 'warning' | 'info' | 'success';
  title: string;
  text: string;
  buttons?: { label: string; primary?: boolean; onClick: () => void }[];
}

/** Centred message modal with an icon; the wizard never uses alert() (§7.3). */
export function MessageDialog({ message, onClose }: { message: WizardMessage | null; onClose: () => void }) {
  const icon =
    message?.kind === 'success' ? (
      <CircleCheck className="h-7 w-7" />
    ) : message?.kind === 'info' ? (
      <Info className="h-7 w-7" />
    ) : (
      <AlertTriangle className="h-7 w-7" />
    );
  const color =
    message?.kind === 'success' ? 'var(--bw-green)' : message?.kind === 'info' ? 'var(--bw-blue)' : 'var(--bw-orange)';
  const buttons = message?.buttons?.length ? message.buttons : [{ label: 'OK', primary: true, onClick: onClose }];
  return (
    <Dialog open={!!message} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="booking-wizard max-w-md text-center" style={{ padding: 32 }}>
        <div className="mx-auto mb-2 grid place-items-center" style={{ color }}>
          {icon}
        </div>
        <DialogTitle className="bw-heading" style={{ fontSize: 22 }}>
          {message?.title}
        </DialogTitle>
        <DialogDescription className="bw-sub" style={{ fontSize: 16 }}>
          {message?.text}
        </DialogDescription>
        <div className="mt-6 grid gap-3">
          {buttons.map((b) => (
            <button
              key={b.label}
              type="button"
              className={`bw-btn ${b.primary ? 'bw-btn-primary' : 'bw-btn-ghost'} bw-btn-block`}
              onClick={b.onClick}
            >
              {b.label}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
