import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  AlertTriangle,
  Copy,
  History,
  Loader2,
  Mail,
  MoreHorizontal,
  PhoneMissed,
  RotateCcw,
  Search,
  XCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  useCloseSequence,
  useCustomerFollowups,
  useCustomerInsights,
  useNoAnswerSequences,
  useRecordOutcome,
  useRestartSequence,
} from "@/hooks/useAdmin";
import { type CustomerFollowup, followupErrorMessage, isMissingTableError } from "@/lib/customerFollowups";
import {
  type AttemptSource,
  type ContactMethod,
  type ContactOutcome,
  type NotContinuingReason,
  type OutcomeInput,
  ATTEMPT_NOTE_MAX_LENGTH,
  CONTACT_OUTCOMES,
  NOT_CONTINUING_REASONS,
  OUTCOME_LABELS,
  contactFromKey,
  followUpTimingLabel,
  validateReasons,
} from "@/lib/contactOutcomes";
import { formatDate, formatDateTime, matchesSearch } from "@/lib/customerInsights";
import {
  type NoAnswerSequence,
  type SequenceStatus,
  CLOSED_LIST_DAYS,
  MAX_ATTEMPTS,
  METHODS,
  METHOD_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  attemptedToday,
  dueTiming,
  emailDraft,
  firstNameOf,
  groupSequences,
  isContactMethod,
  nextAttemptNumber,
  plannedAttempt,
} from "@/lib/noAnswer";
import { ContactHistoryDialog } from "./ContactOutcomes";
import { CustomerCell, StatTile } from "./CustomerInsightsShared";

const TIMING_STYLES = {
  overdue: "text-red-700",
  today: "text-amber-700",
  soon: "text-muted-foreground",
  upcoming: "text-muted-foreground",
} as const;

type TabId = "due" | "upcoming" | "exhausted" | "closed";

interface SequenceRow {
  sequence: NoAnswerSequence;
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Acuity already shows a booked or completed next session. */
  acuityBooked: boolean;
}

/**
 * No answer page: customers who didn't pick up, with up to six attempts
 * spaced out by the database (see lib/noAnswer.ts for the plan). Staff log
 * each attempt here; any outcome other than No answer ends the sequence.
 */
export function NoAnswer() {
  const sequences = useNoAnswerSequences();
  const followups = useCustomerFollowups();
  // Optional extras (contact details, Acuity booking hint); the page works without them.
  const insights = useCustomerInsights();
  const [tab, setTab] = useState<TabId>("due");
  const [search, setSearch] = useState("");

  const detailsByKey = useMemo(() => {
    const map = new Map<string, { name: string | null; email: string | null; phone: string | null; booked: boolean }>();
    for (const view of [...(insights.data?.progression ?? [])].sort((a, b) => a.fromSession - b.fromSession)) {
      for (const row of view.rows) {
        map.set(row.key, {
          name: row.name,
          email: row.email,
          phone: row.phone,
          booked: row.nextSessionStatus !== "none",
        });
      }
    }
    return map;
  }, [insights.data]);

  const followupsByKey = useMemo(
    () => new Map((followups.data ?? []).map((f) => [f.customer_key, f])),
    [followups.data]
  );

  if (sequences.isPending) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (sequences.isError) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {isMissingTableError(sequences.error)
            ? "Available once the No answer database update is deployed."
            : "Couldn't load the No answer list. Refresh the page to try again."}
        </AlertDescription>
      </Alert>
    );
  }

  const toRow = (sequence: NoAnswerSequence): SequenceRow => {
    const details = detailsByKey.get(sequence.customer_key);
    const fromKey = contactFromKey(sequence.customer_key);
    return {
      sequence,
      key: sequence.customer_key,
      name: sequence.customer_name ?? details?.name ?? null,
      email: details?.email ?? fromKey.email,
      phone: sequence.customer_phone ?? details?.phone ?? fromKey.phone,
      acuityBooked: details?.booked ?? false,
    };
  };

  const groups = groupSequences(sequences.data);
  const rowsOf = (list: NoAnswerSequence[]) => list.map(toRow).filter((row) => matchesSearch(row, search));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile label="To call today" value={String(groups.due.length)} hint="Due today or overdue" />
        <StatTile label="Coming up" value={String(groups.upcoming.length)} />
        <StatTile label="No answer after 6 attempts" value={String(groups.exhausted.length)} />
        <StatTile label={`Ended (last ${CLOSED_LIST_DAYS} days)`} value={String(groups.closed.length)} />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email or phone"
          className="pl-8"
          aria-label="Search customers"
        />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="due">Due today ({groups.due.length})</TabsTrigger>
          <TabsTrigger value="upcoming">Coming up ({groups.upcoming.length})</TabsTrigger>
          <TabsTrigger value="exhausted">Finished ({groups.exhausted.length})</TabsTrigger>
          <TabsTrigger value="closed">Ended ({groups.closed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="due">
          <SequenceCard
            title="Due today"
            description="Customers to try again today, most overdue first. Log every attempt, answered or not."
            rows={rowsOf(groups.due)}
            empty={search ? "No customers match your search." : "Nobody is due a call today."}
            followupsByKey={followupsByKey}
          />
        </TabsContent>
        <TabsContent value="upcoming">
          <SequenceCard
            title="Coming up"
            description="Customers whose next attempt is due later, soonest first."
            rows={rowsOf(groups.upcoming)}
            empty={search ? "No customers match your search." : "No attempts scheduled."}
            followupsByKey={followupsByKey}
          />
        </TabsContent>
        <TabsContent value="exhausted">
          <SequenceCard
            title="No answer after 6 attempts"
            description="A new No answer won't restart these for 60 days. Use Start again from the menu to restart sooner."
            rows={rowsOf(groups.exhausted)}
            empty={search ? "No customers match your search." : "Nobody has reached 6 attempts."}
            followupsByKey={followupsByKey}
            ended
          />
        </TabsContent>
        <TabsContent value="closed">
          <SequenceCard
            title={`Ended in the last ${CLOSED_LIST_DAYS} days`}
            description="Booked, not continuing, continuing later, or closed by staff."
            rows={rowsOf(groups.closed)}
            empty={search ? "No customers match your search." : "No sequences ended recently."}
            followupsByKey={followupsByKey}
            ended
          />
        </TabsContent>
      </Tabs>

      <CadenceNote />
    </div>
  );
}

