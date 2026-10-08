import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { useContactHistory } from "@/hooks/useAdmin";
import { formatDate, formatDateTime } from "@/lib/customerInsights";
import { type CustomerFollowup, followupErrorMessage } from "@/lib/customerFollowups";
import {
  type ContactOutcome,
  type NotContinuingReason,
  CONTACT_OUTCOMES,
  NOT_CONTINUING_REASONS,
  OUTCOME_LABELS,
  REASON_OTHER_MAX_LENGTH,
  attemptsLabel,
  describeReasons,
  followUpTiming,
  followUpTimingLabel,
  isContactOutcome,
  validateReasons,
} from "@/lib/contactOutcomes";
import { OUTCOME_ICONS } from "./outcomeIcons";

// Shared pieces for contact outcomes: the badge, the four primary buttons,
// the "not continuing" reasons popup and the contact history. Used on the
// Progression pages, in the bulk bar and on the Follow-ups report.

const OUTCOME_STYLES: Record<ContactOutcome, string> = {
  no_answer: "bg-amber-50 text-amber-700 border-amber-200",
  not_continuing: "bg-red-50 text-red-700 border-red-200",
  follow_up_later: "bg-violet-50 text-violet-700 border-violet-200",
  booked: "bg-green-50 text-green-700 border-green-200",
};

const TIMING_STYLES = {
  overdue: "text-red-700",
  today: "text-amber-700",
  soon: "text-amber-700",
  upcoming: "text-muted-foreground",
} as const;

const byLine = (email: string | null, at: string | null) =>
  [email && `by ${email}`, at && `on ${formatDateTime(at)}`].filter(Boolean).join(" ");

