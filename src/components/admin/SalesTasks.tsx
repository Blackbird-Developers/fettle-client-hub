import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertCircle,
  ArrowDown,
  CalendarClock,
  ChevronLeft,
  CheckCircle2,
  ExternalLink,
  ListChecks,
  Loader2,
  Mail,
  MessageCircle,
  PhoneMissed,
  RefreshCw,
  RotateCcw,
  Search,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCustomerFollowups } from "@/hooks/useAdmin";
import {
  useCompleteSalesTask,
  usePrepareSalesTasks,
  useReopenSalesTask,
  useSalesTaskHistory,
  useSalesTaskRun,
  useSalesTasks,
  useSetSalesTaskDue,
  useUpdateSalesTaskNote,
} from "@/hooks/useSalesTasks";
import { NOTE_MAX_LENGTH, followupErrorMessage, isMissingTableError } from "@/lib/customerFollowups";
import { formatDate, formatDateTime } from "@/lib/customerInsights";
import {
  type SalesPriority,
  type SalesTask,
  type SalesTaskKind,
  type TaskSection,
  HISTORY_DAYS,
  KIND_LABELS,
  PRIORITY_LABELS,
  SECTION_LABELS,
  SECTION_ORDER,
  STATE_LABELS,
  carriedOverLabel,
  completionLabel,
  dueLabel,
  groupSections,
  groupTasks,
  matchesTaskSearch,
  priorityReasons,
  sectionFor,
  sourceHref,
  taskState,
  todayInIreland,
} from "@/lib/salesTasks";
import { SEGMENT_LABELS, type BundleSegment } from "../../../supabase/functions/admin-bundles/logic.ts";
import { CustomerCell, StatTile } from "./CustomerInsightsShared";

const PRIORITY_STYLES: Record<SalesPriority, string> = {
  high: "border-red-200 bg-red-50 text-red-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-border bg-muted text-muted-foreground",
};

type TabId = "today" | "scheduled" | "history";
type KindFilter = "all" | SalesTaskKind;

/**
 * Sales Tasks page: the daily call list, worked through in seven sections
 * (Progressions, Bundles, Follow-ups, No answers, Hot leads, Psychiatry,
 * Assessments). The sales-tasks function prepares it every morning;
 * unfinished tasks carry over until they're completed or the client books.
 */
