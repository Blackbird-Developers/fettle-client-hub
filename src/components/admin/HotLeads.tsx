import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { AlertTriangle, CalendarX, Search } from "lucide-react";
import {
  useBulkUpdateFollowups,
  useContactOutcomesAvailable,
  useCustomerFollowups,
  useHotLeads,
  useRecentContactAttempts,
} from "@/hooks/useAdmin";
import { headerCheckboxState, pruneSelection, toggleAllVisible, toggleSelected } from "@/lib/bulkFollowups";
import { indexFollowups, isMissingTableError } from "@/lib/customerFollowups";
import { daysAgoLabel, formatDate, formatDateTime, matchesSearch } from "@/lib/customerInsights";
import {
  type LeadContact,
  type LeadScore,
  type LeadTab,
  LEAD_SOURCE_LABELS,
  LEAD_TABS,
  contactSinceLead,
  leadTab,
  scoreLead,
} from "@/lib/hotLeads";
import type { LeadRow, LeadSource } from "../../../supabase/functions/admin-leads/logic.ts";
import { BulkActionBar } from "./BulkActionBar";
import { FollowupActions } from "./FollowupActions";
import {
  CustomerCell,
  InsightsError,
  InsightsHeader,
  InsightsLoading,
  PortalStatusBadge,
  SortableHead,
  type SortDirection,
  StatTile,
} from "./CustomerInsightsShared";

type SortKey = "score" | "name" | "lead";

interface ScoredLead {
  row: LeadRow;
  tab: LeadTab;
  contact: LeadContact | undefined;
  score: LeadScore;
}

const COMPARATORS: Record<SortKey, (a: ScoredLead, b: ScoredLead) => number> = {
  // Highest score first; ties go to whoever has waited longest.
  score: (a, b) => b.score.score - a.score.score || b.row.daysSinceLead - a.row.daysSinceLead,
  name: (a, b) => (a.row.name ?? "").localeCompare(b.row.name ?? ""),
  lead: (a, b) => a.row.daysSinceLead - b.row.daysSinceLead,
};

const SOURCE_STYLES: Record<LeadSource, string> = {
  both: "bg-red-50 text-red-700 border-red-200",
  quoted: "bg-orange-50 text-orange-700 border-orange-200",
  no_show: "bg-amber-50 text-amber-700 border-amber-200",
};

function scoreStyle(score: number): string {
  if (score >= 70) return "bg-red-100 text-red-700 border-red-200";
  if (score >= 50) return "bg-orange-100 text-orange-700 border-orange-200";
  if (score >= 30) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-muted text-muted-foreground border-border";
}