/** Badge for the customer's current outcome, with the details in a tooltip. */
export function OutcomeBadge({ followup }: { followup: CustomerFollowup }) {
  const outcome = followup.outcome;
  if (!isContactOutcome(outcome)) return null;
  const Icon = OUTCOME_ICONS[outcome];
  const reasons = describeReasons(followup.not_continuing_reasons, followup.not_continuing_other);

  return (
    <Tooltip>
      {/* Badge doesn't forward refs, so the span is the tooltip anchor. */}
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge
            variant="outline"
            className={`cursor-default gap-1 whitespace-nowrap ${OUTCOME_STYLES[outcome]}`}
          >
            <Icon className="h-3 w-3" aria-hidden />
            {OUTCOME_LABELS[outcome].short}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        <p className="font-medium">{OUTCOME_LABELS[outcome].label}</p>
        <p>Recorded {byLine(followup.outcome_by_email, followup.outcome_at)}</p>
        {reasons && <p>Reason: {reasons}</p>}
        {followup.follow_up_due && <p>Follow up on {formatDate(followup.follow_up_due)}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The small print under the badge: attempts, when they were last reached, follow-up date. */
export function ContactSummary({ followup }: { followup: CustomerFollowup | undefined }) {
  // attempt_count is missing until the contact-outcomes database update is deployed.
  if (!followup?.attempt_count) return null;
  const timing = followup.follow_up_due ? followUpTiming(followup.follow_up_due) : null;
  const reasons =
    followup.outcome === "not_continuing"
      ? describeReasons(followup.not_continuing_reasons, followup.not_continuing_other)
      : "";

  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      {timing && followup.outcome === "follow_up_later" && (
        <p className={`font-medium ${TIMING_STYLES[timing.kind]}`}>
          Follow up {formatDate(followup.follow_up_due)} · {followUpTimingLabel(timing)}
        </p>
      )}
      {reasons && (
        <p className="max-w-[240px] truncate" title={reasons}>
          {reasons}
        </p>
      )}
      <p>
        {attemptsLabel(followup.attempt_count)}
        {followup.last_reached_at
          ? ` · last spoke ${formatDate(followup.last_reached_at)}`
          : " · not reached yet"}
      </p>
    </div>
  );
}

/**
 * The four primary actions. The current outcome is shown pressed; clicking
 * it again records another attempt (e.g. a second No answer).
 * `acuityBooked` flags that Acuity already shows the next session.
 */
export function OutcomeButtons({
  current,
  customerName,
  disabled,
  pending,
  acuityBooked,
  onSelect,
}: {
  current: string | null | undefined;
  customerName: string | null;
  disabled: boolean;
  pending: ContactOutcome | null;
  acuityBooked?: boolean;
  onSelect: (outcome: ContactOutcome) => void;
}) {
  const name = customerName ?? "customer";
  return (
    <div role="group" aria-label={`Contact outcome for ${name}`} className="grid grid-cols-2 gap-1">
      {CONTACT_OUTCOMES.map((outcome) => {
        const Icon = pending === outcome ? Loader2 : OUTCOME_ICONS[outcome];
        const active = current === outcome;
        const hint = outcome === "booked" && acuityBooked && !active;
        return (
          <Tooltip key={outcome}>
            <TooltipTrigger asChild>
              {/* span keeps the tooltip working while the button is disabled */}
              <span tabIndex={disabled ? 0 : -1} className="flex">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={active}
                  aria-label={`${OUTCOME_LABELS[outcome].label} — ${name}`}
                  disabled={disabled}
                  onClick={() => onSelect(outcome)}
                  className={`relative h-7 w-full justify-start gap-1.5 px-2 text-xs font-normal ${
                    active ? `${OUTCOME_STYLES[outcome]} font-medium hover:opacity-90` : ""
                  }`}
                >
                  <Icon
                    className={`h-3.5 w-3.5 ${pending === outcome ? "animate-spin" : ""}`}
                    aria-hidden
                  />
                  {OUTCOME_LABELS[outcome].short}
                  {hint && (
                    <span
                      className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-green-500"
                      aria-hidden
                    />
                  )}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {OUTCOME_LABELS[outcome].label}
              {hint && " — Acuity already shows their next session"}
              {active && outcome === "no_answer" && " — click again to log another attempt"}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * "What is the reason for not continuing?" popup, for one customer or a
 * bulk selection. `onSubmit` resolves to an error message to show, or null
 * to close.
 */
export function NotContinuingDialog({
  open,
  onOpenChange,
  subject,
  initialReasons = [],
  initialOther = "",
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** e.g. "Ann Archer" or "3 customers" */
  subject: string;
  initialReasons?: readonly string[];
  initialOther?: string | null;
  saving: boolean;
  onSubmit: (reasons: NotContinuingReason[], other: string) => Promise<string | null>;
}) {
  const [reasons, setReasons] = useState<NotContinuingReason[]>([]);
  const [other, setOther] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  // Start each opening from what's saved.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReasons(
        NOT_CONTINUING_REASONS.map((r) => r.id).filter((id) => initialReasons.includes(id))
      );
      setOther(initialOther ?? "");
      setTouched(false);
      setError(null);
    }
  }

  const validation = validateReasons(reasons, other);
  const otherTicked = reasons.includes("other");

  const toggle = (id: NotContinuingReason, checked: boolean) =>
    setReasons((current) => (checked ? [...current, id] : current.filter((r) => r !== id)));

  const handleOpenChange = (next: boolean) => {
    // Keep the dialog open until an in-flight save finishes.
    if (!next && saving) return;
    onOpenChange(next);
  };

  const save = async () => {
    setTouched(true);
    if (saving || validation) return;
    setError(null);
    const failure = await onSubmit(reasons, otherTicked ? other.trim() : "");
    if (failure) setError(failure);
    else onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>What is the reason for not continuing?</DialogTitle>
            <DialogDescription>
              Marks {subject} as not wanting to continue. Tick all that apply.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-3" disabled={saving}>
            <legend className="sr-only">Reasons</legend>
            {NOT_CONTINUING_REASONS.map((reason) => (
              <div key={reason.id} className="flex items-center gap-2">
                <Checkbox
                  id={`reason-${reason.id}`}
                  checked={reasons.includes(reason.id)}
                  onCheckedChange={(checked) => toggle(reason.id, checked === true)}
                />
                <Label htmlFor={`reason-${reason.id}`} className="font-normal">
                  {reason.label}
                </Label>
              </div>
            ))}
            {otherTicked && (
              <div className="space-y-1 pl-6">
                <Textarea
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  placeholder="Enter the reason"
                  rows={3}
                  aria-label="Other reason"
                  aria-invalid={touched && Boolean(validation)}
                  autoFocus
                />
                <p className="text-right text-xs text-muted-foreground">
                  {other.trim().length}/{REASON_OTHER_MAX_LENGTH}
                </p>
              </div>
            )}
          </fieldset>

          {touched && validation && <p className="text-sm text-destructive">{validation}</p>}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Couldn't save: {error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Every outcome recorded for one customer, newest first. */
export function ContactHistoryDialog({
  open,
  onOpenChange,
  customerKey,
  customerName,
  followup,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerKey: string;
  customerName: string | null;
  followup: CustomerFollowup | undefined;
}) {
  const history = useContactHistory(customerKey, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Contact history · {customerName ?? "this customer"}</DialogTitle>
          <DialogDescription>
            {followup?.contacted
              ? `Marked as contacted${
                  followup.contacted_at
                    ? ` ${byLine(followup.contacted_by_email, followup.contacted_at)}`
                    : ""
                }.`
              : "Not reached yet."}
            {followup?.attempt_count ? ` ${attemptsLabel(followup.attempt_count)} logged.` : ""}
          </DialogDescription>
        </DialogHeader>

        {history.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : history.isError ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Couldn't load the history: {followupErrorMessage(history.error)}
            </AlertDescription>
          </Alert>
        ) : history.data.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No outcomes recorded yet.
          </p>
        ) : (
          <ol className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {history.data.map((attempt) => {
              const outcome = attempt.outcome;
              const Icon = isContactOutcome(outcome) ? OUTCOME_ICONS[outcome] : RotateCcw;
              const reasons = describeReasons(attempt.reasons, attempt.reason_other);
              return (
                <li key={attempt.id} className="flex gap-3 text-sm">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div>
                    <p className="font-medium">
                      {isContactOutcome(outcome)
                        ? OUTCOME_LABELS[outcome].label
                        : "Outcome cleared"}
                    </p>
                    {reasons && <p className="text-muted-foreground">Reason: {reasons}</p>}
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(attempt.created_at)}
                      {attempt.created_by_email && ` · ${attempt.created_by_email}`}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {followup?.note && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Note</p>
            <p className="whitespace-pre-line">{followup.note}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