export function SalesTasks() {
  const tasks = useSalesTasks();
  const run = useSalesTaskRun();
  const [tab, setTab] = useState<TabId>("today");
  const history = useSalesTaskHistory(true);
  const followups = useCustomerFollowups();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const today = todayInIreland();

  const notesByKey = useMemo(
    () => new Map((followups.data ?? []).map((f) => [f.customer_key, f.note])),
    [followups.data]
  );

  if (tasks.isPending) {
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

  if (tasks.isError) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {isMissingTableError(tasks.error)
            ? "Available once the Sales Tasks database update is deployed."
            : "Couldn't load the sales tasks. Refresh the page to try again."}
        </AlertDescription>
      </Alert>
    );
  }

  const groups = groupTasks(tasks.data, today);
  const visible = (list: SalesTask[]) =>
    list.filter((task) => (kind === "all" || sectionFor(task) === kind) && matchesTaskSearch(task, search));
  const overdue = groups.today.filter((task) => task.due_on < today).length;
  const high = groups.today.filter((task) => task.priority === "high").length;
  const completedToday = (history.data ?? []).filter(
    (task) => task.status === "completed" && task.completed_at && todayInIreland(Date.parse(task.completed_at)) === today
  ).length;
  const filtered = search.trim() !== "" || kind !== "all";

  return (
    <div className="space-y-6 animate-fade-in">
      <RunBar run={run.data ?? null} today={today} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile label="To do today" value={String(groups.today.length)} hint="Due today or carried over" />
        <StatTile label="Overdue" value={String(overdue)} hint="From earlier days" />
        <StatTile label="High priority" value={String(high)} />
        <StatTile label="Completed today" value={String(completedToday)} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, phone or service"
            className="pl-8"
            aria-label="Search tasks"
          />
        </div>
        <Select value={kind} onValueChange={(value) => setKind(value as KindFilter)}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Task type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All task types</SelectItem>
            {SECTION_ORDER.map((id) => (
              <SelectItem key={id} value={id}>
                {SECTION_LABELS[id].title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="today">Today ({groups.today.length})</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled ({groups.upcoming.length})</TabsTrigger>
          <TabsTrigger value="history">Completed</TabsTrigger>
        </TabsList>

        <TabsContent value="today">
          <TodaySections
            sections={groupSections(visible(groups.today))}
            today={today}
            notesByKey={notesByKey}
            empty={filtered ? "No tasks match your search." : "Nothing left for today."}
          />
        </TabsContent>
        <TabsContent value="scheduled">
          <TaskList
            title="Scheduled"
            description="Tasks moved to a later date. Each comes back to Today on its date."
            tasks={visible(groups.upcoming)}
            today={today}
            notesByKey={notesByKey}
            empty={filtered ? "No tasks match your search." : "No tasks scheduled for later."}
          />
        </TabsContent>
        <TabsContent value="history">
          <HistoryCard history={history} visible={visible} />
        </TabsContent>
      </Tabs>

      <PriorityNote />
    </div>
  );
}

function RunBar({ run, today }: { run: { run_on: string; status: string; finished_at: string | null; started_at: string } | null; today: string }) {
  const prepare = usePrepareSalesTasks();
  const { toast } = useToast();
  const preparedToday = run?.run_on === today && run.status === "done";

  const handlePrepare = async () => {
    try {
      const result = await prepare.mutateAsync();
      const s = result.summary;
      toast({
        title: "List up to date",
        description: `${s.created ?? 0} new, ${s.carriedOver ?? 0} carried over, ${s.autoClosed ?? 0} closed because the client booked.`,
      });
    } catch (error) {
      toast({ title: "Couldn't prepare the list", description: followupErrorMessage(error), variant: "destructive" });
    }
  };

  let status: string;
  if (prepare.isPending || (run?.status === "running" && run.run_on === today)) {
    status = "Preparing today's list from Acuity… this can take a minute or two.";
  } else if (preparedToday) {
    status = run.finished_at
      ? `Today's list was prepared at ${format(parseISO(run.finished_at), "HH:mm")}.`
      : "Today's list is ready.";
  } else if (run?.status === "failed" && run.run_on === today) {
    status = "This morning's preparation failed. Try again.";
  } else {
    status = run ? `Not prepared yet today (last prepared ${formatDate(run.run_on)}).` : "The list hasn't been prepared yet.";
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">{status}</p>
      <Button
        variant={preparedToday ? "outline" : "default"}
        size="sm"
        onClick={handlePrepare}
        disabled={prepare.isPending}
      >
        {prepare.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        {preparedToday ? "Refresh" : "Prepare today's list"}
      </Button>
    </div>
  );
}

function TaskList({
  title,
  description,
  tasks,
  today,
  notesByKey,
  empty,
}: {
  title: string;
  description: string;
  tasks: SalesTask[];
  today: string;
  notesByKey: Map<string, string | null>;
  empty: string;
}) {
  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-lg font-heading">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <ListChecks className="h-8 w-8" />
            <p className="text-sm">{empty}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {tasks.map((task) => (
              <TaskItem key={task.id} task={task} today={today} note={notesByKey.get(task.customer_key) ?? null} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const sectionId = (kind: SalesTaskKind) => `sales-section-${kind}`;

/**
 * Today's tasks in working order. A bar of counts sits on top; an empty
 * section shrinks to one line pointing at the next one with tasks, so the
 * list always starts where there's work (no follow-ups → No answers).
 */
function TodaySections({
  sections,
  today,
  notesByKey,
  empty,
}: {
  sections: TaskSection[];
  today: string;
  notesByKey: Map<string, string | null>;
  empty: string;
}) {
  const total = sections.reduce((sum, section) => sum + section.tasks.length, 0);
  if (total === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
          <ListChecks className="h-8 w-8" />
          <p className="text-sm">{empty}</p>
        </CardContent>
      </Card>
    );
  }

  const nextWithTasks = (index: number) => sections.slice(index + 1).find((s) => s.tasks.length > 0) ?? null;

  return (
    <div className="space-y-4">
      <nav aria-label="Sections" className="flex flex-wrap gap-2">
        {sections.map((section, index) => (
          <a
            key={section.kind}
            href={`#${sectionId(section.kind)}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted ${
              section.tasks.length ? "border-border bg-card font-medium" : "border-border/50 text-muted-foreground"
            }`}
          >
            <span className="text-muted-foreground">{index + 1}.</span>
            {SECTION_LABELS[section.kind].title}
            <span className="tabular-nums">{section.tasks.length}</span>
          </a>
        ))}
      </nav>

      {sections.map((section, index) => {
        const { title, description } = SECTION_LABELS[section.kind];
        if (section.tasks.length === 0) {
          const next = nextWithTasks(index);
          return (
            <div
              key={section.kind}
              id={sectionId(section.kind)}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border/60 px-4 py-2 text-sm text-muted-foreground"
            >
              <span>
                {index + 1}. No {title.toLowerCase()} today
              </span>
              {next && (
                <a href={`#${sectionId(next.kind)}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                  Start with {SECTION_LABELS[next.kind].title}
                  <ArrowDown className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          );
        }
        return (
          <Card key={section.kind} id={sectionId(section.kind)} className="scroll-mt-4 border-border/50">
            <CardHeader>
              <CardTitle className="text-lg font-heading">
                {index + 1}. {title} ({section.tasks.length})
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(section.stages ?? [{ fromSession: 0, label: "", tasks: section.tasks }]).map((stage) => (
                <div key={stage.fromSession} className="space-y-3">
                  {stage.label && (
                    <h3 className="text-sm font-medium text-muted-foreground">
                      {stage.label} ({stage.tasks.length})
                    </h3>
                  )}
                  <ul className="space-y-3">
                    {stage.tasks.map((task) => (
                      <TaskItem key={task.id} task={task} today={today} note={notesByKey.get(task.customer_key) ?? null} />
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const p = (priority as SalesPriority) in PRIORITY_LABELS ? (priority as SalesPriority) : "low";
  return (
    <Badge variant="outline" className={`font-medium ${PRIORITY_STYLES[p]}`}>
      {PRIORITY_LABELS[p]} priority
    </Badge>
  );
}

function TaskItem({ task, today, note }: { task: SalesTask; today: string; note: string | null }) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const state = taskState(task, today);
  const carried = carriedOverLabel(task);
  const reasons = priorityReasons(task);
  const segment = task.kind === "bundle" ? SEGMENT_LABELS[task.lead_status as BundleSegment]?.label : null;
  const moved = sectionFor(task) !== task.kind;

  return (
    <li className="rounded-lg border border-border/60 p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={task.priority} />
            <Badge variant="outline" className="font-normal">
              {KIND_LABELS[task.kind as SalesTaskKind] ?? task.kind}
            </Badge>
            {segment && (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">
                {segment}
              </Badge>
            )}
            {moved && (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                Follow-up set by staff
              </Badge>
            )}
            {state === "overdue" && (
              <Badge variant="outline" className="border-red-200 bg-red-50 font-normal text-red-700">
                {STATE_LABELS.overdue}
              </Badge>
            )}
            {carried && (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {carried}
              </Badge>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <CustomerCell name={task.customer_name} email={task.customer_email} phone={task.customer_phone} />
            <dl className="space-y-0.5 text-xs text-muted-foreground">
              <div>
                <dt className="inline">Service: </dt>
                <dd className="inline text-foreground">{task.service_type ?? "—"}</dd>
              </div>
              {task.owner && (
                <div>
                  <dt className="inline">Calendar: </dt>
                  <dd className="inline">{task.owner}</dd>
                </div>
              )}
              <div>
                <dt className="inline">Due: </dt>
                <dd className={`inline font-medium ${state === "overdue" ? "text-red-700" : "text-foreground"}`}>
                  {dueLabel(task, today)} · {formatDate(task.due_on)}
                </dd>
                {task.original_due_on !== task.due_on && (
                  <dd className="inline"> (first due {formatDate(task.original_due_on)})</dd>
                )}
              </div>
              <div>
                <dt className="inline">Task since: </dt>
                <dd className="inline">{formatDate(task.created_on)}</dd>
              </div>
            </dl>
          </div>

          <div className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">Why: </span>
              {task.reason}
            </p>
            {task.next_action && (
              <p className="font-medium">
                <span className="font-normal text-muted-foreground">Next: </span>
                {task.next_action}
              </p>
            )}
            {reasons.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Priority {task.score}:{" "}
                {reasons.map((part) => `${part.label} (${part.points > 0 ? "+" : ""}${part.points})`).join(" · ")}
              </p>
            )}
          </div>

          <div className="rounded-md bg-muted/50 p-2 text-xs">
            <span className="text-muted-foreground">Note: </span>
            {note ? <span className="whitespace-pre-wrap">{note}</span> : <span className="text-muted-foreground">None</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:w-44 lg:flex-col">
          <Button size="sm" onClick={() => setCompleteOpen(true)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Complete
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDueOpen(true)}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Follow up on…
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}>
            <StickyNote className="mr-2 h-4 w-4" />
            {note ? "Edit note" : "Add note"}
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <Link to={sourceHref(task)}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open in {SECTION_LABELS[task.kind as SalesTaskKind]?.title ?? "Hot leads"}
            </Link>
          </Button>
        </div>
      </div>

      <CompleteDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        task={task}
        onFollowUp={() => {
          setCompleteOpen(false);
          setDueOpen(true);
        }}
      />
      <NoteDialog open={noteOpen} onOpenChange={setNoteOpen} task={task} note={note} />
      <DueDialog open={dueOpen} onOpenChange={setDueOpen} task={task} today={today} />
    </li>
  );
}

const COMPLETE_OPTIONS: { id: "completed" | "follow_up" | "no_answer"; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "completed", label: "Completed", hint: "Done; close the task", icon: CheckCircle2 },
  { id: "follow_up", label: "Follow-up", hint: "Call again on a later date", icon: CalendarClock },
  { id: "no_answer", label: "No answer", hint: "Didn't pick up; you emailed or WhatsApped instead", icon: PhoneMissed },
];

/**
 * The Complete pop-up: Completed closes the task as before, Follow-up opens
 * the existing "Follow up on…" date picker, and No answer asks how else the
 * customer was contacted (Email, WhatsApp or both) before closing it.
 */
function CompleteDialog({
  open,
  onOpenChange,
  task,
  onFollowUp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: SalesTask;
  onFollowUp: () => void;
}) {
  const complete = useCompleteSalesTask();
  const { toast } = useToast();
  const [step, setStep] = useState<"choose" | "no_answer">("choose");
  const [emailed, setEmailed] = useState(false);
  const [whatsapped, setWhatsapped] = useState(false);
  const name = task.customer_name ?? "this customer";

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setStep("choose");
      setEmailed(false);
      setWhatsapped(false);
    }
    onOpenChange(next);
  };

  const save = async (outcome: "completed" | "no_answer") => {
    try {
      await complete.mutateAsync({ taskId: task.id, outcome, emailed, whatsapped });
      onOpenChange(false);
      toast({
        title: outcome === "no_answer" ? "No answer recorded" : "Task completed",
        description: task.customer_name ?? undefined,
      });
    } catch (error) {
      toast({ title: "Couldn't complete the task", description: followupErrorMessage(error), variant: "destructive" });
    }
  };

  const choose = (id: (typeof COMPLETE_OPTIONS)[number]["id"]) => {
    if (id === "completed") void save("completed");
    else if (id === "follow_up") onFollowUp();
    else setStep("no_answer");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === "choose" ? (
          <>
            <DialogHeader>
              <DialogTitle>Complete task</DialogTitle>
              <DialogDescription>How did it go with {name}?</DialogDescription>
            </DialogHeader>
            <p className="text-xs font-medium text-muted-foreground">Record outcome</p>
            <div className="-mt-2 space-y-1">
              {COMPLETE_OPTIONS.map(({ id, label, hint, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => choose(id)}
                  disabled={complete.isPending}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">
                    <span className="block">{label}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                  {id === "completed" && complete.isPending && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Saving" />
                  )}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>No answer</DialogTitle>
              <DialogDescription>
                Did you also contact {name} another way? Choose one or both to close the task.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              {[
                { id: "emailed", label: "Email", icon: Mail, checked: emailed, set: setEmailed },
                { id: "whatsapped", label: "WhatsApp", icon: MessageCircle, checked: whatsapped, set: setWhatsapped },
              ].map(({ id, label, icon: Icon, checked, set }) => (
                <Label
                  key={id}
                  htmlFor={`${id}-${task.id}`}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 px-3 py-2.5 font-normal hover:bg-muted/50"
                >
                  <Checkbox
                    id={`${id}-${task.id}`}
                    checked={checked}
                    onCheckedChange={(value) => set(value === true)}
                    disabled={complete.isPending}
                  />
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {label}
                </Label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              The missed call is also logged on the No answer page, so the next attempt comes up on schedule.
            </p>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="ghost" onClick={() => setStep("choose")} disabled={complete.isPending}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
              <Button onClick={() => void save("no_answer")} disabled={!(emailed || whatsapped) || complete.isPending}>
                {complete.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Complete task
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({
  open,
  onOpenChange,
  task,
  note,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: SalesTask;
  note: string | null;
}) {
  const save = useUpdateSalesTaskNote();
  const { toast } = useToast();
  const [draft, setDraft] = useState(note ?? "");

  const handleOpenChange = (next: boolean) => {
    if (next) setDraft(note ?? "");
    onOpenChange(next);
  };

  const handleSave = async () => {
    try {
      await save.mutateAsync({ taskId: task.id, note: draft });
      onOpenChange(false);
    } catch (error) {
      toast({ title: "Couldn't save the note", description: followupErrorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Note for {task.customer_name ?? "this customer"}</DialogTitle>
          <DialogDescription>The same note shows on the other admin pages for this customer.</DialogDescription>
        </DialogHeader>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={NOTE_MAX_LENGTH}
          rows={5}
          aria-label="Note"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save note
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DueDialog({
  open,
  onOpenChange,
  task,
  today,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: SalesTask;
  today: string;
}) {
  const setDue = useSetSalesTaskDue();
  const { toast } = useToast();
  const [date, setDate] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (next) setDate(task.due_on > today ? task.due_on : "");
    onOpenChange(next);
  };

  const handleSave = async () => {
    try {
      await setDue.mutateAsync({ taskId: task.id, dueOn: date });
      onOpenChange(false);
      toast({ title: "Follow-up date set", description: formatDate(date) });
    } catch (error) {
      toast({ title: "Couldn't set the date", description: followupErrorMessage(error), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follow up on…</DialogTitle>
          <DialogDescription>
            The task moves to Scheduled and comes back to Today on this date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`due-${task.id}`}>Date</Label>
          <Input id={`due-${task.id}`} type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!date || date < today || setDue.isPending}>
            {setDue.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save date
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function durationLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} days`;
}

function HistoryCard({
  history,
  visible,
}: {
  history: ReturnType<typeof useSalesTaskHistory>;
  visible: (list: SalesTask[]) => SalesTask[];
}) {
  const reopen = useReopenSalesTask();
  const { toast } = useToast();

  const handleReopen = async (task: SalesTask) => {
    try {
      await reopen.mutateAsync(task.id);
      toast({ title: "Task reopened", description: task.customer_name ?? undefined });
    } catch (error) {
      toast({ title: "Couldn't reopen the task", description: followupErrorMessage(error), variant: "destructive" });
    }
  };

  const rows = visible(history.data ?? []);

  return (
    <Card className="border-border/50">
      <CardHeader>
        <CardTitle className="text-lg font-heading">Completed in the last {HISTORY_DAYS} days</CardTitle>
        <CardDescription>
          Done by staff, or closed automatically because the client booked. These never return to Today.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.isPending ? (
          <Skeleton className="h-40" />
        ) : history.isError ? (
          <p className="text-sm text-muted-foreground">Couldn't load completed tasks.</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8" />
            <p className="text-sm">No completed tasks yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead>Time taken</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <CustomerCell name={task.customer_name} email={task.customer_email} phone={task.customer_phone} />
                    </TableCell>
                    <TableCell className="max-w-[260px] whitespace-normal">
                      <p className="text-sm">{KIND_LABELS[task.kind as SalesTaskKind] ?? task.kind}</p>
                      <p className="text-xs text-muted-foreground">{task.reason}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p className="text-sm">{completionLabel(task) ?? STATE_LABELS[taskState(task, "")]}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(task.completed_at)}
                        {task.completed_by_email && ` · ${task.completed_by_email}`}
                      </p>
                      {task.closed_reason && (
                        <p className="max-w-[220px] whitespace-normal text-xs text-muted-foreground">{task.closed_reason}</p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{durationLabel(task.seconds_to_complete)}</TableCell>
                    <TableCell className="text-right">
                      {task.status === "completed" && (
                        <Button size="sm" variant="ghost" onClick={() => handleReopen(task)} disabled={reopen.isPending}>
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Reopen
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PriorityNote() {
  return (
    <p className="text-xs text-muted-foreground">
      Sections are worked top to bottom, and each customer is listed once, in their first section; customers in a
      no-answer sequence are called on its schedule, under No answers. Within a section, priority is a points score
      shown on each task: hot leads use the same score as the Hot leads page; the others score the stage or step
      reached, how long it's been and contact attempts so far. Each day overdue adds 10 points (up to 30). 70+ is
      high, 45–69 medium, below 45 low. The list is prepared every morning and tasks close automatically once the
      client books.
    </p>
  );
}
