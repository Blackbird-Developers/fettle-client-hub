import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  useActivityActors,
  useActivityPage,
  useActivitySummary,
} from "@/hooks/useAdminActivity";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_PAGE_SIZE,
  type ActivityRangePreset,
  RANGE_PRESETS,
  activityCustomer,
  activityRange,
  describeActivity,
} from "@/lib/adminActivity";
import { formatDateTime } from "@/lib/customerInsights";
import { DateRangeFilter } from "./DateRangeFilter";
import { TablePagination } from "./TablePagination";

const ALL = "all";
const SEARCH_DELAY_MS = 300;

// Staff activity log: who completed or edited tasks, logged outcomes, edited
// notes and so on, newest first. Every admin can see it.
export function ActivityLog() {
  const [preset, setPreset] = useState<ActivityRangePreset>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const custom = Boolean(customFrom || customTo);
  // Recomputed when the filters change, not every render, so the query key is stable.
  const { from, to } = useMemo(
    () => activityRange(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const actors = useActivityActors(true);
  const summary = useActivitySummary(from, to, true);
  const activity = useActivityPage({ page, from, to, actor, action, search }, true);
  const rows = activity.data?.rows ?? [];
  const total = activity.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ACTIVITY_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={custom ? "" : preset}
          onValueChange={(value) => {
            if (!value) return;
            setPreset(value as ActivityRangePreset);
            setCustomFrom("");
            setCustomTo("");
            setPage(1);
          }}
        >
          {RANGE_PRESETS.map((p) => (
            <ToggleGroupItem key={p.id} value={p.id} variant="outline" size="sm">
              {p.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <DateRangeFilter
          id="activity-dates"
          from={customFrom}
          to={customTo}
          onChange={(nextFrom, nextTo) => {
            setCustomFrom(nextFrom);
            setCustomTo(nextTo);
            setPage(1);
          }}
        />
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg font-heading">By staff member</CardTitle>
          <CardDescription>For the dates chosen above. Click a row to see only their activity.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : summary.error ? (
            <p className="text-sm text-muted-foreground">Couldn't load the summary. Try again in a moment.</p>
          ) : !summary.data?.length ? (
            <p className="text-sm text-muted-foreground">No activity in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                  <TableHead className="text-right">Tasks completed</TableHead>
                  <TableHead className="text-right">Outcomes logged</TableHead>
                  <TableHead className="text-right">Notes edited</TableHead>
                  <TableHead>Last active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.data.map((s) => (
                  <TableRow
                    key={s.actor_email}
                    className="cursor-pointer"
                    data-state={actor === s.actor_email ? "selected" : undefined}
                    onClick={() => {
                      setActor(actor === s.actor_email ? "" : s.actor_email);
                      setPage(1);
                    }}
                  >
                    <TableCell className="font-medium break-all">{s.actor_email}</TableCell>
                    <TableCell className="text-right">{s.total}</TableCell>
                    <TableCell className="text-right">{s.tasks_completed}</TableCell>
                    <TableCell className="text-right">{s.outcomes_logged}</TableCell>
                    <TableCell className="text-right">{s.notes_edited}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(s.last_active)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">Activity</CardTitle>
            <CardDescription>Newest first.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={actor || ALL}
              onValueChange={(value) => {
                setActor(value === ALL ? "" : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-56 h-9" aria-label="Staff member">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All staff</SelectItem>
                {(actors.data ?? []).map((email) => (
                  <SelectItem key={email} value={email}>
                    {email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={action || ALL}
              onValueChange={(value) => {
                setAction(value === ALL ? "" : value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-60 h-9" aria-label="Action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All actions</SelectItem>
                {ACTIVITY_ACTIONS.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search customer"
                aria-label="Search customer"
                className="pl-8 h-9 w-56 max-w-full"
              />
            </div>
            {activity.isFetching && !activity.isLoading && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {activity.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : activity.error ? (
            <p className="text-sm text-muted-foreground">Couldn't load the activity log. Try again in a moment.</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity matches.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">When</TableHead>
                    <TableHead className="w-56">Staff</TableHead>
                    <TableHead>What</TableHead>
                    <TableHead className="w-48">Customer</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const { summary: what, detail } = describeActivity(row);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="text-muted-foreground whitespace-nowrap align-top">
                          {formatDateTime(row.created_at)}
                        </TableCell>
                        <TableCell className="break-all align-top">{row.actor_email ?? "Unknown"}</TableCell>
                        <TableCell className="align-top">
                          <p>{what}</p>
                          {detail && (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words mt-0.5">
                              {detail}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="break-all align-top">{activityCustomer(row) ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
                <p className="text-xs text-muted-foreground">
                  {(page - 1) * ACTIVITY_PAGE_SIZE + 1}–{(page - 1) * ACTIVITY_PAGE_SIZE + rows.length} of {total}
                </p>
                <TablePagination page={page} pageCount={pageCount} onPageChange={setPage} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