function ScoreBadge({ score }: { score: LeadScore }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={`cursor-help font-mono font-bold ${scoreStyle(score.score)}`}>
          {score.score}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <ul className="space-y-0.5 text-xs">
          {score.parts.map((part) => (
            <li key={part.label} className="flex justify-between gap-4">
              <span>{part.label}</span>
              <span className="font-mono">
                {part.points > 0 ? "+" : ""}
                {part.points}
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function LeadCell({ row }: { row: LeadRow }) {
  return (
    <div className="space-y-1 whitespace-nowrap">
      <Badge variant="outline" className={SOURCE_STYLES[row.source]}>
        {LEAD_SOURCE_LABELS[row.source]}
      </Badge>
      <p>{formatDate(row.leadAt)}</p>
      <p className="text-xs text-muted-foreground">
        {daysAgoLabel(row.daysSinceLead)}
        {row.owner && ` · ${row.owner}`}
      </p>
      {row.leadType && (
        <p className="max-w-[220px] whitespace-normal break-words text-xs leading-snug text-muted-foreground">
          {row.leadType}
        </p>
      )}
    </div>
  );
}

function StatusCell({ row }: { row: LeadRow }) {
  if (row.status === "open") {
    return (
      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
        Nothing booked
      </Badge>
    );
  }
  const converted = row.status === "converted";
  return (
    <div className="whitespace-nowrap">
      <Badge
        variant="outline"
        className={
          converted ? "bg-green-50 text-green-700 border-green-200" : "bg-blue-50 text-blue-700 border-blue-200"
        }
      >
        {converted ? "Booked" : "Call rebooked"}
      </Badge>
      <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.statusAt)}</p>
      {row.statusDetail && (
        <p className="max-w-[220px] whitespace-normal break-words text-xs leading-snug text-muted-foreground">
          {row.statusDetail}
        </p>
      )}
    </div>
  );
}

function AttemptsCell({ contact }: { contact: LeadContact | undefined }) {
  if (!contact) return <span className="text-xs text-muted-foreground">None yet</span>;
  return (
    <div className="whitespace-nowrap text-xs">
      <p className="font-medium">
        {contact.attempts} attempt{contact.attempts === 1 ? "" : "s"}
      </p>
      <p className="text-muted-foreground">Last {formatDate(contact.lastAttemptAt)}</p>
    </div>
  );
}

/** Admin Hot leads: Let's Talk no-shows and quotes, highest priority first. */
export function HotLeads() {
  const { data, error, isLoading, isFetching, refetch } = useHotLeads();
  const followups = useCustomerFollowups();
  const followupsByKey = useMemo(() => indexFollowups(followups.data ?? []), [followups.data]);
  const followupsUnavailable = followups.isPending
    ? "Loading follow-ups…"
    : followups.isError
      ? isMissingTableError(followups.error)
        ? "Available once the follow-ups database update is deployed"
        : "Couldn't load follow-ups. Refresh the page to try again."
      : null;
  const outcomesCheck = useContactOutcomesAvailable();
  const outcomesUnavailable = outcomesCheck.isPending
    ? "Loading…"
    : outcomesCheck.isError
      ? isMissingTableError(outcomesCheck.error)
        ? "Outcomes are available once the contact-outcomes database update is deployed"
        : "Couldn't load contact outcomes. Refresh the page to try again."
      : null;
  // One extra day so an attempt made on the oldest lead's day is still seen.
  const attempts = useRecentContactAttempts((data?.lookbackDays ?? 90) + 1);

  const [tab, setTab] = useState<LeadTab>("open");
  const [source, setSource] = useState<"all" | LeadSource>("all");
  const [owner, setOwner] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: "score",
    direction: "asc",
  });

  const scored = useMemo((): ScoredLead[] => {
    const rows = data?.leads.rows ?? [];
    const contactByKey = contactSinceLead(rows, attempts.data ?? []);
    const now = new Date();
    return rows.map((row) => {
      const contact = contactByKey.get(row.key);
      return {
        row,
        tab: leadTab(row, followupsByKey.get(row.key)),
        contact,
        score: scoreLead(row, contact, now),
      };
    });
  }, [data, attempts.data, followupsByKey]);

  const tabCounts = useMemo(() => {
    const counts: Record<LeadTab, number> = { open: 0, call_rebooked: 0, closed: 0, converted: 0 };
    for (const lead of scored) counts[lead.tab]++;
    return counts;
  }, [scored]);

  const owners = useMemo(
    () => [...new Set(scored.map((lead) => lead.row.owner).filter((o): o is string => !!o))].sort(),
    [scored]
  );

  const leads = useMemo(() => {
    const compare = COMPARATORS[sort.key];
    return scored
      .filter((lead) => lead.tab === tab)
      .filter((lead) => source === "all" || lead.row.source === source)
      .filter((lead) => owner === "all" || lead.row.owner === owner)
      .filter((lead) => matchesSearch(lead.row, search))
      .sort((a, b) => (sort.direction === "asc" ? compare(a, b) : compare(b, a)));
  }, [scored, tab, source, owner, search, sort]);

  // Selection follows the Progression pages: only rows currently shown.
  const bulk = useBulkUpdateFollowups();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const headerCheckboxRef = useRef<HTMLButtonElement>(null);
  const visibleKeys = useMemo(() => leads.map((lead) => lead.row.key), [leads]);
  useEffect(() => {
    setSelected((current) => pruneSelection(current, visibleKeys));
  }, [visibleKeys]);
  const selectedKeys = visibleKeys.filter((key) => selected.has(key));
  const nameByKey = useMemo(() => new Map(leads.map((lead) => [lead.row.key, lead.row.name])), [leads]);

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

  const open = scored.filter((lead) => lead.tab === "open");
  const newThisWeek = open.filter((lead) => lead.row.daysSinceLead <= 7).length;
  const quotedOpen = open.filter((lead) => lead.row.source !== "no_show").length;
  const noShowOpen = open.filter((lead) => lead.row.source !== "quoted").length;
  const issues = data.dataIssues;
  const headerState = headerCheckboxState(visibleKeys, selected);

  return (
    <div className={`space-y-6 animate-fade-in ${selectedKeys.length > 0 ? "pb-24" : ""}`}>
      <InsightsHeader data={data} isFetching={isFetching} onRefresh={() => refetch()} />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open leads" value={String(open.length)} hint={`${newThisWeek} new in the last 7 days`} />
        <StatTile label="Quoted, not booked" value={String(quotedOpen)} />
        <StatTile label="Missed a call, not booked" value={String(noShowOpen)} />
        <StatTile
          label={`Converted (last ${data.lookbackDays} days)`}
          value={String(tabCounts.converted)}
          hint="Booked a session since"
        />
      </div>

      {(issues.incompleteDates.length > 0 || issues.leadsWithoutEmail > 0) && (
        <Alert className="border-amber-200 bg-amber-50/50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>Data to be aware of</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">
              {issues.incompleteDates.length > 0 && (
                <li>
                  Acuity returned too many appointments to fetch completely on{" "}
                  {issues.incompleteDates.join(", ")}. Leads from those days may be missing.
                </li>
              )}
              {issues.leadsWithoutEmail > 0 && (
                <li>
                  {issues.leadsWithoutEmail} lead(s) have no email in Acuity, so their earlier
                  history and portal account can't be checked.
                </li>
              )}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-border/50">
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg font-heading">Hot leads</CardTitle>
            <CardDescription>
              People who missed a free Let's Talk call (labelled No Show) or were marked Quoted in
              Acuity in the last {data.lookbackDays} days. Hover a score to see how it's worked out.
              A lead closes when Acuity shows a paid session booked, or when you record an outcome.
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={tab}
            onValueChange={(value) => value && setTab(value as LeadTab)}
            className="flex-wrap justify-start"
            aria-label="Lead status"
          >
            {LEAD_TABS.map((item) => (
              <ToggleGroupItem key={item.id} value={item.id} variant="outline" size="sm">
                {item.label} ({tabCounts[item.id]})
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or phone"
                className="pl-8"
                aria-label="Search leads"
              />
            </div>
            <Select value={source} onValueChange={(value) => setSource(value as "all" | LeadSource)}>
              <SelectTrigger className="w-[180px]" aria-label="Filter by source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="quoted">Quoted</SelectItem>
                <SelectItem value="no_show">No-show</SelectItem>
                <SelectItem value="both">Quoted + no-show</SelectItem>
              </SelectContent>
            </Select>
            {owners.length > 1 && (
              <Select value={owner} onValueChange={setOwner}>
                <SelectTrigger className="w-[180px]" aria-label="Filter by calendar">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All calendars</SelectItem>
                  {owners.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
              <CalendarX className="h-8 w-8" />
              <p className="text-sm">
                {search || source !== "all" || owner !== "all"
                  ? "No leads match your search or filters."
                  : "No leads here."}
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
                          ? `Deselect all ${leads.length} shown leads`
                          : `Select all ${leads.length} shown leads`
                      }
                    />
                  </TableHead>
                  <SortableHead label="Score" sortKey="score" sort={sort} onSort={onSort} />
                  <SortableHead label="Customer" sortKey="name" sort={sort} onSort={onSort} />
                  <SortableHead label="Lead" sortKey="lead" sort={sort} onSort={onSort} />
                  <TableHead>Booked since</TableHead>
                  <TableHead>Attempts since</TableHead>
                  <TableHead>Portal account</TableHead>
                  <TableHead>Follow-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map(({ row, contact, score }) => (
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
                        aria-label={`Select ${row.name ?? "unnamed lead"}`}
                      />
                    </TableCell>
                    <TableCell>
                      <ScoreBadge score={score} />
                    </TableCell>
                    <TableCell>
                      <CustomerCell name={row.name} email={row.email} phone={row.phone} />
                    </TableCell>
                    <TableCell>
                      <LeadCell row={row} />
                    </TableCell>
                    <TableCell>
                      <StatusCell row={row} />
                    </TableCell>
                    <TableCell>
                      <AttemptsCell contact={contact} />
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
                        outcomesUnavailable={outcomesUnavailable}
                        acuityBooked={row.status === "converted"}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {leads.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing {leads.length} of {tabCounts[tab]} leads
              {selectedKeys.length > 0 && ` · ${selectedKeys.length} selected`}
            </p>
          )}
        </CardContent>
      </Card>

      {selectedKeys.length > 0 && (
        <BulkActionBar
          selectedKeys={selectedKeys}
          visibleCount={leads.length}
          followupsByKey={followupsByKey}
          nameByKey={nameByKey}
          unavailable={followupsUnavailable}
          outcomesUnavailable={outcomesUnavailable}
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
