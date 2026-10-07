import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CalendarX, Search } from "lucide-react";
import { useBulkUpdateFollowups, useCustomerFollowups, useCustomerInsights } from "@/hooks/useAdmin";
import { headerCheckboxState, pruneSelection, toggleAllVisible, toggleSelected } from "@/lib/bulkFollowups";
import { indexFollowups, isMissingTableError } from "@/lib/customerFollowups";
import { BulkActionBar } from "./BulkActionBar";
import { FollowupActions } from "./FollowupActions";
import { daysAgoLabel, formatDate, formatDateTime, matchesSearch } from "@/lib/customerInsights";
import {
  type ProgressionRow,
  GRADE_ORDER,
  sessionOrdinal,
} from "../../../supabase/functions/admin-customer-insights/logic.ts";
import {
  CustomerCell,
  DataIssuesPanel,
  GradeBadge,
  GradeLegend,
  InsightsError,
  InsightsHeader,
  InsightsLoading,
  PortalStatusBadge,
  SortableHead,
  type SortDirection,
  StatTile,
} from "./CustomerInsightsShared";

type SortKey = "grade" | "name" | "fromSession";

// Unverified rows have no grade and always sort after graded ones.
const gradeRank = (row: ProgressionRow) => (row.grade ? GRADE_ORDER[row.grade] : 99);

const COMPARATORS: Record<SortKey, (a: ProgressionRow, b: ProgressionRow) => number> = {
  grade: (a, b) => gradeRank(a) - gradeRank(b) || b.daysSinceFromSession - a.daysSinceFromSession,
  name: (a, b) => (a.name ?? "").localeCompare(b.name ?? ""),
  fromSession: (a, b) => a.daysSinceFromSession - b.daysSinceFromSession,
};

/** Acuity appointment type, truncated so long names don't stretch the table. */
function SessionTypeLabel({ type }: { type: string | null }) {
  if (!type) return null;
  return (
    <p className="max-w-[220px] truncate text-xs text-muted-foreground" title={type}>
      {type}
    </p>
  );
}