function CadenceNote() {
  return (
    <p className="text-xs text-muted-foreground">
      Attempts are spaced 1, 2, 4, 7 and 7 days apart (day 0, 1, 3, 7, 14 and 21 when on time), and
      an attempt due at the weekend moves to Monday. Booked, not continuing or continue later ends the
      sequence.
    </p>
  );
}

function SequenceCard({
  title,
  description,
  rows,
  empty,
  followupsByKey,
  ended = false,
}: {
  title: string;
  description: string;
  rows: SequenceRow[];
  empty: string;
  followupsByKey: Map<string, CustomerFollowup>;
  ended?: boolean;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-lg font-heading">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <PhoneMissed className="h-8 w-8" />
            <p className="text-sm">{empty}</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>{ended ? "Result" : "Next attempt"}</TableHead>
                <TableHead>Last attempt</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.sequence.id}>
                  <TableCell>
                    <CustomerCell name={row.name} email={row.email} phone={row.phone} />
                    <Badge variant="outline" className="mt-1 text-[11px] font-normal">
                      {SOURCE_LABELS[row.sequence.source as AttemptSource] ?? row.sequence.source}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <AttemptDots done={row.sequence.attempts_done} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {ended ? <EndedCell sequence={row.sequence} /> : <NextCell row={row} />}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <LastAttemptCell sequence={row.sequence} />
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions row={row} followup={followupsByKey.get(row.key)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AttemptDots({ done }: { done: number }) {
  return (
    <div className="space-y-1">
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: MAX_ATTEMPTS }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 w-2.5 rounded-full ${i < done ? "bg-amber-500" : "bg-muted border border-border"}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {done} of {MAX_ATTEMPTS}
      </p>
    </div>
  );
}

function NextCell({ row }: { row: SequenceRow }) {
  const { sequence } = row;
  const timing = dueTiming(sequence);
  const next = plannedAttempt(nextAttemptNumber(sequence));
  return (
    <div className="space-y-0.5">
      <p>{sequence.next_due_on ? formatDate(sequence.next_due_on) : "Now"}</p>
      {timing && (
        <p className={`text-xs font-medium ${TIMING_STYLES[timing.kind]}`}>{followUpTimingLabel(timing)}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Attempt {next.attempt}: {METHOD_LABELS[next.method]}
        {next.withEmail ? " + email" : ""}
      </p>
      {row.acuityBooked && <p className="text-xs font-medium text-green-700">Booked in Acuity</p>}
    </div>
  );
}

function EndedCell({ sequence }: { sequence: NoAnswerSequence }) {
  return (
    <div className="space-y-0.5">
      <p>{STATUS_LABELS[sequence.status as SequenceStatus] ?? sequence.status}</p>
      <p className="text-xs text-muted-foreground">
        {formatDate(sequence.closed_at)}
        {sequence.closed_by_email && ` · ${sequence.closed_by_email}`}
      </p>
      {sequence.closed_reason && sequence.status === "closed" && (
        <p className="max-w-[220px] whitespace-normal text-xs text-muted-foreground">{sequence.closed_reason}</p>
      )}
    </div>
  );
}

function LastAttemptCell({ sequence }: { sequence: NoAnswerSequence }) {
  if (!sequence.last_attempt_at) return <span className="text-xs text-muted-foreground">None yet</span>;
  return (
    <div className="space-y-0.5">
      <p>{formatDateTime(sequence.last_attempt_at)}</p>
      <p className="text-xs text-muted-foreground">
        {[isContactMethod(sequence.last_method) && METHOD_LABELS[sequence.last_method], sequence.last_attempt_by_email]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

function RowActions({
  row,
  followup,
}: {
  row: SequenceRow;
  followup: CustomerFollowup | undefined;
}) {
  const { toast } = useToast();
  const restart = useRestartSequence();
  const [logOpen, setLogOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const active = row.sequence.status === "active";
  const name = row.name ?? "customer";

  const startAgain = () => {
    restart.mutate(
      { customerKey: row.key, customerName: row.name, customerPhone: row.phone },
      {
        onSuccess: () => toast({ title: "Sequence started again", description: row.name ?? undefined }),
        onError: (error) =>
          toast({ title: "Couldn't start again", description: followupErrorMessage(error), variant: "destructive" }),
      }
    );
  };

  return (
    <div className="flex items-center justify-end gap-1">
      {active && (
        <Button size="sm" onClick={() => setLogOpen(true)}>
          Log attempt
        </Button>
      )}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label={`More actions for ${name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem className="gap-2" onSelect={() => setHistoryOpen(true)}>
            <History className="h-4 w-4" />
            Contact history
          </DropdownMenuItem>
          {active ? (
            <DropdownMenuItem className="gap-2" onSelect={() => setCloseOpen(true)}>
              <XCircle className="h-4 w-4" />
              Close sequence
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="gap-2" disabled={restart.isPending} onSelect={startAgain}>
              <RotateCcw className="h-4 w-4" />
              Start again
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {active && <LogAttemptDialog open={logOpen} onOpenChange={setLogOpen} row={row} />}
      {active && <CloseSequenceDialog open={closeOpen} onOpenChange={setCloseOpen} row={row} />}
      <ContactHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        customerKey={row.key}
        customerName={row.name}
        followup={followup}
      />
    </div>
  );
}

export function LogAttemptDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SequenceRow;
}) {
  const { toast } = useToast();
  const mutation = useRecordOutcome();
  const { sequence } = row;
  const attempt = nextAttemptNumber(sequence);
  const plan = plannedAttempt(attempt);
  const draft = plan.withEmail ? emailDraft(attempt, firstNameOf(row.name)) : null;

  const [method, setMethod] = useState<ContactMethod>(plan.method);
  const [outcome, setOutcome] = useState<ContactOutcome>("no_answer");
  const [reasons, setReasons] = useState<NotContinuingReason[]>([]);
  const [reasonOther, setReasonOther] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  // Start each opening fresh, pre-filled from the plan.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMethod(plan.method);
      setOutcome("no_answer");
      setReasons([]);
      setReasonOther("");
      setNote("");
      setTouched(false);
      setError(null);
    }
  }

  const saving = mutation.isPending;
  const reasonsError = outcome === "not_continuing" ? validateReasons(reasons, reasonOther) : null;
  const noteError =
    note.trim().length > ATTEMPT_NOTE_MAX_LENGTH ? `The note can be up to ${ATTEMPT_NOTE_MAX_LENGTH} characters.` : null;
  const validation = reasonsError ?? noteError;
  const sameDay = attemptedToday(sequence);

  const handleOpenChange = (next: boolean) => {
    if (!next && saving) return;
    onOpenChange(next);
  };

  const save = () => {
    setTouched(true);
    if (saving || validation) return;
    setError(null);
    const input: OutcomeInput =
      outcome === "not_continuing"
        ? { outcome, reasons, reasonOther: reasons.includes("other") ? reasonOther.trim() : null }
        : { outcome };
    mutation.mutate(
      {
        customerKey: row.key,
        customerName: row.name,
        input,
        meta: { method, note, source: "no_answer", customerPhone: row.phone },
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast({
            title:
              outcome === "no_answer"
                ? attempt >= MAX_ATTEMPTS && !sameDay
                  ? "Attempt 6 logged: sequence finished"
                  : `Attempt ${sameDay ? sequence.attempts_done : attempt} logged`
                : `Recorded: ${OUTCOME_LABELS[outcome].label}`,
            description: row.name ?? undefined,
          });
        },
        onError: (e) => setError(followupErrorMessage(e)),
      }
    );
  };

  const copyDraft = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`);
      toast({ title: "Email copied", description: "Paste it into a new email." });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the text and copy it instead.", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>
              Attempt {attempt} of {MAX_ATTEMPTS} · {row.name ?? "this customer"}
            </DialogTitle>
            <DialogDescription>Suggested: {plan.hint}.</DialogDescription>
          </DialogHeader>

          {sameDay && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Already tried today
                {sequence.last_attempt_by_email ? ` by ${sequence.last_attempt_by_email}` : ""}. Another No answer
                today counts as the same attempt.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="attempt-method">How did you try?</Label>
            <Select value={method} onValueChange={(value) => setMethod(value as ContactMethod)} disabled={saving}>
              <SelectTrigger id="attempt-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2" disabled={saving}>
            <legend className="text-sm font-medium">What happened?</legend>
            <RadioGroup value={outcome} onValueChange={(value) => setOutcome(value as ContactOutcome)}>
              {CONTACT_OUTCOMES.map((o) => (
                <div key={o} className="flex items-center gap-2">
                  <RadioGroupItem id={`attempt-outcome-${o}`} value={o} />
                  <Label htmlFor={`attempt-outcome-${o}`} className="font-normal">
                    {OUTCOME_LABELS[o].label}
                    {o === "booked" && row.acuityBooked && (
                      <span className="ml-2 text-xs text-green-700">Booked in Acuity</span>
                    )}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {outcome === "not_continuing" && (
              <div className="space-y-2 pl-6">
                {NOT_CONTINUING_REASONS.map((reason) => (
                  <div key={reason.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`attempt-reason-${reason.id}`}
                      checked={reasons.includes(reason.id)}
                      onCheckedChange={(checked) =>
                        setReasons((current) =>
                          checked === true ? [...current, reason.id] : current.filter((r) => r !== reason.id)
                        )
                      }
                    />
                    <Label htmlFor={`attempt-reason-${reason.id}`} className="font-normal">
                      {reason.label}
                    </Label>
                  </div>
                ))}
                {reasons.includes("other") && (
                  <Textarea
                    value={reasonOther}
                    onChange={(e) => setReasonOther(e.target.value)}
                    placeholder="Enter the reason"
                    rows={2}
                    aria-label="Other reason"
                  />
                )}
              </div>
            )}
            {outcome !== "no_answer" && (
              <p className="text-xs text-muted-foreground">This ends the No answer sequence.</p>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="attempt-note">Note (optional)</Label>
            <Textarea
              id="attempt-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Left a voicemail"
              rows={2}
              disabled={saving}
            />
          </div>

          {draft && outcome === "no_answer" && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Mail className="h-4 w-4" /> Email to send with this attempt
              </p>
              <p className="text-xs text-muted-foreground">
                Draft wording until the content team's copy arrives. Send it from your own inbox.
              </p>
              <p className="text-sm">
                <span className="text-muted-foreground">Subject:</span> {draft.subject}
              </p>
              <p className="whitespace-pre-line text-xs text-muted-foreground line-clamp-4">{draft.body}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void copyDraft()}>
                  <Copy className="h-3.5 w-3.5" /> Copy email
                </Button>
                {row.email && (
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a
                      href={`mailto:${row.email}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`}
                    >
                      <Mail className="h-3.5 w-3.5" /> Open in email app
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}

          {touched && validation && <p className="text-sm text-destructive">{validation}</p>}
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Couldn't save: {error}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={saving}>
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

function CloseSequenceDialog({
  open,
  onOpenChange,
  row,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SequenceRow;
}) {
  const { toast } = useToast();
  const mutation = useCloseSequence();
  const [reason, setReason] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason("");
      mutation.reset();
    }
  }

  const trimmed = reason.trim();
  const saving = mutation.isPending;

  const save = () => {
    if (saving || !trimmed || trimmed.length > 500) return;
    mutation.mutate(
      { sequenceId: row.sequence.id, reason: trimmed },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast({ title: "Sequence closed", description: row.name ?? undefined });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (!next && saving ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Close the sequence for {row.name ?? "this customer"}?</DialogTitle>
            <DialogDescription>
              No more attempts will be scheduled. For a welfare concern, pass it to the clinical lead and note
              that here.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is it being closed?"
            rows={3}
            aria-label="Reason for closing"
            disabled={saving}
            autoFocus
          />
          {trimmed.length > 500 && <p className="text-sm text-destructive">The reason can be up to 500 characters.</p>}
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Couldn't close it: {followupErrorMessage(mutation.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={saving || !trimmed || trimmed.length > 500}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Close sequence
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
