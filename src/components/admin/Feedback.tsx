import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import type { DateRange } from "react-day-picker";
import { AlertCircle, CalendarDays, MessageSquare, RefreshCw, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHubFeedback, useUpdateFeedbackStatus } from "@/hooks/useAdmin";
import { isMissingTableError } from "@/lib/customerFollowups";
import { formatDateTime } from "@/lib/customerInsights";
import {
  DEFAULT_FEEDBACK_FILTERS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
  type FeedbackFilters,
  type FeedbackStatus,
  type HubFeedback,
  categoryLabel,
  filterFeedback,
  pageLabel,
  summariseFeedback,
} from "@/lib/hubFeedback";
import { StatTile } from "./CustomerInsightsShared";

const STATUS_STYLES: Record<FeedbackStatus, string> = {
  new: "bg-blue-50 text-blue-700 border-blue-200",
  read: "bg-muted text-muted-foreground border-border",
  actioned: "bg-green-50 text-green-700 border-green-200",
};

/**
 * Feedback page: everything clients have sent from the hub's Feedback page,
 * newest first, with filters and a status (new → read → actioned) per item.
 */
export function Feedback() {
  const { data, error, isLoading, isFetching, refetch } = useHubFeedback();
  const [filters, setFilters] = useState<FeedbackFilters>(DEFAULT_FEEDBACK_FILTERS);
  const setFilter = <K extends keyof FeedbackFilters>(key: K, value: FeedbackFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const rows = useMemo(() => filterFeedback(data ?? [], filters), [data, filters]);
  const summary = useMemo(() => summariseFeedback(data ?? []), [data]);
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of data ?? []) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, [data]);

  // TODO: swap for the shared admin loader once it lands, so every page matches.
  if (isLoading) return <FeedbackLoading />;
  if (error) {
    return isMissingTableError(error) ? (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Not set up yet</AlertTitle>
        <AlertDescription>Feedback is available once the hub-feedback database update is deployed.</AlertDescription>
      </Alert>
    ) : (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Couldn't load feedback</AlertTitle>
        <AlertDescription className="mt-2">
          <p>{error.message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            <RefreshCw className="h-3 w-3 mr-2" />
            Try Again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const filtered =
    filters.category !== "all" || filters.from !== "" || filters.to !== "";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3 w-3 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <StatTile label="Unread" value={String(summary.new)} hint="Status still New" />
        <StatTile label="All feedback" value={String(summary.total)} />
        <StatTile
          label="Average rating"
          value={summary.averageRating === null ? "–" : `${summary.averageRating} / 5`}
          hint={`From ${summary.rated} rated`}
        />
      </div>

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">Client feedback</CardTitle>
            <CardDescription>
              General feedback clients send from the hub. Reviews of specific sessions aren't included.
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={filters.status}
            onValueChange={(value) => value && setFilter("status", value as FeedbackFilters["status"])}
            className="flex-wrap justify-start"
            aria-label="Feedback status"
          >
            <ToggleGroupItem value="all" variant="outline" size="sm">
              All ({summary.total})
            </ToggleGroupItem>
            {FEEDBACK_STATUSES.map((status) => (
              <ToggleGroupItem key={status.id} value={status.id} variant="outline" size="sm">
                {status.label} ({statusCounts[status.id] ?? 0})
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-category" className="text-xs text-muted-foreground">
                Category
              </Label>
              <Select
                value={filters.category}
                onValueChange={(value) => setFilter("category", value as FeedbackCategory | "all")}
              >
                <SelectTrigger id="feedback-category" className="w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {FEEDBACK_CATEGORIES.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="feedback-dates" className="text-xs text-muted-foreground">
                Date
              </Label>
              <DateRangeFilter
                id="feedback-dates"
                from={filters.from}
                to={filters.to}
                onChange={(from, to) => setFilters((current) => ({ ...current, from, to }))}
              />
            </div>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters((current) => ({ ...DEFAULT_FEEDBACK_FILTERS, status: current.status }))}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <MessageSquare className="h-8 w-8" />
              <p className="text-sm">
                {summary.total === 0 ? "No feedback yet." : "No feedback matches these filters."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={row.status === "new" ? "bg-blue-50/30" : undefined}>
                    <TableCell>
                      <SenderCell row={row} />
                    </TableCell>
                    <TableCell className="min-w-[140px]">{categoryLabel(row.category)}</TableCell>
                    <TableCell>
                      <RatingCell rating={row.rating} />
                    </TableCell>
                    <TableCell className="min-w-[280px] max-w-[520px]">
                      <p className="whitespace-pre-wrap break-words text-sm">{row.message}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p>{formatDateTime(row.created_at)}</p>
                      {row.page && (
                        <p className="text-xs text-muted-foreground">From {pageLabel(row.page)}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusCell row={row} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {rows.length} of {summary.total}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SenderCell({ row }: { row: HubFeedback }) {
  return (
    <div className="min-w-[160px] space-y-0.5">
      <p className="font-medium">{row.sender_name ?? <span className="text-muted-foreground">No name</span>}</p>
      <p className="text-xs text-muted-foreground break-all">{row.sender_email ?? "No email"}</p>
    </div>
  );
}

function RatingCell({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-xs text-muted-foreground">Not rated</span>;
  return (
    <div className="flex items-center gap-0.5" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-3.5 w-3.5 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function StatusCell({ row }: { row: HubFeedback }) {
  const { toast } = useToast();
  const updateStatus = useUpdateFeedbackStatus();
  const status = row.status as FeedbackStatus;

  const change = (next: string) =>
    updateStatus.mutate(
      { id: row.id, status: next as FeedbackStatus },
      {
        onError: () =>
          toast({ title: "Couldn't update the status", description: "Please try again.", variant: "destructive" }),
      }
    );

  return (
    <div className="min-w-[140px] space-y-1">
      <Select value={status} onValueChange={change} disabled={updateStatus.isPending}>
        <SelectTrigger
          className={`h-8 w-[130px] text-xs ${STATUS_STYLES[status] ?? ""}`}
          aria-label={`Status for feedback from ${row.sender_name ?? row.sender_email ?? "client"}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FEEDBACK_STATUSES.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {row.status_updated_by_email && row.status_updated_at && (
        <div className="text-[11px] text-muted-foreground">
          <p className="break-all">{row.status_updated_by_email}</p>
          <p>{formatDateTime(row.status_updated_at)}</p>
        </div>
      )}
    </div>
  );
}

const DAY_FORMAT = "yyyy-MM-dd";

/** Label for the date button, e.g. "1 Oct – 13 Oct 2026". */
function dateRangeLabel(from: string, to: string): string | null {
  if (!from && !to) return null;
  const show = (day: string, withYear: boolean) => format(parseISO(day), withYear ? "d MMM yyyy" : "d MMM");
  if (from && to) {
    if (from === to) return show(from, true);
    return `${show(from, from.slice(0, 4) !== to.slice(0, 4))} – ${show(to, true)}`;
  }
  return from ? `From ${show(from, true)}` : `Until ${show(to, true)}`;
}

// Smaller cells and spacing than the default calendar, for a filter popover.
const COMPACT_CALENDAR = {
  month: "space-y-2",
  caption: "flex justify-center pt-0.5 relative items-center",
  nav_button: "inline-flex h-6 w-6 items-center justify-center rounded-md border border-input opacity-60 hover:opacity-100",
  head_cell: "text-muted-foreground rounded-md w-8 font-normal text-[0.7rem]",
  row: "flex w-full mt-1",
  // No background on the cell itself: only the days in between get a band,
  // so a lone start/end day is a clean rounded square.
  cell: "h-8 w-8 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
  day: "inline-flex h-8 w-8 items-center justify-center rounded-md p-0 text-sm font-normal hover:bg-accent hover:text-accent-foreground aria-selected:opacity-100",
  day_range_middle: "rounded-none aria-selected:bg-accent aria-selected:text-accent-foreground",
  // Today isn't highlighted; only the chosen dates are.
  day_today: "",
};

/** Date range picker using the hub's calendar, in a popover. */
function DateRangeFilter({
  id,
  from,
  to,
  onChange,
}: {
  id: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined = from
    ? { from: parseISO(from), to: to ? parseISO(to) : undefined }
    : undefined;
  const label = dateRangeLabel(from, to);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          className={cn("w-[240px] justify-start font-normal", !label && "text-muted-foreground")}
        >
          <CalendarDays className="mr-2 h-4 w-4" />
          {label ?? "Any date"}
        </Button>
      </PopoverTrigger>
      {/* Always opens below the button, even near the bottom of the window
          (the page scrolls instead). */}
      <PopoverContent className="w-auto p-0" align="start" side="bottom" avoidCollisions={false}>
        {/* w-0 min-w-full: the header takes the calendar's width instead of
            stretching the popover, so there's no gap beside the calendar. */}
        <div className="flex w-0 min-w-full items-center justify-between gap-2 border-b px-3 py-1.5 text-xs">
          <span className="font-medium" aria-live="polite">
            {from && !to ? "Now pick an end date" : (label ?? "Pick a start and end date")}
          </span>
          {label && (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
              onClick={() => {
                onChange("", "");
                setOpen(false);
              }}
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
        <Calendar
          mode="range"
          selected={selected}
          defaultMonth={selected?.from}
          onSelect={(range) => {
            onChange(
              range?.from ? format(range.from, DAY_FORMAT) : "",
              range?.to ? format(range.to, DAY_FORMAT) : ""
            );
            if (range?.to) setOpen(false);
          }}
          disabled={{ after: new Date() }}
          weekStartsOn={1}
          numberOfMonths={1}
          initialFocus
          className="p-2"
          classNames={COMPACT_CALENDAR}
        />
      </PopoverContent>
    </Popover>
  );
}

function FeedbackLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading feedback">
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      {[1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