function NextSessionCell({ row }: { row: ProgressionRow }) {
  switch (row.nextSessionStatus) {
    case "completed":
      return (
        <div className="whitespace-nowrap">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Completed
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.nextSessionAt)}</p>
          <SessionTypeLabel type={row.nextSessionType} />
        </div>
      );
    case "booked":
      return (
        <div className="whitespace-nowrap">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            Booked
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.nextSessionAt)}</p>
          <SessionTypeLabel type={row.nextSessionType} />
        </div>
      );
    default:
      return (
        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
          Not booked
        </Badge>
      );
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Session N → N+1" progression; `fromSession` = N (1 = first to second). */
export function SessionProgression({ fromSession }: { fromSession: number }) {
  const { data, error, isLoading, isFetching, refetch } = useCustomerInsights();
  const followups = useCustomerFollowups();
  const followupsByKey = useMemo(() => indexFollowups(followups.data ?? []), [followups.data]);
  // Why the Actions buttons are disabled, if they are.
  const followupsUnavailable = followups.isPending
    ? "Loading follow-ups…"
    : followups.isError
      ? isMissingTableError(followups.error)
        ? "Available once the follow-ups database update is deployed"
        : "Couldn't load follow-ups. Refresh the page to try again."
      : null;
  const [period, setPeriod] = useState(30);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "grade",
    direction: "asc",
  });

  const view = data?.progression.find((v) => v.fromSession === fromSession);
  const from = sessionOrdinal(fromSession);
  const next = sessionOrdinal(fromSession + 1);
  const fromLabel = fromSession === 1 ? "first-ever" : from;

  // Rows whose session N falls inside the selected period. The server
  // already limits rows to the full active window, so that period shows all.
  const inPeriod = useMemo(() => {
    const all = view?.rows ?? [];
    if (!data || period >= data.activeWindowDays) return all;
    return all.filter((row) => row.daysSinceFromSession < period);
  }, [data, view, period]);

  const rows = useMemo(() => {
    const compare = COMPARATORS[sort.key];
    return inPeriod
      .filter((row) => matchesSearch(row, search))
      .sort((a, b) => (sort.direction === "asc" ? compare(a, b) : compare(b, a)));
  }, [inPeriod, search, sort]);

  // Selected customer keys. Only ever rows currently shown: anything a search,
  // period change or refresh hides is dropped. Sorting keeps the selection.
  const bulk = useBulkUpdateFollowups();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const headerCheckboxRef = useRef<HTMLButtonElement>(null);
  const visibleKeys = useMemo(() => rows.map((row) => row.key), [rows]);
  useEffect(() => {
    setSelected((current) => pruneSelection(current, visibleKeys));
  }, [visibleKeys]);
  const selectedKeys = visibleKeys.filter((key) => selected.has(key));
  const nameByKey = useMemo(() => new Map(rows.map((row) => [row.key, row.name])), [rows]);

  // When everything saves, the bar (and the button that opened any dialog)
  // goes away with the selection, so focus moves to the header checkbox once
  // it's enabled again.
  const [refocusHeader, setRefocusHeader] = useState(false);
  useEffect(() => {
    if (refocusHeader && !bulk.isPending) {
      headerCheckboxRef.current?.focus();
      setRefocusHeader(false);
    }
  }, [refocusHeader, bulk.isPending]);

  const onBulkFinished = (failedKeys: string[]) => {
    setSelected(new Set(failedKeys));
    if (failedKeys.length === 0) setRefocusHeader(true);
  };

  const onSort = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));

  if (isLoading) return <InsightsLoading />;
  if (error || !data) {
    return error ? <InsightsError error={error} onRetry={() => refetch()} /> : null;
  }

  // An older insights function only returns Session 1–2.
  if (!view) {
    return (
      <div className="space-y-6 animate-fade-in">
        <InsightsHeader data={data} isFetching={isFetching} onRefresh={() => refetch()} />
        <Card className="border-border/50">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <CalendarX className="h-8 w-8" />
            <p className="text-sm">
              This view will appear once the latest data update is deployed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Headline figures count customers whose session number is confirmed.
  const verified = inPeriod.filter((row) => row.historyStatus === "verified");
  const progressed = verified.filter((row) => row.nextSessionStatus !== "none").length;
  const notBooked = verified.length - progressed;
  const unverified = inPeriod.length - verified.length;
  const conversion = verified.length > 0 ? Math.round((progressed / verified.length) * 100) : 0;

  const headerState = headerCheckboxState(visibleKeys, selected);

  return (
    // Extra bottom space while the selection bar is up, so it never covers the last rows.
    <div className={`space-y-6 animate-fade-in ${selectedKeys.length > 0 ? "pb-24" : ""}`}>
      <InsightsHeader data={data} isFetching={isFetching} onRefresh={() => refetch()} />

      <ToggleGroup
        type="single"
        value={String(period)}
        onValueChange={(value) => value && setPeriod(Number(value))}
        className="justify-start"
        aria-label={`${capitalize(from)} session within`}
      >
        {data.progressionPeriods.map((days) => (
          <ToggleGroupItem key={days} value={String(days)} variant="outline" size="sm">
            Last {days} days
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={
            fromSession === 1
              ? `First-time customers (last ${period} days)`
              : `Had their ${from} session (last ${period} days)`
          }
          value={String(verified.length)}
        />
        <StatTile
          label={`Progressed to a ${next} session`}
          value={`${conversion}%`}
          hint={`${progressed} completed or booked`}
        />
        <StatTile label={`No ${next} session booked`} value={String(notBooked)} />
        <StatTile label="Unable to verify" value={String(unverified)} hint="Not included in the rates" />
      </div>

      <DataIssuesPanel data={data} />

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">
              {capitalize(from)}-to-{next}-session progression
            </CardTitle>
            <CardDescription>
              Customers whose {fromLabel} session was in the last {period} days, and whether
              they've completed or booked a {next} one. Intro calls, therapy, assessments and
              psychiatry all count as sessions; free consultations don't.
            </CardDescription>
          </div>
          <GradeLegend legend={view?.legend ?? []} />
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
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <CalendarX className="h-8 w-8" />
              <p className="text-sm">
                {search
                  ? "No customers match your search."
                  : fromSession === 1
                    ? `No first-time customers in the last ${period} days.`
                    : `No customers had their ${from} session in the last ${period} days.`}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 pr-0">
                    <Checkbox
                      ref={headerCheckboxRef}
                      checked={headerState}
                      onCheckedChange={() => setSelected(toggleAllVisible(visibleKeys, selected))}
                      disabled={bulk.isPending}
                      aria-label={
                        headerState === true
                          ? `Deselect all ${rows.length} shown customers`
                          : `Select all ${rows.length} shown customers`
                      }
                    />
                  </TableHead>
                  <SortableHead label="Priority" sortKey="grade" sort={sort} onSort={onSort} />
                  <SortableHead label="Customer" sortKey="name" sort={sort} onSort={onSort} />
                  <SortableHead
                    label={`${capitalize(from)} session`}
                    sortKey="fromSession"
                    sort={sort}
                    onSort={onSort}
                  />
                  <TableHead>{capitalize(next)} session</TableHead>
                  <TableHead>Portal account</TableHead>
                  <TableHead>Follow-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.key}
                    data-state={selected.has(row.key) ? "selected" : undefined}
                    className="data-[state=selected]:bg-primary/5"
                  >
                    <TableCell className="w-10 pr-0">
                      <Checkbox
                        checked={selected.has(row.key)}
                        onCheckedChange={() => setSelected(toggleSelected(selected, row.key))}
                        disabled={bulk.isPending}
                        aria-label={`Select ${row.name ?? "unnamed customer"}`}
                      />
                    </TableCell>
                    <TableCell>
                      <GradeBadge grade={row.grade} reason={row.gradeReason} />
                    </TableCell>
                    <TableCell>
                      <CustomerCell name={row.name} email={row.email} phone={row.phone} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p>{formatDate(row.fromSessionAt)}</p>
                      <p className="text-xs text-muted-foreground">
                        {daysAgoLabel(row.daysSinceFromSession)}
                      </p>
                      <SessionTypeLabel type={row.fromSessionType} />
                      {row.historyStatus === "unverified" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className="mt-1 cursor-help bg-amber-50 text-amber-700 border-amber-200"
                            >
                              Unable to verify
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {row.historyNote} — this may not be their {fromLabel} session.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      <NextSessionCell row={row} />
                    </TableCell>
                    <TableCell>
                      <PortalStatusBadge status={row.portalStatus} />
                    </TableCell>
                    <TableCell>
                      <FollowupActions
                        customerKey={row.key}
                        customerName={row.name}
                        followup={followupsByKey.get(row.key)}
                        unavailable={followupsUnavailable}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {rows.length} of {inPeriod.length} customers
              {selectedKeys.length > 0 && ` · ${selectedKeys.length} selected`}
            </p>
          )}
        </CardContent>
      </Card>

      {selectedKeys.length > 0 && (
        <BulkActionBar
          selectedKeys={selectedKeys}
          visibleCount={rows.length}
          followupsByKey={followupsByKey}
          nameByKey={nameByKey}
          unavailable={followupsUnavailable}
          bulk={bulk}
          onClear={() => {
            setSelected(new Set());
            headerCheckboxRef.current?.focus();
          }}
          onFinished={onBulkFinished}
        />
      )}
    </div>
  );
}
