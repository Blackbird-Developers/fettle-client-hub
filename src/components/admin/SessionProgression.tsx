import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { useCustomerInsights } from "@/hooks/useAdmin";
import { daysAgoLabel, formatDate, formatDateTime, matchesSearch } from "@/lib/customerInsights";
import {
  type ProgressionRow,
  GRADE_ORDER,
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

type SortKey = "grade" | "name" | "firstSession";

// Unverified rows have no grade and always sort after graded ones.
const gradeRank = (row: ProgressionRow) => (row.grade ? GRADE_ORDER[row.grade] : 99);

const COMPARATORS: Record<SortKey, (a: ProgressionRow, b: ProgressionRow) => number> = {
  grade: (a, b) => gradeRank(a) - gradeRank(b) || b.daysSinceFirstSession - a.daysSinceFirstSession,
  name: (a, b) => (a.name ?? "").localeCompare(b.name ?? ""),
  firstSession: (a, b) => a.daysSinceFirstSession - b.daysSinceFirstSession,
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

function SecondSessionCell({ row }: { row: ProgressionRow }) {
  switch (row.secondSessionStatus) {
    case "completed":
      return (
        <div className="whitespace-nowrap">
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            Completed
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">{formatDate(row.secondSessionAt)}</p>
          <SessionTypeLabel type={row.secondSessionType} />
        </div>
      );
    case "booked":
      return (
        <div className="whitespace-nowrap">
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
            Booked
          </Badge>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.secondSessionAt)}</p>
          <SessionTypeLabel type={row.secondSessionType} />
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

export function SessionProgression() {
  const { data, error, isLoading, isFetching, refetch } = useCustomerInsights();
  const [period, setPeriod] = useState(30);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "grade",
    direction: "asc",
  });

  // Rows whose first session falls inside the selected period. The server
  // already limits rows to the full active window, so that period shows all.
  const inPeriod = useMemo(() => {
    const all = data?.progression.rows ?? [];
    if (!data || period >= data.activeWindowDays) return all;
    return all.filter((row) => row.daysSinceFirstSession < period);
  }, [data, period]);

  const rows = useMemo(() => {
    const compare = COMPARATORS[sort.key];
    return inPeriod
      .filter((row) => matchesSearch(row, search))
      .sort((a, b) => (sort.direction === "asc" ? compare(a, b) : compare(b, a)));
  }, [inPeriod, search, sort]);

  const onSort = (key: SortKey) =>
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));

  if (isLoading) return <InsightsLoading />;
  if (error || !data) {
    return error ? <InsightsError error={error} onRetry={() => refetch()} /> : null;
  }

  // Headline figures count confirmed first-timers only.
  const verified = inPeriod.filter((row) => row.historyStatus === "verified");
  const progressed = verified.filter((row) => row.secondSessionStatus !== "none").length;
  const notBooked = verified.length - progressed;
  const unverified = inPeriod.length - verified.length;
  const conversion = verified.length > 0 ? Math.round((progressed / verified.length) * 100) : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <InsightsHeader data={data} isFetching={isFetching} onRefresh={() => refetch()} />

      <ToggleGroup
        type="single"
        value={String(period)}
        onValueChange={(value) => value && setPeriod(Number(value))}
        className="justify-start"
        aria-label="First session within"
      >
        {data.progressionPeriods.map((days) => (
          <ToggleGroupItem key={days} value={String(days)} variant="outline" size="sm">
            Last {days} days
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile label={`First-time customers (last ${period} days)`} value={String(verified.length)} />
        <StatTile
          label="Progressed to a second session"
          value={`${conversion}%`}
          hint={`${progressed} completed or booked`}
        />
        <StatTile label="No second session booked" value={String(notBooked)} />
        <StatTile label="Unable to verify" value={String(unverified)} hint="Not included in the rates" />
      </div>

      <DataIssuesPanel data={data} />

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">First-to-second-session progression</CardTitle>
            <CardDescription>
              Customers whose first-ever session was in the last {period} days, and whether
              they've completed or booked a second one. Intro calls, therapy, assessments and
              psychiatry all count as sessions; free consultations don't.
            </CardDescription>
          </div>
          <GradeLegend legend={data.progression.legend} />
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
                  : `No first-time customers in the last ${period} days.`}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead label="Priority" sortKey="grade" sort={sort} onSort={onSort} />
                  <SortableHead label="Customer" sortKey="name" sort={sort} onSort={onSort} />
                  <SortableHead label="First session" sortKey="firstSession" sort={sort} onSort={onSort} />
                  <TableHead>Second session</TableHead>
                  <TableHead>Portal account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <GradeBadge grade={row.grade} reason={row.gradeReason} />
                    </TableCell>
                    <TableCell>
                      <CustomerCell name={row.name} email={row.email} phone={row.phone} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p>{formatDate(row.firstSessionAt)}</p>
                      <p className="text-xs text-muted-foreground">
                        {daysAgoLabel(row.daysSinceFirstSession)}
                      </p>
                      <SessionTypeLabel type={row.firstSessionType} />
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
                            {row.historyNote} — this may not be their first-ever session.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      <SecondSessionCell row={row} />
                    </TableCell>
                    <TableCell>
                      <PortalStatusBadge status={row.portalStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {rows.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {rows.length} of {inPeriod.length} customers
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
